/**
 * Just enough of the WebSocket protocol (RFC 6455) for one browser tab to exchange text with the
 * adapter: the handshake, text/binary frames, ping/pong and close. No dependencies.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsConnection {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onMessage: ((text: string) => void) | null;
  onClose: (() => void) | null;
}

/** Complete the upgrade on `socket`, or return null (and answer 400) if it isn't a WebSocket request. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let buf = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let closed = false;

  const conn: WsConnection = {
    onMessage: null,
    onClose: null,
    send(text) {
      if (!closed) socket.write(frame(0x1, Buffer.from(text, 'utf8')));
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      closed = true;
      const payload = Buffer.concat([Buffer.alloc(2), Buffer.from(reason.slice(0, 120), 'utf8')]);
      payload.writeUInt16BE(code);
      socket.end(frame(0x8, payload));
    },
  };

  const finish = () => {
    if (!closed) closed = true;
    conn.onClose?.();
    conn.onClose = null;
  };

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const parsed = readFrame(buf);
      if (!parsed) break;
      buf = buf.subarray(parsed.length);
      const { fin, opcode, payload } = parsed;
      if (opcode === 0x8) {
        conn.close();
        finish();
        return;
      }
      if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          conn.onMessage?.(text);
        }
      }
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
  return conn;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/** One frame from the front of `buf`, unmasked, or null if it hasn't fully arrived. */
function readFrame(buf: Buffer): { fin: boolean; opcode: number; payload: Buffer; length: number } | null {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;
  const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { fin, opcode, payload, length: offset + maskLen + len };
}
