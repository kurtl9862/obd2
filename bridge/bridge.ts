/**
 * The Mac helper for Wi-Fi adapters like the Goliath ELM327.
 *
 * Browsers can't open raw TCP sockets, and Wi-Fi OBD adapters speak raw TCP (usually
 * 192.168.0.10:35000). This relays between the adapter and the web app over a WebSocket on
 * localhost, and also serves the built web app, so everything runs from http://localhost:35001.
 *
 *   node bridge/bridge.ts                      # adapter at 192.168.0.10:35000
 *   node bridge/bridge.ts --adapter 192.168.0.10:35000 --port 35001
 *   node bridge/bridge.ts --sim                # no adapter: the built-in pretend car
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acceptWebSocket, type WsConnection } from './ws.ts';
import { SimTransport } from '../core/sim-transport.ts';
import { RECALLS_BASE, VPIC_BASE } from '../core/nhtsa.ts';

export interface BridgeOptions {
  adapterHost: string;
  adapterPort: number;
  port: number;
  sim: boolean;
  /** Extra browser origins allowed to connect (e.g. a GitHub Pages copy of the app). */
  allowOrigins: string[];
  webRoot: string;
  quiet?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

/** Only pages on this Mac (any localhost port) or origins you name may drive the adapter. */
export function originAllowed(origin: string | undefined, extra: string[]): boolean {
  if (!origin) return true; // not a browser (curl, tests)
  if (extra.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function startBridge(opts: BridgeOptions) {
  const log = (msg: string) => {
    if (!opts.quiet) console.log(`[bridge] ${msg}`);
  };
  let active: { ws: WsConnection; end: () => void } | null = null;

  const serveStatic = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sim: opts.sim, adapter: `${opts.adapterHost}:${opts.adapterPort}`, connected: !!active }));
      return;
    }
    if (url.pathname.startsWith('/nhtsa/')) {
      await proxyNhtsa(req, res, url);
      return;
    }
    const root = resolve(opts.webRoot);
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      try {
        // Single-page app: unknown paths get the app.
        const body = await readFile(join(root, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('The web app is not built yet. Run "npm run build", or use "npm run dev" for development.');
      }
    }
  };

  /**
   * NHTSA lookups (VIN decode, recalls) for when the browser can't reach them directly.
   * Only these two hosts, only GET, and only for pages allowed to use the helper.
   */
  const proxyNhtsa = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin, opts.allowOrigins) || req.method !== 'GET') {
      res.writeHead(403).end();
      return;
    }
    const cors: Record<string, string> = origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
    const m = url.pathname.match(/^\/nhtsa\/(vpic|recalls)(\/[\w./-]*)$/);
    if (!m || m[2].includes('..')) {
      res.writeHead(404, cors).end();
      return;
    }
    const target = `${m[1] === 'vpic' ? VPIC_BASE : RECALLS_BASE}${m[2]}${url.search}`;
    try {
      const upstream = await fetch(target, { signal: AbortSignal.timeout(10_000) });
      const body = await upstream.text();
      res.writeHead(upstream.status, { ...cors, 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(body);
    } catch (err) {
      log(`NHTSA lookup failed: ${(err as Error).message}`);
      res.writeHead(502, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'The Mac helper could not reach NHTSA. Is the Mac online?' }));
    }
  };

  const server = createServer((req, res) => {
    serveStatic(req, res).catch(() => res.writeHead(500).end());
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/elm' || !originAllowed(req.headers.origin, opts.allowOrigins)) {
      log(`refused a connection from ${req.headers.origin ?? 'unknown origin'}`);
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const ws = acceptWebSocket(req, socket);
    if (!ws) return;
    // One app at a time: the newest tab wins.
    if (active) {
      active.ws.close(4001, 'Another tab connected');
      active.end();
    }
    active = opts.sim ? relaySim(ws) : relayTcp(ws);
  });

  function relaySim(ws: WsConnection) {
    log('app connected (simulator)');
    const sim = new SimTransport();
    sim.onData = (text) => ws.send(text);
    void sim.open();
    ws.onMessage = (text) => void sim.write(text);
    const end = () => void sim.close();
    ws.onClose = () => {
      log('app disconnected');
      end();
      if (active?.ws === ws) active = null;
    };
    return { ws, end };
  }

  function relayTcp(ws: WsConnection) {
    log(`app connected, opening ${opts.adapterHost}:${opts.adapterPort}`);
    const pendingWrites: string[] = [];
    let ready = false;
    const tcp: Socket = connect({ host: opts.adapterHost, port: opts.adapterPort });
    tcp.setTimeout(6000);
    tcp.setNoDelay(true);
    tcp.on('connect', () => {
      ready = true;
      tcp.setTimeout(0);
      log('adapter connected');
      for (const w of pendingWrites.splice(0)) tcp.write(w);
    });
    tcp.on('timeout', () => tcp.destroy(new Error('timed out')));
    tcp.on('data', (chunk) => ws.send(chunk.toString('latin1')));
    tcp.on('error', (err) => {
      log(`adapter error: ${err.message}`);
      ws.close(
        4002,
        `Can't reach the adapter at ${opts.adapterHost}:${opts.adapterPort}. Is the Mac's Wi-Fi joined to the adapter's network?`,
      );
    });
    tcp.on('close', () => {
      if (ready) ws.close(4003, 'The adapter closed the connection');
    });
    ws.onMessage = (text) => {
      if (ready) tcp.write(text, 'latin1');
      else pendingWrites.push(text);
    };
    const end = () => tcp.destroy();
    ws.onClose = () => {
      log('app disconnected');
      end();
      if (active?.ws === ws) active = null;
    };
    return { ws, end };
  }

  server.listen(opts.port, '127.0.0.1', () => {
    const where = opts.sim ? 'the simulator' : `the adapter at ${opts.adapterHost}:${opts.adapterPort}`;
    log(`open http://localhost:${opts.port} in Chrome or Edge (relaying to ${where})`);
  });
  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({
    options: {
      adapter: { type: 'string', default: process.env.OBD_ADAPTER ?? '192.168.0.10:35000' },
      port: { type: 'string', default: process.env.OBD_BRIDGE_PORT ?? '35001' },
      sim: { type: 'boolean', default: false },
      'allow-origin': { type: 'string', multiple: true, default: [] },
    },
  });
  const [host, port] = values.adapter.split(':');
  startBridge({
    adapterHost: host,
    adapterPort: Number(port ?? 35000),
    port: Number(values.port),
    sim: values.sim,
    allowOrigins: values['allow-origin'],
    webRoot: join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist'),
  });
}
