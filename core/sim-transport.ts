import type { Transport } from './transport.ts';
import { FakeCar, FakeElm } from './emulator.ts';

/** The built-in simulator as a Transport: no adapter, no car, answers after a short delay. */
export class SimTransport implements Transport {
  readonly label = 'Simulator';
  onData: ((chunk: string) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  readonly elm: FakeElm;
  private line = '';
  private delayMs: number;
  private open_ = false;

  constructor(car: FakeCar = new FakeCar(), delayMs = 30) {
    this.elm = new FakeElm(car);
    this.delayMs = delayMs;
  }

  async open(): Promise<void> {
    this.open_ = true;
  }

  async write(text: string): Promise<void> {
    if (!this.open_) throw new Error('Simulator is closed');
    for (const ch of text) {
      if (ch === '\r') {
        const reply = this.elm.handle(this.line);
        this.line = '';
        setTimeout(() => this.onData?.(reply), this.delayMs);
      } else if (ch !== '\n') {
        this.line += ch;
      }
    }
  }

  async close(): Promise<void> {
    this.open_ = false;
    this.onClose?.('closed');
  }
}
