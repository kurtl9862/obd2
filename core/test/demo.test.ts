import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Elm327 } from '../elm327.ts';
import { SimTransport } from '../sim-transport.ts';
import { clearCodes, NegativeResponse, readCodes, readExtra, readVin } from '../obd.ts';
import { vehicleById } from '../vehicles.ts';
import { CIVIC_DEMO_EXTRA, DemoCar, simulateDrive } from '../demo-car.ts';

async function connect(car: DemoCar) {
  const t = new SimTransport(car, 0);
  await t.open();
  const elm = new Elm327(t);
  await elm.init();
  return elm;
}

test('each demo car has its own VIN and codes', async () => {
  let clock = 0;
  const elm = await connect(new DemoCar('civic-2020', 'city', () => clock));
  assert.equal(await readVin(elm), '2HGFC2F61LH524817');
  const codes = await readCodes(elm);
  assert.deepEqual(codes.map((c) => c.code).sort(), ['P0135', 'P0456']);
  assert.ok(codes.every((c) => c.ecu === '7E8'), 'the Civic has no separate transmission computer');
  clock += 1000;
  await elm.close();
});

test('the demo Pathfinder clears codes, the Sentra’s gateway refuses', async () => {
  const pf = await connect(new DemoCar('pathfinder-2010', 'city', () => 0));
  assert.ok((await clearCodes(pf)).includes('7E8'));
  assert.equal((await readCodes(pf)).length, 0);
  await pf.close();

  const sentra = await connect(new DemoCar('sentra-2020', 'city', () => 0));
  await assert.rejects(clearCodes(sentra), (err) => err instanceof NegativeResponse && err.nrc === 0x33);
  await sentra.close();
});

test('transmission temperature reads back through each profile’s formula', async () => {
  for (const [id, extra] of [
    ['pathfinder-2010', vehicleById('pathfinder-2010').extraPids[0]],
    ['sentra-2020', vehicleById('sentra-2020').extraPids[0]],
    ['civic-2020', CIVIC_DEMO_EXTRA],
  ] as const) {
    const car = new DemoCar(id, 'highway', () => 0);
    const elm = await connect(car);
    const c = await readExtra(elm, extra);
    assert.ok(Math.abs(c - car.atfC()) < 1.5, `${id}: read ${c}, car has ${car.atfC()}`);
    await elm.close();
  }
});

test('towing pushes transmission temperature over the warning limit; cold start warms up', () => {
  let clock = 0;
  const tow = new DemoCar('pathfinder-2010', 'towing', () => clock);
  for (clock = 0; clock < 900_000; clock += 1000) tow.atfC();
  assert.ok(tow.atfC() > 105, `ATF ${tow.atfC()}`);

  clock = 0;
  const cold = new DemoCar('pathfinder-2010', 'cold', () => clock);
  const start = cold.coolantC();
  for (clock = 0; clock < 600_000; clock += 1000) cold.coolantC();
  assert.ok(start < 20 && cold.coolantC() > 80, `coolant ${start} -> ${cold.coolantC()}`);
});

test('sample drives look like real ones', () => {
  const d = simulateDrive('pathfinder-2010', [['city', 300], ['highway', 600]], 'atf-temp-guess', 'ATF', { lat: 39.7, lon: -105, heading: 0 });
  assert.equal(d.rows.length, 900);
  const speed = d.columns.findIndex((c) => c.key === '13') + 1;
  const flow = d.columns.findIndex((c) => c.key === 'lph') + 1;
  let km = 0;
  let liters = 0;
  for (const r of d.rows) {
    km += (r[speed] as number) / 3600;
    liters += (r[flow] as number) / 3600;
  }
  const mpg = 235.215 / ((liters / km) * 100);
  assert.ok(km > 10 && km < 25, `${km} km`);
  assert.ok(mpg > 14 && mpg < 24, `${mpg} mpg`);
});
