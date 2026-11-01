import type { Transport } from './transport.ts';
import { AdapterError, framingFor, parseResponse, type EcuMessage, type Framing } from './parse.ts';

export interface AdapterInfo {
  /** What ATI printed, e.g. "ELM327 v1.5". Clones often claim a version they don't fully implement. */
  version: string;
  /** ELM protocol number from AT DPN, without the "A" (auto) prefix: "6" = CAN 11-bit 500k. */
  protocol: string;
  protocolName: string;
}

export type LogEntry = { at: number; dir: 'tx' | 'rx' | 'info'; text: string };

export const PROTOCOL_NAMES: Record<string, string> = {
  '1': 'SAE J1850 PWM',
  '2': 'SAE J1850 VPW',
  '3': 'ISO 9141-2',
  '4': 'ISO 14230-4 KWP (5 baud init)',
  '5': 'ISO 14230-4 KWP (fast init)',
  '6': 'ISO 15765-4 CAN (11 bit, 500 kbaud)',
  '7': 'ISO 15765-4 CAN (29 bit, 500 kbaud)',
  '8': 'ISO 15765-4 CAN (11 bit, 250 kbaud)',
  '9': 'ISO 15765-4 CAN (29 bit, 250 kbaud)',
  A: 'SAE J1939 CAN',
};

/** OBD-II functional (broadcast) request ids per framing; ATSH puts these back after a module request. */
const BROADCAST: Record<Framing, string> = { can11: '7DF', can29: '18DB33F1', legacy: '686AF1' };

interface Pending {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Talks to an ELM327 (or STN, or clone) over any Transport. The adapter handles one command at a
 * time and ends every reply with a ">" prompt, so commands are queued and each waits for its prompt.
 */
export class Elm327 {
  private transport: Transport;
  private buffer = '';
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private header = '';
  private receiveFilter = '';
  private log: (entry: LogEntry) => void;
  framing: Framing = 'can11';
  info: AdapterInfo | null = null;

  constructor(transport: Transport, log: (entry: LogEntry) => void = () => {}) {
    this.transport = transport;
    this.log = log;
    transport.onData = (chunk) => this.receive(chunk);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const end = this.buffer.indexOf('>');
    if (end === -1) return;
    const text = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + 1);
    const p = this.pending;
    if (!p) return; // a stray prompt (e.g. after a reset); nothing is waiting
    this.pending = null;
    clearTimeout(p.timer);
    this.log({ at: Date.now(), dir: 'rx', text: text.trim().split(/[\r\n]+/).join('\n') });
    p.resolve(text);
  }

  /** Send one command and resolve with the adapter's raw reply (prompt and echo removed). */
  send(command: string, timeoutMs = 5000): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          this.buffer = '';
          reject(new AdapterError('TIMEOUT', `no reply to ${command} within ${timeoutMs / 1000}s`));
        }, timeoutMs);
        this.pending = {
          resolve: (text) => resolve(stripEcho(text, command)),
          reject,
          timer,
        };
        this.log({ at: Date.now(), dir: 'tx', text: command });
        this.transport.write(command + '\r').catch((err: Error) => {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        });
      });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  /** Reset the adapter and put it in the mode the parser expects. */
  async init(): Promise<AdapterInfo> {
    this.header = '';
    this.receiveFilter = '';
    // Some adapters are mid-command when we connect; any short command gets us a fresh prompt.
    // (Not a bare return: the ELM327 repeats the previous command on a bare return, which could
    // be a "clear codes" from the last session.)
    await this.send('ATI', 1500).catch(() => {});
    const version = (await this.send('ATZ', 4000)).replace(/[\r\n]+/g, ' ').trim();
    for (const cmd of ['ATE0', 'ATL0', 'ATS1', 'ATH1', 'ATAT1', 'ATSP0']) await this.send(cmd, 2000);
    // Any request makes the adapter search for the car's protocol; 0100 is answered by every car.
    try {
      await this.send('0100', 15000);
    } catch (err) {
      if (err instanceof AdapterError && err.code !== 'NO DATA') throw err;
    }
    const dpn = (await this.send('ATDPN', 2000)).trim().replace(/^A/, '');
    if (!/^[1-9A-C]$/.test(dpn) || dpn === '0') {
      throw new Error('The adapter could not find the car. Is the ignition on?');
    }
    this.framing = framingFor(dpn);
    this.info = { version, protocol: dpn, protocolName: PROTOCOL_NAMES[dpn] ?? `Protocol ${dpn}` };
    this.log({ at: Date.now(), dir: 'info', text: `Connected: ${this.info.protocolName}` });
    return this.info;
  }

  /** Address one module ("7E1" = transmission on most cars) or go back to broadcast with null. */
  async setTarget(request: string | null, response: string | null = null): Promise<void> {
    const h = request ?? BROADCAST[this.framing];
    if (h !== this.header) {
      await this.send(`ATSH${h}`, 2000);
      this.header = h;
    }
    const f = response ?? '';
    if (f !== this.receiveFilter) {
      // ATAR = back to the adapter's automatic receive filter.
      await this.send(f ? `ATCRA${f}` : 'ATAR', 2000);
      this.receiveFilter = f;
    }
  }

  /**
   * Send an OBD request (hex, e.g. "010C") and return each module's reply. Negative replies
   * (7F xx nn) come back as data, so callers can tell "refused" from "no answer".
   */
  async request(hexCommand: string, timeoutMs = 5000): Promise<EcuMessage[]> {
    const raw = await this.send(hexCommand.replace(/\s+/g, '').toUpperCase(), timeoutMs);
    return parseResponse(raw, this.framing);
  }

  /** Battery voltage measured by the adapter at the OBD port. */
  async voltage(): Promise<number | null> {
    const raw = await this.send('ATRV', 2000);
    const m = raw.match(/(\d+(?:\.\d+)?)\s*V?/i);
    return m ? Number(m[1]) : null;
  }

  /** Forget which module we think is addressed (after someone typed ATSH / ATCRA by hand). */
  forgetTarget(): void {
    this.header = '';
    this.receiveFilter = '?';
  }

  async close(): Promise<void> {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Disconnected'));
      this.pending = null;
    }
    await this.transport.close();
  }
}

/** With echo off this is a no-op; clones sometimes keep echoing, so drop a leading copy of the command. */
function stripEcho(text: string, command: string): string {
  const t = text.replace(/^[\r\n\s]+/, '');
  if (command && t.toUpperCase().startsWith(command.toUpperCase())) return t.slice(command.length);
  return t;
}
