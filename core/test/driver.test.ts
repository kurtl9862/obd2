import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Elm327 } from '../elm327.ts';
import { FakeCar } from '../emulator.ts';
import { SimTransport } from '../sim-transport.ts';
import { clearCodes, LiveReader, readCodes, readExtra, readFreezeFrame, readReadiness, readVin, supportedPids } from '../obd.ts';
import { vehicleById } from '../vehicles.ts';

async function connect(car = new FakeCar({ now: () => 60_000 })) {
  const t = new SimTransport(car, 0);
  await t.open();
  const elm = new Elm327(t);
  const info = await elm.init();
  return { elm, info, car };
}

test('init finds CAN 11-bit through the simulator', async () => {
  const { elm, info } = await connect();
  assert.equal(info.protocol, '6');
  assert.match(info.version, /ELM327/);
  assert.equal(elm.framing, 'can11');
  await elm.close();
});

test('supported PIDs walk every range', async () => {
  const { elm } = await connect();
  const pids = await supportedPids(elm);
  assert.ok(pids.includes(0x0c));
  assert.ok(pids.includes(0x2f));
  assert.ok(pids.includes(0x42));
  assert.ok(!pids.includes(0x20), 'range markers are not values');
  await elm.close();
});

test('live values in one multi-PID request', async () => {
  const car = new FakeCar({ now: () => 0 });
  const { elm } = await connect(car);
  const values = await new LiveReader(elm).read([0x0c, 0x0d, 0x05, 0x2f]);
  assert.equal(values.get(0x05), 20, 'cold engine at start');
  assert.ok((values.get(0x0c) ?? 0) > 500);
  assert.ok(Math.abs((values.get(0x2f) ?? 0) - 62) < 1);
  await elm.close();
});

test('codes from both modules, then clear', async () => {
  const { elm, car } = await connect();
  const codes = await readCodes(elm);
  assert.deepEqual(
    codes.map((c) => `${c.ecu} ${c.kind} ${c.code}`),
    ['7E8 stored P0420', '7E9 stored P0744', '7E8 pending P0171'],
  );
  const r = await readReadiness(elm);
  assert.equal(r?.milOn, true);
  assert.equal(r?.dtcCount, 2);

  const ff = await readFreezeFrame(elm);
  assert.equal(ff?.code, 'P0420');
  assert.ok(ff?.values.has(0x05));

  const confirmed = await clearCodes(elm);
  assert.deepEqual(confirmed, ['7E8', '7E9']);
  assert.deepEqual(await readCodes(elm), []);
  assert.equal(car.monitorsReset, true);
  assert.equal((await readReadiness(elm))?.milOn, false);
  await elm.close();
});

test('VIN', async () => {
  const { elm } = await connect();
  assert.equal(await readVin(elm), '5N1AR1NB0AC600001');
  await elm.close();
});

test('carmaker values switch to the module and back', async () => {
  const car = new FakeCar({ now: () => 0 });
  const { elm } = await connect(car);
  const pathfinder = vehicleById('pathfinder-2010');
  const atf = await readExtra(elm, pathfinder.extraPids[0]);
  assert.equal(atf, 24, 'A-55 on the simulated block');
  const sentra = vehicleById('sentra-2020');
  const cvt = await readExtra(elm, sentra.extraPids[0]);
  assert.ok(Number.isFinite(cvt));
  // broadcast again afterwards: both modules answer
  const codes = await readCodes(elm);
  assert.ok(codes.some((c) => c.ecu === '7E9'));
  await elm.close();
});

test('ignition off gives a clear error', async () => {
  const t = new SimTransport(new FakeCar({ ignitionOn: false }), 0);
  await t.open();
  const elm = new Elm327(t);
  await assert.rejects(elm.init(), /UNABLE TO CONNECT|ignition/i);
  await elm.close();
});
