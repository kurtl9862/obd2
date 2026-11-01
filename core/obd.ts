/**
 * OBD-II services on top of the adapter driver: supported values, live data, codes, readiness,
 * VIN, freeze frame, and carmaker-specific values from a vehicle profile.
 */
import type { Elm327 } from './elm327.ts';
import { AdapterError, type EcuMessage } from './parse.ts';
import { decodeSupported, PID_BY_NUMBER, splitMultiReply } from './pids.ts';
import { decodeDtc, parseDtcReply } from './dtc.ts';
import { decodeReadiness, type Readiness } from './readiness.ts';
import { parseVin } from './vin.ts';
import { evaluateFormula } from './formula.ts';
import type { ExtraPid } from './vehicles.ts';

const NRC: Record<number, string> = {
  0x10: 'general reject',
  0x11: 'service not supported',
  0x12: 'sub-function not supported',
  0x13: 'wrong message length',
  0x21: 'busy, try again',
  0x22: 'conditions not correct (engine running? gear?)',
  0x31: 'request out of range',
  0x33: 'security access denied',
  0x35: 'invalid key',
  0x78: 'response pending',
  0x7e: 'not supported in this session',
  0x7f: 'service not supported in this session',
};

export class NegativeResponse extends Error {
  readonly service: number;
  readonly nrc: number;
  constructor(service: number, nrc: number) {
    super(`Refused: ${NRC[nrc] ?? `code 0x${nrc.toString(16)}`}`);
    this.name = 'NegativeResponse';
    this.service = service;
    this.nrc = nrc;
  }
}

/** The positive replies to `service` (first byte = service + 0x40); throws if every module refused. */
function positive(messages: EcuMessage[], service: number): EcuMessage[] {
  const ok = messages.filter((m) => m.data[0] === service + 0x40);
  if (ok.length === 0) {
    const neg = messages.find((m) => m.data[0] === 0x7f && m.data[1] === service);
    if (neg) throw new NegativeResponse(service, neg.data[2]);
  }
  return ok;
}

/** Engine first (7E8 or the lowest id), so single-answer values come from the engine computer. */
function enginePreferred(messages: EcuMessage[]): EcuMessage | undefined {
  return messages.find((m) => m.ecu === '7E8') ?? [...messages].sort((a, b) => a.ecu.localeCompare(b.ecu))[0];
}

/** Every service 01 PID any module supports. */
export async function supportedPids(elm: Elm327): Promise<number[]> {
  const all = new Set<number>();
  for (let base = 0; base <= 0xc0; base += 0x20) {
    let replies: EcuMessage[];
    try {
      replies = positive(await elm.request(`01${base.toString(16).padStart(2, '0')}`), 0x01);
    } catch (err) {
      if (err instanceof AdapterError || err instanceof NegativeResponse) break;
      throw err;
    }
    let more = false;
    for (const r of replies) {
      const pids = decodeSupported(base, r.data.slice(2, 6));
      pids.forEach((p) => all.add(p));
      if (pids.includes(base + 0x20)) more = true;
    }
    if (!more) break;
  }
  return [...all].filter((p) => p % 0x20 !== 0).sort((a, b) => a - b);
}

/**
 * Read several service 01 values. CAN cars accept up to six PIDs per request, which matters on
 * slow clone adapters; if a car rejects that, fall back to one at a time for the rest of the session.
 */
export class LiveReader {
  private elm: Elm327;
  private multi = true;
  constructor(elm: Elm327) {
    this.elm = elm;
  }

  async read(pids: number[]): Promise<Map<number, number>> {
    const values = new Map<number, number>();
    const known = pids.filter((p) => PID_BY_NUMBER.has(p));
    const isCan = this.elm.framing !== 'legacy';
    if (this.multi && isCan && known.length > 1) {
      try {
        for (let i = 0; i < known.length; i += 6) {
          const chunk = known.slice(i, i + 6);
          const cmd = '01' + chunk.map((p) => p.toString(16).padStart(2, '0')).join('');
          const reply = enginePreferred(positive(await this.elm.request(cmd), 0x01));
          if (!reply) continue;
          for (const [pid, bytes] of splitMultiReply(reply.data)) values.set(pid, PID_BY_NUMBER.get(pid)!.decode(bytes));
        }
        if (values.size > 0) return values;
      } catch {
        // fall through to single requests
      }
      this.multi = false;
    }
    for (const pid of known) {
      try {
        const reply = enginePreferred(positive(await this.elm.request(`01${pid.toString(16).padStart(2, '0')}`), 0x01));
        if (reply && reply.data[1] === pid) values.set(pid, PID_BY_NUMBER.get(pid)!.decode(reply.data.slice(2)));
      } catch (err) {
        if (!(err instanceof AdapterError) && !(err instanceof NegativeResponse)) throw err;
      }
    }
    return values;
  }
}

