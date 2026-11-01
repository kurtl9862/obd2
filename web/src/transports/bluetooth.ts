import type { Transport } from '../../../core/transport.ts';

/**
 * Bluetooth Low Energy adapters through Web Bluetooth. There's no standard OBD service, so we ask
 * for the ones common adapters use and pick the first characteristic pair that can write and notify.
 */
const KNOWN_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // most clones (FFF1 notify, FFF2 write)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style modules (FFE1)
  '000018f0-0000-1000-8000-00805f9b34fb', // vLinker and others (2AF0 / 2AF1)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // OBDLink CX, Vgate iCar Pro
];

export class BluetoothTransport implements Transport {
  readonly label = 'Bluetooth LE';
  onData: ((chunk: string) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  private device: BluetoothDevice | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private closing = false;

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async open(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.');
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: KNOWN_SERVICES });
    if (!device.gatt) throw new Error('That device has no Bluetooth LE services');
    const server = await device.gatt.connect();
    let rx: BluetoothRemoteGATTCharacteristic | null = null;
    let tx: BluetoothRemoteGATTCharacteristic | null = null;
    for (const service of await server.getPrimaryServices()) {
      const chars = await service.getCharacteristics();
      const n = chars.find((c) => c.properties.notify || c.properties.indicate);
      const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (n && w) {
        rx = n;
        tx = w;
        break;
      }
    }
    if (!rx || !tx) {
      server.disconnect();
      throw new Error('Connected, but this device doesn’t look like an OBD adapter');
    }
    const decoder = new TextDecoder('latin1');
    rx.addEventListener('characteristicvaluechanged', () => {
      const v = rx!.value;
      if (v) this.onData?.(decoder.decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
    });
    await rx.startNotifications();
    device.addEventListener('gattserverdisconnected', () => {
      if (!this.closing) this.onClose?.('The Bluetooth adapter disconnected');
    });
    this.device = device;
    this.tx = tx;
  }

  async write(text: string): Promise<void> {
    if (!this.tx) throw new Error('Not connected');
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
    // BLE packets are small; send in 20-byte pieces, which every adapter accepts.
    for (let i = 0; i < bytes.length; i += 20) {
      const part = bytes.slice(i, i + 20);
      if (this.tx.properties.writeWithoutResponse) await this.tx.writeValueWithoutResponse(part);
      else await this.tx.writeValue(part);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.device?.gatt?.disconnect();
    this.device = null;
    this.tx = null;
  }
}
