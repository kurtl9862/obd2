/**
 * Pretends to be a Wi-Fi OBD adapter: a TCP server that answers like an ELM327 plugged into a car.
 * Lets you test the whole Wi-Fi path (bridge included) with no truck:
 *
 *   node bridge/fake-adapter.ts            # listens on 127.0.0.1:35000
 *   node bridge/bridge.ts --adapter 127.0.0.1:35000
 */
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeCar, FakeElm } from '../core/emulator.ts';

export function startFakeAdapter(port = 35000, host = '127.0.0.1') {
  const server = createServer((socket) => {
    const elm = new FakeElm(new FakeCar());
    let line = '';
    socket.on('data', (chunk) => {
      for (const ch of chunk.toString('latin1')) {
        if (ch === '\r') {
          socket.write(elm.handle(line), 'latin1');
          line = '';
        } else if (ch !== '\n') {
          line += ch;
        }
      }
    });
    socket.on('error', () => {});
  });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startFakeAdapter(Number(process.argv[2] ?? 35000));
  console.log('[fake adapter] listening on 127.0.0.1:35000');
}
