import type { Transport } from './transport.ts';

/** The Mac helper's WebSocket (bridge/bridge.ts), which relays to a Wi-Fi adapter. */
export class WebSocketTransport implements Transport {
  readonly label = 'Wi-Fi via Mac helper';
  onData: ((chunk: string) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  private url: string;
  private ws: WebSocket | null = null;

  constructor(url: string) {
    this.url = url;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onmessage = (e) => this.onData?.(String(e.data));
      ws.onclose = (e) => {
        this.ws = null;
        const reason = e.reason || (opened ? 'The Mac helper closed the connection' : `Can't reach the Mac helper at ${this.url}. Is it running?`);
        if (!opened) reject(new Error(reason));
        else this.onClose?.(reason);
      };
    });
  }

  async write(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to the Mac helper');
    this.ws.send(text);
  }

  async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}
