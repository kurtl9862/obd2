import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdapterError, parseResponse } from '../parse.ts';
import { decodeDtc, parseDtcReply, isManufacturerCode } from '../dtc.ts';
import { decodeReadiness, smogVerdict } from '../readiness.ts';
import { evaluateFormula, byteIndex } from '../formula.ts';
import { decodeSupported, splitMultiReply } from '../pids.ts';
import { parseVin, vinModelYear, vinMaker } from '../vin.ts';
import { suggestVehicles } from '../vehicles.ts';

test('11-bit CAN single frames from two modules', () => {
  const raw = '7E8 06 41 00 BE 3F A8 13 55\r7E9 06 41 00 80 00 00 00 55\r\r';
  const msgs = parseResponse(raw, 'can11');
  assert.deepEqual(msgs, [
    { ecu: '7E8', data: [0x41, 0x00, 0xbe, 0x3f, 0xa8, 0x13] },
    { ecu: '7E9', data: [0x41, 0x00, 0x80, 0x00, 0x00, 0x00] },
  ]);
});

test('multi-frame VIN is reassembled', () => {
  const raw = [
    '7E8 10 14 49 02 01 35 4E 31',
    '7E8 21 41 52 31 4E 42 30 41',
    '7E8 22 43 36 30 30 30 30 31',
  ].join('\r');
  const msgs = parseResponse(raw, 'can11');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].data.length, 0x14);
  assert.equal(parseVin(msgs), '5N1AR1NB0AC600001');
});

test('29-bit CAN and older protocols', () => {
  assert.deepEqual(parseResponse('18 DA F1 10 03 41 0D 32', 'can29'), [{ ecu: '18DAF110', data: [0x41, 0x0d, 0x32] }]);
  assert.deepEqual(parseResponse('48 6B 10 41 0C 1A F8 C4', 'legacy'), [{ ecu: '10', data: [0x41, 0x0c, 0x1a, 0xf8] }]);
});

test('adapter errors and search chatter', () => {
  assert.throws(() => parseResponse('SEARCHING...\rNO DATA', 'can11'), (e: unknown) => e instanceof AdapterError && e.code === 'NO DATA');
  assert.throws(() => parseResponse('SEARCHING...\rUNABLE TO CONNECT', 'can11'), (e: unknown) => e instanceof AdapterError && e.code === 'UNABLE TO CONNECT');
  assert.equal(parseResponse('SEARCHING...\r7E8 03 41 0D 32 55 55 55 55', 'can11')[0].data[2], 0x32);
});

test('trouble codes', () => {
  assert.equal(decodeDtc(0x04, 0x20), 'P0420');
  assert.equal(decodeDtc(0xc1, 0x00), 'U0100');
  assert.equal(decodeDtc(0x41, 0x23), 'C0123');
  assert.equal(decodeDtc(0x81, 0x00), 'B0100');
  assert.deepEqual(parseDtcReply({ ecu: '7E8', data: [0x43, 0x02, 0x04, 0x20, 0x01, 0x71] }, true), ['P0420', 'P0171']);
  assert.deepEqual(parseDtcReply({ ecu: '10', data: [0x43, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00] }, false), ['P0300']);
  assert.equal(isManufacturerCode('P1446'), true);
  assert.equal(isManufacturerCode('P0420'), false);
});

test('readiness and the smog hint', () => {
  // MIL off, no codes; spark; catalyst/evap/O2/O2 heater supported; evap incomplete
  const r = decodeReadiness([0x00, 0x07, 0b01100101, 0b00000100]);
  assert.equal(r.milOn, false);
  assert.equal(r.monitors.find((m) => m.name === 'Evaporative system')?.state, 'incomplete');
  assert.equal(r.monitors.find((m) => m.name === 'Catalyst')?.state, 'complete');
  assert.equal(r.monitors.find((m) => m.name === 'EGR system')?.state, 'unsupported');
  assert.equal(smogVerdict(r, 2010).pass, true);
  const cleared = decodeReadiness([0x00, 0x07, 0b01100101, 0b01100101]);
  assert.equal(smogVerdict(cleared, 2010).pass, false);
  assert.equal(smogVerdict(decodeReadiness([0x81, 0x07, 0, 0]), 2010).pass, false);
});

test('formulas', () => {
  assert.equal(byteIndex('A'), 0);
  assert.equal(byteIndex('AD'), 29);
  assert.equal(evaluateFormula('A-40', [130]), 90);
  assert.equal(evaluateFormula('(A*256+B)/4', [0x1a, 0xf8]), 1726);
  assert.equal(evaluateFormula('-A+2^3', [1]), 7);
  assert.ok(Math.abs(evaluateFormula('0.000000002344*A^5 - 0.03501*A^2', [10]) - (0.000000002344 * 1e5 - 3.501)) < 1e-9);
  assert.throws(() => evaluateFormula('B', [1]), /byte B/);
  assert.throws(() => evaluateFormula('alert(1)', [1]));
});

test('supported PIDs and multi-PID replies', () => {
  assert.deepEqual(decodeSupported(0, [0xbe, 0x1f, 0xa8, 0x13]).slice(0, 6), [0x01, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const m = splitMultiReply([0x41, 0x0c, 0x1a, 0xf8, 0x0d, 0x32, 0x05, 0x7b]);
  assert.deepEqual([...m.keys()], [0x0c, 0x0d, 0x05]);
  assert.deepEqual(m.get(0x0c), [0x1a, 0xf8]);
});

test('VIN model year, maker and vehicle suggestion', () => {
  assert.equal(vinModelYear('5N1AR1NB0AC600001'), 2010);
  assert.equal(vinModelYear('3N1AB8DV5LY000001'), 2020);
  assert.equal(vinModelYear('1HGCM82633A004352'), 2003);
  assert.equal(vinMaker('2HGFC2F80LH000001'), 'Honda');
  assert.equal(vinMaker('5N1AR1NB0AC600001'), 'Nissan');
  assert.deepEqual(suggestVehicles('Nissan', 2020).map((v) => v.id), ['sentra-2020']);
  assert.deepEqual(suggestVehicles('Honda', 2020).map((v) => v.id), ['civic-2020']);
});
