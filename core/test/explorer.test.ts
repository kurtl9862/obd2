import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Elm327 } from '../elm327.ts';
import { FakeCar } from '../emulator.ts';
import { SimTransport } from '../sim-transport.ts';
import { byteLetter, candidateToExtra, rangeRequests, rankCandidates, scanModule, takeSample } from '../explorer.ts';
import { readExtra } from '../obd.ts';
import { TRANSMISSION } from '../vehicles.ts';
import { litersPer100km, litersPerHourFromMaf, mpgFromLitersPer100km, tripTotals } from '../fuel.ts';

test('request ranges and byte letters', () => {
  assert.deepEqual(rangeRequests('21', 1, 3), ['2101', '2102', '2103']);
  assert.deepEqual(rangeRequests('22', 0x1e1c, 0x1e1d), ['221E1C', '221E1D']);
  assert.equal(byteLetter(0), 'A');
  assert.equal(byteLetter(25), 'Z');
  assert.equal(byteLetter(29), 'AD');
});

test('scan, record a warm-up, and find the fluid temperature', async () => {
  let now = 0;
  const car = new FakeCar({ now: () => now });
  const t = new SimTransport(car, 0);
  await t.open();
  const elm = new Elm327(t);
  await elm.init();

  const found = await scanModule(elm, TRANSMISSION, rangeRequests('21', 0x01, 0x30));
  assert.deepEqual(found.map((b) => b.request), ['2101', '2102', '2120']);

  const samples = [];
  for (let s = 0; s <= 180; s += 10) {
    now = s * 1000;
    samples.push(await takeSample(elm, TRANSMISSION, found, now));
  }
  assert.equal(samples[0].coolant, 20);
  assert.equal(samples[0].intake, 24);

  const ranked = rankCandidates(samples);
  const top = ranked.slice(0, 2).map((c) => `${c.request} ${c.formula}`).sort();
  assert.deepEqual(top, ['2101 AD-40', '2120 A-55']);
  assert.ok(!ranked.some((c) => c.request === '2101' && c.letter === 'E'), 'the rolling counter is rejected');
  assert.ok(!ranked.some((c) => c.request === '2101' && c.letter === 'H'), 'engine speed is rejected');

  // The saved value reads back the simulated fluid temperature.
  const extra = candidateToExtra(ranked[0], TRANSMISSION, 'Transmission fluid temperature', 'ATF', '2026-11-01');
  assert.equal(Math.round(await readExtra(elm, extra)), Math.round(car.atfC()));
  await elm.close();
});

test('too little data ranks nothing', () => {
  assert.deepEqual(rankCandidates([{ t: 0, blocks: { '2101': [1] } }]), []);
});

test('fuel economy', () => {
  const lph = litersPerHourFromMaf(10); // ~3.3 L/h
  assert.ok(Math.abs(lph - 3.309) < 0.01);
  assert.equal(litersPer100km(lph, 0), null);
  const l100 = litersPer100km(lph, 80)!;
  assert.ok(Math.abs(l100 - 4.14) < 0.01);
  assert.ok(Math.abs(mpgFromLitersPer100km(10) - 23.52) < 0.01);
  const trip = tripTotals([
    { t: 0, speedKmh: 60, litersPerHour: 6 },
    { t: 10_000, speedKmh: 60, litersPerHour: 6 },
    { t: 20_000, speedKmh: 60, litersPerHour: 6 },
    { t: 600_000, speedKmh: 60, litersPerHour: 6 }, // a long gap is skipped
  ]);
  assert.ok(Math.abs(trip.km - 0.3333) < 0.001);
  assert.ok(Math.abs(trip.liters - 0.0333) < 0.001);
});
