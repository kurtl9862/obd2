import type { Transport } from '../../../core/transport.ts';

/**
 * USB adapters (OBDLink EX, vLinker FS, FTDI or CH340 cables) and paired Bluetooth Classic
 * adapters through Web Serial. Chrome and Edge only.
 */
export class SerialTransport implements Transport {
  readonly label = 'USB / Bluetooth serial';
  onData: ((chunk: string) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  private baudRate: number;
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private closing = false;

  constructor(baudRate: number) {
    this.baudRate = baudRate;
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.serial;
  }

  async open(): Promise<void> {
    if (!navigator.serial) throw new Error('This browser has no Web Serial. Use Chrome or Edge.');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: this.baudRate });
    this.port = port;
    void this.readLoop(port);
  }

  private async readLoop(port: SerialPort): Promise<void> {
    const decoder = new TextDecoder('latin1');
    try {
      while (port.readable) {
        this.reader = port.readable.getReader();
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.onData?.(decoder.decode(value));
        }
        this.reader.releaseLock();
        if (this.closing) break;
      }
    } catch (err) {
      if (!this.closing) this.onClose?.(`The adapter disconnected (${(err as Error).message})`);
      return;
    }
    if (!this.closing) this.onClose?.('The adapter disconnected');
  }

  async write(text: string): Promise<void> {
    const writable = this.port?.writable;
    if (!writable) throw new Error('Not connected');
    const writer = writable.getWriter();
    try {
      await writer.write(Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff));
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      // already gone
    }
    try {
      await this.port?.close();
    } catch {
      // already closed
    }
    this.port = null;
  }
}
