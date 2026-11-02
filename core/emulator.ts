/**
 * A pretend car behind a pretend ELM327, for building and testing away from the truck.
 * Answers like a cheap clone on CAN 11-bit 500k: an engine computer on 7E8 and a transmission
 * computer on 7E9 with a couple of codes, a warming engine, and a transmission temperature block.
 * Used by the browser's simulator mode, the Mac helper's --sim flag and the tests.
 */

export interface FakeCarOptions {
  vin?: string;
  /** Milliseconds clock; tests pass a fixed one. */
  now?: () => number;
  /** False = ignition off: the adapter answers, the car doesn't. */
  ignitionOn?: boolean;
}

type Ecu = 'engine' | 'trans';

const SUPPORTED_00 = [0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x1f, 0x20];
const SUPPORTED_20 = [0x21, 0x2f, 0x31, 0x33, 0x40];
const SUPPORTED_40 = [0x42, 0x46, 0x49];

function bitmap(pids: number[], base: number): number[] {
  const out = [0, 0, 0, 0];
  for (const p of pids) {
    const i = p - base - 1;
    out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

function encodeDtc(code: string): [number, number] {
  const letter = 'PCBU'.indexOf(code[0]);
  const hi = (letter << 6) | (parseInt(code[1], 16) << 4) | parseInt(code[2], 16);
  return [hi, parseInt(code.slice(3), 16)];
}

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

export class FakeCar {
  vin: string;
  now: () => number;
  ignitionOn: boolean;
  private startedAt: number;
  stored: Record<Ecu, string[]> = { engine: ['P0420'], trans: ['P0744'] };
  pending: Record<Ecu, string[]> = { engine: ['P0171'], trans: [] };
  monitorsReset = false;
  private counter = 0;

  constructor(opts: FakeCarOptions = {}) {
    this.vin = opts.vin ?? '5N1AR1NB0AC600001';
    this.now = opts.now ?? (() => Date.now());
    this.ignitionOn = opts.ignitionOn ?? true;
    this.startedAt = this.now();
  }

  /** Seconds since "engine start". */
  private t(): number {
    return (this.now() - this.startedAt) / 1000;
  }

  private rpm(): number {
    return 750 + 1400 * Math.max(0, Math.sin(this.t() / 9)) + 120 * Math.sin(this.t() * 1.7);
  }
  private speed(): number {
    return Math.max(0, 70 * Math.sin(this.t() / 9));
  }
  rpmNow(): number {
    return this.rpm();
  }
  speedNow(): number {
    return this.speed();
  }
  coolantC(): number {
    return Math.min(90, 20 + this.t() * 0.6);
  }
  atfC(): number {
    return Math.min(85, 24 + this.t() * 0.35); // starts at the intake air temperature, like a parked car
  }

  /** Service 01 data bytes for one PID, or null if unsupported. */
  pid(pid: number): number[] | null {
    const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    switch (pid) {
      case 0x00: return bitmap(SUPPORTED_00, 0x00);
      case 0x20: return bitmap(SUPPORTED_20, 0x20);
      case 0x40: return bitmap(SUPPORTED_40, 0x40);
      case 0x01: return this.readiness();
      case 0x04: return [clamp(40 + 30 * Math.sin(this.t() / 9))];
      case 0x05: return [clamp(this.coolantC() + 40)];
      case 0x06: return [clamp(128 + 4 * Math.sin(this.t()))];
      case 0x07: return [clamp(128 + 6)];
      case 0x0b: return [clamp(35 + 40 * Math.max(0, Math.sin(this.t() / 9)))];
      case 0x0c: return u16(Math.round(this.rpm() * 4));
      case 0x0d: return [clamp(this.speed())];
      case 0x0e: return [clamp((12 + 64) * 2)];
      case 0x0f: return [clamp(24 + 40)];
      case 0x10: return u16(Math.round((3 + this.rpm() / 200) * 100));
      case 0x11: return [clamp(40 + 80 * Math.max(0, Math.sin(this.t() / 9)))];
      case 0x1f: return u16(Math.round(this.t()));
      case 0x21: return u16(this.stored.engine.length ? 112 : 0);
      case 0x2f: return [clamp(255 * 0.62)];
      case 0x31: return u16(this.monitorsReset ? 0 : 4210);
      case 0x33: return [101];
      case 0x42: return u16(Math.round(14.1 * 1000));
      case 0x46: return [clamp(18 + 40)];
      case 0x49: return [clamp(30 + 60 * Math.max(0, Math.sin(this.t() / 9)))];
      default: return null;
    }
  }

  private readiness(): number[] {
    const codes = this.stored.engine.length + this.stored.trans.length;
    const A = (codes > 0 ? 0x80 : 0) | (codes & 0x7f);
    const B = 0x07; // misfire, fuel system, components: available and complete
    const C = 0b01100101; // catalyst, evap, O2 sensor, O2 heater
    const D = this.monitorsReset ? C : 0b00000100; // evap incomplete normally; everything after a clear
    return [A, B, C, D];
  }

  clear(): void {
    this.stored = { engine: [], trans: [] };
    this.pending = { engine: [], trans: [] };
    this.monitorsReset = true;
  }

  /** Full reply for one module (service byte first), or null for no answer. */
  answer(ecu: Ecu, req: number[]): number[] | null {
    const svc = req[0];
    if (ecu === 'trans') return this.transAnswer(req);
    switch (svc) {
      case 0x01: {
        const out = [0x41];
        for (const pid of req.slice(1, 7)) {
          const d = this.pid(pid);
          if (d) out.push(pid, ...d);
        }
        return out.length > 1 ? out : null;
      }
      case 0x02: {
        const [pid, frame = 0] = req.slice(1);
        if (!this.stored.engine.length) return pid === 0x02 ? [0x42, 0x02, frame, 0, 0] : null;
        if (pid === 0x02) return [0x42, 0x02, frame, ...encodeDtc(this.stored.engine[0])];
        const d = this.pid(pid);
        return d ? [0x42, pid, frame, ...d] : null;
      }
      case 0x03: return this.codesReply(0x43, this.stored.engine);
      case 0x07: return this.codesReply(0x47, this.pending.engine);
      case 0x0a: return [0x4a, 0x00];
      case 0x04: this.clear(); return [0x44];
      case 0x09:
        if (req[1] === 0x00) return [0x49, 0x00, 0x54, 0x40, 0x00, 0x00];
        if (req[1] === 0x02) return [0x49, 0x02, 0x01, ...[...this.vin].map((c) => c.charCodeAt(0))];
        return null;
      default:
        return [0x7f, svc, 0x11];
    }
  }

  private transAnswer(req: number[]): number[] | null {
    const svc = req[0];
    const atfRaw = Math.round(this.atfC() + 55);
    switch (svc) {
      case 0x01: return req[1] === 0x00 ? [0x41, 0x00, 0x80, 0x00, 0x00, 0x00] : null;
      case 0x03: return this.codesReply(0x43, this.stored.trans);
      case 0x07: return this.codesReply(0x47, this.pending.trans);
      case 0x0a: return [0x4a, 0x00];
      case 0x04: return [0x44];
      case 0x21:
        if (req[1] === 0x01) {
          // A made-up 40-byte data block: byte 30 (AD) tracks the fluid temperature, byte 5 is a
          // rolling counter and byte 8 follows engine speed, so the explorer has decoys to reject.
          const block = Array.from({ length: 40 }, (_, i) => (i * 37) & 0xff);
          block[29] = this.transBlockTempByte();
          block[4] = this.counter++ & 0xff;
          block[7] = Math.round(this.rpmNow() / 32) & 0xff;
          return [0x61, 0x01, ...block];
        }
        if (req[1] === 0x02) return [0x61, 0x02, 0x12, 0x34, Math.round(this.speedNow()), 0x00];
        if (req[1] === 0x20) return [0x61, 0x20, atfRaw];
        return [0x7f, 0x21, 0x12];
      default:
        return [0x7f, svc, 0x11];
    }
  }

  /** Byte AD of the 2101 block: the fluid temperature as the transmission computer encodes it. */
  protected transBlockTempByte(): number {
    return Math.round(this.atfC() + 40);
  }

  private codesReply(svc: number, codes: string[]): number[] {
    return [svc, codes.length, ...codes.flatMap(encodeDtc)];
  }
}

/** The adapter half: AT commands, headers, framing, prompts. Feed it one command at a time. */
export class FakeElm {
  car: FakeCar;
  private echo = true;
  private headers = false;
  private spaces = true;
  private linefeeds = false;
  private header = '7DF';
  private filter = '';
  private searched = false;
  private last = '';

  constructor(car: FakeCar = new FakeCar()) {
    this.car = car;
  }

  /** Reply to one command line (without the trailing \r), ending with the ">" prompt. */
  handle(line: string): string {
    let cmd = line.replace(/\s+/g, '').toUpperCase();
    if (cmd === '') cmd = this.last; // the real chip repeats the last command on a bare return
    this.last = cmd;
    const body = cmd.startsWith('AT') ? this.at(cmd.slice(2)) : this.obd(cmd);
    const nl = this.linefeeds ? '\r\n' : '\r';
    const echoed = this.echo ? line + nl : '';
    return echoed + body.split('\r').join(nl) + nl + nl + '>';
  }

  private at(c: string): string {
    if (c === 'Z') {
      this.echo = true;
      this.headers = false;
      this.spaces = true;
      this.header = '7DF';
      this.filter = '';
      this.searched = false;
      return '\rELM327 v1.5';
    }
    if (c === 'I') return 'ELM327 v1.5';
    if (c === '@1') return 'OBDII to RS232 Interpreter';
    if (c === 'RV') return this.car.ignitionOn ? '14.1V' : '12.4V';
    if (c === 'DPN') return this.searched ? 'A6' : 'A0';
    if (c === 'DP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
    const flag = c.match(/^(E|H|S|L)([01])$/);
    if (flag) {
      const on = flag[2] === '1';
      if (flag[1] === 'E') this.echo = on;
      if (flag[1] === 'H') this.headers = on;
      if (flag[1] === 'S') this.spaces = on;
      if (flag[1] === 'L') this.linefeeds = on;
      return 'OK';
    }
    if (/^AT[012]$/.test(c) || /^SP[0-9A-C]$/.test(c) || /^ST[0-9A-F]{2}$/.test(c) || c === 'D' || c === 'WS') {
      if (c === 'WS' || c === 'D') this.header = '7DF';
      return 'OK';
    }
    if (c.startsWith('SH') && /^SH([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/.test(c)) {
      this.header = c.slice(2);
      return 'OK';
    }
    if (c.startsWith('CRA')) {
      this.filter = c.slice(3);
      return 'OK';
    }
    if (c === 'AR') {
      this.filter = '';
      return 'OK';
    }
    return '?';
  }

  private obd(cmd: string): string {
    if (!/^([0-9A-F]{2})+$/.test(cmd)) return '?';
    const prefix = this.searched ? '' : 'SEARCHING...\r';
    if (!this.car.ignitionOn) return prefix + 'UNABLE TO CONNECT';
    this.searched = true;
    const req = cmd.match(/../g)!.map((h) => parseInt(h, 16));

    const targets: [string, 'engine' | 'trans'][] =
      this.header === '7DF' ? [['7E8', 'engine'], ['7E9', 'trans']] : this.header === '7E0' ? [['7E8', 'engine']] : this.header === '7E1' ? [['7E9', 'trans']] : [];
    const lines: string[] = [];
    for (const [id, ecu] of targets) {
      if (this.filter && this.filter !== id) continue;
      const reply = this.car.answer(ecu, req);
      // Broadcast: modules stay quiet about services they don't support (but still refuse
      // things they do support, like a security gateway refusing to clear codes).
      if (!reply || (this.header === '7DF' && reply[0] === 0x7f && (reply[2] === 0x11 || reply[2] === 0x12))) continue;
      lines.push(...this.frames(id, reply));
    }
    return prefix + (lines.length ? lines.join('\r') : 'NO DATA');
  }

  /** ISO-TP framing as the ELM prints it, padded to eight bytes like most modules do. */
  private frames(id: string, data: number[]): string[] {
    const sep = this.spaces ? ' ' : '';
    const pad = (bytes: number[]) => [...bytes, ...Array(Math.max(0, 8 - bytes.length)).fill(0x55)];
    const fmt = (bytes: number[]) => (this.headers ? id + sep : '') + bytes.map(hex2).join(sep);
    if (data.length <= 7) return [fmt(this.headers ? pad([data.length, ...data]) : data)];

    if (!this.headers) {
      // Headers off: total length, then numbered lines.
      const out = [data.length.toString(16).toUpperCase().padStart(3, '0')];
      const rest = [...data];
      out.push('0:' + sep + rest.splice(0, 6).map(hex2).join(sep));
      for (let n = 1; rest.length; n++) out.push(`${(n % 16).toString(16).toUpperCase()}:` + sep + rest.splice(0, 7).map(hex2).join(sep));
      return out;
    }
    const out = [fmt([0x10 | (data.length >> 8), data.length & 0xff, ...data.slice(0, 6)])];
    for (let i = 6, n = 1; i < data.length; i += 7, n++) out.push(fmt(pad([0x20 | (n % 16), ...data.slice(i, i + 7)])));
    return out;
  }
}
