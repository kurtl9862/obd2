/**
 * Turns the text an ELM327 prints (headers on, spaces on) into one message per module.
 *
 * CAN (every car sold in the US since 2008) prints one line per frame:
 *   7E8 06 41 00 BE 3F A8 13          <- 11-bit id, then the ISO-TP PCI byte, then data
 *   18 DA F1 10 06 41 00 ...          <- 29-bit id (four bytes)
 * Long replies arrive as a first frame (PCI 1x) and consecutive frames (PCI 2x), which we join.
 *
 * Older protocols (J1850, ISO 9141, KWP2000) print three header bytes, the data and a checksum:
 *   48 6B 10 41 0C 1A F8 C4
 */

export interface EcuMessage {
  /** Who answered: "7E8" on 11-bit CAN, "18DAF110" on 29-bit CAN, "10" on older protocols. */
  ecu: string;
  data: number[];
}

/** Errors the adapter prints instead of data. */
const ADAPTER_ERRORS = [
  'NO DATA',
  'UNABLE TO CONNECT',
  'CAN ERROR',
  'BUS ERROR',
  'BUS BUSY',
  'FB ERROR',
  'DATA ERROR',
  'BUFFER FULL',
  'STOPPED',
  'ACT ALERT',
  'LV RESET',
  'LP ALERT',
  'ERR',
  '?',
];

export class AdapterError extends Error {
  readonly code: string;
  constructor(code: string, raw: string) {
    super(code === 'NO DATA' ? 'No module answered that request' : `Adapter said: ${raw.trim()}`);
    this.name = 'AdapterError';
    this.code = code;
  }
}

/** Lines that carry no data: protocol search chatter and blank lines. */
function isNoise(line: string): boolean {
  return line === '' || line.startsWith('SEARCHING') || line.startsWith('BUS INIT') || line === 'OK';
}

/** Throws AdapterError if the whole reply is an adapter error (data lines win over stray errors). */
function checkErrors(lines: string[], raw: string): void {
  const dataLines = lines.filter((l) => /^[0-9A-F]{2,8}( [0-9A-F]{2})+$/.test(l));
  if (dataLines.length > 0) return;
  for (const line of lines) {
    const code = ADAPTER_ERRORS.find((e) => line.startsWith(e));
    if (code) throw new AdapterError(code, raw);
  }
}

export type Framing = 'can11' | 'can29' | 'legacy';

/** ELM327 protocol numbers (AT DPN): 6-9 are CAN, 6/8 11-bit, 7/9 29-bit; A-C are user CAN. */
export function framingFor(protocol: string): Framing {
  const p = protocol.replace(/^A/, '').toUpperCase();
  if (p === '7' || p === '9') return 'can29';
  if (p === '6' || p === '8' || p === 'A' || p === 'B' || p === 'C') return 'can11';
  return 'legacy';
}

export function parseResponse(raw: string, framing: Framing): EcuMessage[] {
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim().toUpperCase())
    .filter((l) => !isNoise(l));
  checkErrors(lines, raw);

  if (framing === 'legacy') return parseLegacy(lines);

  const assembling = new Map<string, { data: number[]; need: number; next: number }>();
  const order: string[] = [];
  const out = new Map<string, number[]>();

  for (const line of lines) {
    const tokens = line.split(' ');
    if (!tokens.every((t) => /^[0-9A-F]+$/.test(t))) continue;
    // 11-bit ids print as three hex digits; anything else on a CAN link is a 29-bit id.
    const headerLen = tokens[0].length === 3 ? 1 : 4;
    if (tokens.length <= headerLen) continue;
    const ecu = tokens.slice(0, headerLen).join('');
    const bytes = tokens.slice(headerLen).map((t) => parseInt(t, 16));
    const pci = bytes[0] >> 4;

    if (pci === 0) {
      // Single frame: low nibble is the length.
      const len = bytes[0] & 0x0f;
      out.set(ecu, bytes.slice(1, 1 + len));
      if (!order.includes(ecu)) order.push(ecu);
    } else if (pci === 1) {
      // First frame of a long message: 12-bit total length.
      const need = ((bytes[0] & 0x0f) << 8) | bytes[1];
      assembling.set(ecu, { data: bytes.slice(2), need, next: 1 });
      if (!order.includes(ecu)) order.push(ecu);
    } else if (pci === 2) {
      const msg = assembling.get(ecu);
      if (!msg) continue;
      const seq = bytes[0] & 0x0f;
      if (seq !== msg.next % 16) continue; // out of order or a repeat; drop it
      msg.next++;
      msg.data.push(...bytes.slice(1));
      if (msg.data.length >= msg.need) {
        out.set(ecu, msg.data.slice(0, msg.need));
        assembling.delete(ecu);
      }
    }
    // pci 3 = flow control, never meant for us.
  }
  // A long message that never finished: hand back what arrived rather than nothing.
  for (const [ecu, msg] of assembling) if (!out.has(ecu)) out.set(ecu, msg.data);

  return order.filter((e) => out.has(e)).map((ecu) => ({ ecu, data: out.get(ecu)! }));
}

function parseLegacy(lines: string[]): EcuMessage[] {
  const out: EcuMessage[] = [];
  for (const line of lines) {
    const tokens = line.split(' ');
    if (tokens.length < 5 || !tokens.every((t) => /^[0-9A-F]{2}$/.test(t))) continue;
    const bytes = tokens.map((t) => parseInt(t, 16));
    // [priority, target, source, ...data, checksum]
    out.push({ ecu: tokens[2], data: bytes.slice(3, -1) });
  }
  return out;
}

/** "41 0C 1A F8" style, for logs and the console. */
export function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
