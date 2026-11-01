/**
 * Standard OBD-II service 01 values (SAE J1979). Every value decodes to metric; the UI converts.
 * `bytes` is the data after the "41 xx" echo.
 */

export type Unit = '' | '°C' | 'km/h' | 'rpm' | '%' | 'kPa' | 'g/s' | 'V' | '°' | 's' | 'km' | 'L/h' | 'λ' | 'min' | 'L/100km';

export interface PidDef {
  pid: number;
  name: string;
  short: string;
  unit: Unit;
  /** How many data bytes the reply carries; lets several values share one request on CAN. */
  bytes: number;
  min: number;
  max: number;
  decode: (b: number[]) => number;
}

const A = (b: number[]) => b[0];
const AB = (b: number[]) => b[0] * 256 + b[1];
const pct = (b: number[]) => (b[0] * 100) / 255;
const temp = (b: number[]) => b[0] - 40;
const trim = (b: number[]) => (b[0] - 128) * (100 / 128);

export const PIDS: PidDef[] = [
  { pid: 0x04, name: 'Engine load', short: 'Load', unit: '%', bytes: 1, min: 0, max: 100, decode: pct },
  { pid: 0x05, name: 'Coolant temperature', short: 'Coolant', unit: '°C', bytes: 1, min: -40, max: 130, decode: temp },
  { pid: 0x06, name: 'Short-term fuel trim, bank 1', short: 'STFT B1', unit: '%', bytes: 1, min: -25, max: 25, decode: trim },
  { pid: 0x07, name: 'Long-term fuel trim, bank 1', short: 'LTFT B1', unit: '%', bytes: 1, min: -25, max: 25, decode: trim },
  { pid: 0x08, name: 'Short-term fuel trim, bank 2', short: 'STFT B2', unit: '%', bytes: 1, min: -25, max: 25, decode: trim },
  { pid: 0x09, name: 'Long-term fuel trim, bank 2', short: 'LTFT B2', unit: '%', bytes: 1, min: -25, max: 25, decode: trim },
  { pid: 0x0a, name: 'Fuel pressure', short: 'Fuel press', unit: 'kPa', bytes: 1, min: 0, max: 765, decode: (b) => b[0] * 3 },
  { pid: 0x0b, name: 'Intake manifold pressure', short: 'MAP', unit: 'kPa', bytes: 1, min: 0, max: 255, decode: A },
  { pid: 0x0c, name: 'Engine speed', short: 'RPM', unit: 'rpm', bytes: 2, min: 0, max: 7000, decode: (b) => AB(b) / 4 },
  { pid: 0x0d, name: 'Vehicle speed', short: 'Speed', unit: 'km/h', bytes: 1, min: 0, max: 200, decode: A },
  { pid: 0x0e, name: 'Ignition timing advance', short: 'Timing', unit: '°', bytes: 1, min: -64, max: 64, decode: (b) => b[0] / 2 - 64 },
  { pid: 0x0f, name: 'Intake air temperature', short: 'Intake air', unit: '°C', bytes: 1, min: -40, max: 100, decode: temp },
  { pid: 0x10, name: 'Mass airflow', short: 'MAF', unit: 'g/s', bytes: 2, min: 0, max: 300, decode: (b) => AB(b) / 100 },
  { pid: 0x11, name: 'Throttle position', short: 'Throttle', unit: '%', bytes: 1, min: 0, max: 100, decode: pct },
  { pid: 0x1f, name: 'Run time since start', short: 'Run time', unit: 's', bytes: 2, min: 0, max: 65535, decode: AB },
  { pid: 0x21, name: 'Distance with check-engine light on', short: 'Dist MIL', unit: 'km', bytes: 2, min: 0, max: 65535, decode: AB },
  { pid: 0x2f, name: 'Fuel level', short: 'Fuel', unit: '%', bytes: 1, min: 0, max: 100, decode: pct },
  { pid: 0x30, name: 'Warm-ups since codes cleared', short: 'Warm-ups', unit: '', bytes: 1, min: 0, max: 255, decode: A },
  { pid: 0x31, name: 'Distance since codes cleared', short: 'Dist clear', unit: 'km', bytes: 2, min: 0, max: 65535, decode: AB },
  { pid: 0x33, name: 'Barometric pressure', short: 'Baro', unit: 'kPa', bytes: 1, min: 0, max: 255, decode: A },
  { pid: 0x3c, name: 'Catalyst temperature, bank 1', short: 'Cat B1', unit: '°C', bytes: 2, min: -40, max: 1000, decode: (b) => AB(b) / 10 - 40 },
  { pid: 0x42, name: 'Control module voltage', short: 'ECU volts', unit: 'V', bytes: 2, min: 0, max: 16, decode: (b) => AB(b) / 1000 },
  { pid: 0x43, name: 'Absolute load', short: 'Abs load', unit: '%', bytes: 2, min: 0, max: 200, decode: (b) => (AB(b) * 100) / 255 },
  { pid: 0x44, name: 'Commanded air-fuel ratio', short: 'Cmd λ', unit: 'λ', bytes: 2, min: 0.5, max: 1.5, decode: (b) => (2 / 65536) * AB(b) },
  { pid: 0x45, name: 'Relative throttle position', short: 'Rel throttle', unit: '%', bytes: 1, min: 0, max: 100, decode: pct },
  { pid: 0x46, name: 'Outside air temperature', short: 'Outside', unit: '°C', bytes: 1, min: -40, max: 60, decode: temp },
  { pid: 0x49, name: 'Accelerator pedal position', short: 'Pedal', unit: '%', bytes: 1, min: 0, max: 100, decode: pct },
  { pid: 0x4c, name: 'Commanded throttle', short: 'Cmd throttle', unit: '%', bytes: 1, min: 0, max: 100, decode: pct },
  { pid: 0x4d, name: 'Time with check-engine light on', short: 'Time MIL', unit: 'min', bytes: 2, min: 0, max: 65535, decode: AB },
  { pid: 0x4e, name: 'Time since codes cleared', short: 'Time clear', unit: 'min', bytes: 2, min: 0, max: 65535, decode: AB },
  { pid: 0x5c, name: 'Engine oil temperature', short: 'Oil', unit: '°C', bytes: 1, min: -40, max: 150, decode: temp },
  { pid: 0x5e, name: 'Fuel rate', short: 'Fuel rate', unit: 'L/h', bytes: 2, min: 0, max: 50, decode: (b) => AB(b) / 20 },
];

