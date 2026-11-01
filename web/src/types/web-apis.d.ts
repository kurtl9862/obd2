// Just the parts of Web Serial and Web Bluetooth this app uses (not yet in TypeScript's DOM types).

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
}
interface Serial extends EventTarget {
  requestPort(options?: { filters?: SerialPortInfo[]; allowedBluetoothServiceClassIds?: string[] }): Promise<SerialPort>;
}

interface BluetoothCharacteristicProperties {
  readonly write: boolean;
  readonly writeWithoutResponse: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
}
interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value: DataView | null;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}
interface BluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}
interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}
interface BluetoothDevice extends EventTarget {
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}
interface Bluetooth {
  requestDevice(options: { acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<BluetoothDevice>;
}

interface Navigator {
  readonly serial?: Serial;
  readonly bluetooth?: Bluetooth;
}
