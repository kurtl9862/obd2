import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { startBridge, originAllowed } from '../bridge.ts';
import { startFakeAdapter } from '../fake-adapter.ts';
import { WebSocketTransport } from '../../core/ws-transport.ts';
import { Elm327 } from '../../core/elm327.ts';
import { readCodes, readVin } from '../../core/obd.ts';

async function bridge(adapterPort: number, sim = false): Promise<Server> {
  const server = startBridge({
    adapterHost: '127.0.0.1',
    adapterPort,
    port: 0,
    sim,
    allowOrigins: [],
    webRoot: '/nonexistent',
    quiet: true,
  });
  await once(server, 'listening');
  return server;
}
const portOf = (s: { address(): unknown }) => (s.address() as AddressInfo).port;

test('only local pages may connect', () => {
  assert.equal(originAllowed('http://localhost:5173', []), true);
  assert.equal(originAllowed('http://127.0.0.1:35001', []), true);
  assert.equal(originAllowed('https://evil.example', []), false);
  assert.equal(originAllowed('https://kurtl9862.github.io', ['https://kurtl9862.github.io']), true);
});

test('the whole Wi-Fi path: app -> WebSocket -> bridge -> TCP -> adapter', async () => {
  const adapter = startFakeAdapter(0);
  await once(adapter, 'listening');
  const server = await bridge(portOf(adapter));
  const t = new WebSocketTransport(`ws://127.0.0.1:${portOf(server)}/elm`);
  await t.open();
  const elm = new Elm327(t);
  const info = await elm.init();
  assert.equal(info.protocol, '6');
  assert.equal(await readVin(elm), '5N1AR1NB0AC600001');
  assert.equal((await readCodes(elm)).length, 3);
  await elm.close();
  server.close();
  adapter.close();
});

test('simulator mode needs no adapter', async () => {
  const server = await bridge(1, true);
  const t = new WebSocketTransport(`ws://127.0.0.1:${portOf(server)}/elm`);
  await t.open();
  const elm = new Elm327(t);
  assert.equal((await elm.init()).protocol, '6');
  await elm.close();
  server.close();
});

test('an unreachable adapter closes the socket with a reason', async () => {
  const server = await bridge(1); // nothing listens on port 1
  const t = new WebSocketTransport(`ws://127.0.0.1:${portOf(server)}/elm`);
  await t.open();
  const closed = new Promise<string | undefined>((resolve) => (t.onClose = resolve));
  await t.write('ATZ\r');
  assert.match((await closed) ?? '', /Can't reach the adapter/);
  server.close();
});

test('NHTSA lookups go through the helper, only to NHTSA, only for local pages', async (t) => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    asked.push(url);
    return new Response(JSON.stringify({ Results: [{ Make: 'NISSAN' }] }), { headers: { 'content-type': 'application/json' } });
  });
  const server = await bridge(1);
  const base = `http://127.0.0.1:${portOf(server)}`;

  const ok = await fetch(`${base}/nhtsa/vpic/DecodeVinValues/5N1AR1NB0AC600001?format=json`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.deepEqual(await ok.json(), { Results: [{ Make: 'NISSAN' }] });
  assert.deepEqual(asked, ['https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/5N1AR1NB0AC600001?format=json']);

  await fetch(`${base}/nhtsa/recalls/recallsByVehicle?make=Nissan&model=Pathfinder&modelYear=2010`);
  assert.equal(asked[1], 'https://api.nhtsa.gov/recalls/recallsByVehicle?make=Nissan&model=Pathfinder&modelYear=2010');

  const evil = await fetch(`${base}/nhtsa/vpic/x`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const other = await fetch(`${base}/nhtsa/elsewhere/x`);
  assert.equal(other.status, 404);
  assert.equal(asked.length, 2);
  server.close();
});
