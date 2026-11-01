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