export const PID_BY_NUMBER = new Map(PIDS.map((p) => [p.pid, p]));

/** Shown first on the dashboard when the car supports them. */
export const DEFAULT_DASHBOARD = [0x0c, 0x0d, 0x05, 0x04, 0x11, 0x0f, 0x10, 0x06, 0x07, 0x2f, 0x42];

/**
 * Supported-PID bitmaps: PID 00 covers 01-20, 20 covers 21-40, and so on. Each reply is four bytes,
 * most significant bit first; the last bit says whether the next range exists.
 */
export function decodeSupported(base: number, bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    const byte = bytes[i >> 3] ?? 0;
    if (byte & (0x80 >> (i & 7))) out.push(base + i + 1);
  }
  return out;
}

/**
 * Split a reply to a multi-PID request ("41 0C 1A F8 0D 32 05 7B") into values. Needs every
 * PID's byte count; returns what it could read if the reply is short.
 */
export function splitMultiReply(data: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let i = data[0] === 0x41 ? 1 : 0;
  while (i < data.length) {
    const def = PID_BY_NUMBER.get(data[i]);
    if (!def || i + 1 + def.bytes > data.length) break;
    out.set(def.pid, data.slice(i + 1, i + 1 + def.bytes));
    i += 1 + def.bytes;
  }
  return out;
}