export type CodeKind = 'stored' | 'pending' | 'permanent';
export interface FoundCode {
  code: string;
  kind: CodeKind;
  ecu: string;
}

const CODE_SERVICES: [string, CodeKind][] = [
  ['03', 'stored'],
  ['07', 'pending'],
  ['0A', 'permanent'],
];

export async function readCodes(elm: Elm327): Promise<FoundCode[]> {
  await elm.setTarget(null);
  const found: FoundCode[] = [];
  for (const [svc, kind] of CODE_SERVICES) {
    let replies: EcuMessage[];
    try {
      replies = positive(await elm.request(svc), parseInt(svc, 16));
    } catch (err) {
      if (err instanceof AdapterError || err instanceof NegativeResponse) continue; // older cars lack 0A
      throw err;
    }
    for (const r of replies) {
      for (const code of parseDtcReply(r, elm.framing !== 'legacy')) found.push({ code, kind, ecu: r.ecu });
    }
  }
  return found;
}

/** Service 04. Returns the modules that confirmed; throws if every module refused. */
export async function clearCodes(elm: Elm327): Promise<string[]> {
  await elm.setTarget(null);
  const replies = positive(await elm.request('04', 10000), 0x04);
  return replies.map((r) => r.ecu);
}

export async function readReadiness(elm: Elm327): Promise<Readiness | null> {
  await elm.setTarget(null);
  const reply = enginePreferred(positive(await elm.request('0101'), 0x01));
  return reply ? decodeReadiness(reply.data.slice(2, 6)) : null;
}

export async function readVin(elm: Elm327): Promise<string | null> {
  await elm.setTarget(null);
  try {
    return parseVin(positive(await elm.request('0902', 8000), 0x09));
  } catch (err) {
    if (err instanceof AdapterError || err instanceof NegativeResponse) return null;
    throw err;
  }
}

export interface FreezeFrame {
  code: string | null;
  values: Map<number, number>;
}

/** Snapshot the engine computer saved when the first stored code set (service 02, frame 0). */
export async function readFreezeFrame(elm: Elm327): Promise<FreezeFrame | null> {
  await elm.setTarget(null);
  let codeReply: EcuMessage | undefined;
  try {
    codeReply = enginePreferred(positive(await elm.request('020200'), 0x02));
  } catch (err) {
    if (err instanceof AdapterError || err instanceof NegativeResponse) return null;
    throw err;
  }
  if (!codeReply || (codeReply.data[3] === 0 && codeReply.data[4] === 0)) return null;
  const frame: FreezeFrame = { code: decodeDtc(codeReply.data[3], codeReply.data[4]), values: new Map() };
  for (const pid of [0x05, 0x04, 0x0c, 0x0d, 0x11, 0x06, 0x07, 0x0b, 0x0f]) {
    try {
      const r = enginePreferred(positive(await elm.request(`02${pid.toString(16).padStart(2, '0')}00`), 0x02));
      if (r && r.data[1] === pid) frame.values.set(pid, PID_BY_NUMBER.get(pid)!.decode(r.data.slice(3)));
    } catch {
      // not every value is saved; skip it
    }
  }
  return frame;
}

/** Bytes after the echo: service 21 echoes 1 byte (the PID), service 22 echoes 2 (the data id). */
function echoLength(request: string): number {
  return Math.max(1, request.length / 2 - 1);
}

/** Read a carmaker-specific value from its module, then go back to broadcast. */
export async function readExtra(elm: Elm327, extra: ExtraPid): Promise<number> {
  const service = parseInt(extra.request.slice(0, 2), 16);
  await elm.setTarget(extra.module.request, extra.module.response);
  try {
    const replies = positive(await elm.request(extra.request), service);
    const reply = replies.find((r) => r.ecu === extra.module.response) ?? replies[0];
    if (!reply) throw new AdapterError('NO DATA', 'NO DATA');
    return evaluateFormula(extra.formula, reply.data.slice(1 + echoLength(extra.request)));
  } finally {
    await elm.setTarget(null);
  }
}
