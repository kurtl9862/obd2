/**
 * Demo mode: a made-up car for each saved vehicle, driven through a scenario you pick (cold start,
 * city, highway, towing uphill). Built on the simulator's FakeCar, so every screen talks to it
 * through the real ELM327 driver; only the numbers are invented. Also generates sample drives for
 * the Logs screen with the same physics.
 */

import { FakeCar } from './emulator.ts';
import { evaluateFormula } from './formula.ts';
import type { ExtraPid } from './vehicles.ts';

export type DemoScenario = 'cold' | 'city' | 'highway' | 'towing';

export const DEMO_SCENARIOS: { value: DemoScenario; label: string; hint: string }[] = [
  { value: 'cold', label: 'Cold start', hint: 'Parked overnight: idles, then drives across town while everything warms up.' },
  { value: 'city', label: 'City', hint: 'Stop-and-go traffic with lights every minute or so.' },
  { value: 'highway', label: 'Highway', hint: 'Steady cruising around 68 mph.' },
  { value: 'towing', label: 'Towing uphill', hint: 'A long grade with a trailer: transmission temperature climbs past the warning limit.' },
];

interface DemoVehicle {
  vin: string;
  stored: { engine: string[]; trans: string[] };
  pending: { engine: string[]; trans: string[] };
  /** False for cars that run the transmission from the engine computer (the Civic). */
  hasTrans: boolean;
  /** The security gateway on 2020+ Nissans refuses to clear codes. */
  refuseClear: boolean;
  idleRpm: number;
  /** Extra rpm per km/h above idle (gearing). */
  rpmPerKmh: number;
  mpgCity: number;
  mpgHighway: number;
  /** Fuel flow at idle, L/h. */
  idleLph: number;
  /** Long-term fuel trim, %. The Pathfinder runs lean (it has P0171/P0174). */
  ltft: number;
  fuelLevel: number;
  /** Warm transmission temperature on the highway, °C. */
  transWarmC: number;
  /** How the transmission computer encodes temperature in byte AD of the 2101 block. */
  transBlockByte?: (c: number) => number;
}

/** Nearest byte for a formula of AD (the Sentra's CVT polynomial). */
function inverseByte(formula: string, c: number, index = 29): number {
  let best = 0;
  let bestErr = Infinity;
  for (let b = 0; b < 256; b++) {
    const bytes = new Array(index + 1).fill(0);
    bytes[index] = b;
    const err = Math.abs(evaluateFormula(formula, bytes) - c);
    if (err < bestErr) {
      bestErr = err;
      best = b;
    }
  }
  return best;
}

const SENTRA_CVT = '0.000000002344*AD^5 - 0.000001387*AD^4 + 0.0003193*AD^3 - 0.03501*AD^2 + 2.302*AD - 36.6';

export const DEMO_VEHICLES: Record<string, DemoVehicle> = {
  'pathfinder-2010': {
    vin: '5N1AR1NB7AC618342',
    stored: { engine: ['P0420'], trans: ['P0744'] },
    pending: { engine: ['P0171', 'P0174'], trans: [] },
    hasTrans: true,
    refuseClear: false,
    idleRpm: 680,
    rpmPerKmh: 13,
    mpgCity: 15,
    mpgHighway: 20,
    idleLph: 2.4,
    ltft: 13.3,
    fuelLevel: 58,
    transWarmC: 82,
  },
  'civic-2020': {
    vin: '2HGFC2F61LH524817',
    stored: { engine: ['P0456'], trans: [] },
    pending: { engine: ['P0135'], trans: [] },
    hasTrans: false,
    refuseClear: false,
    idleRpm: 720,
    rpmPerKmh: 11,
    mpgCity: 30,
    mpgHighway: 38,
    idleLph: 0.9,
    ltft: 1.6,
    fuelLevel: 71,
    transWarmC: 86,
  },
  'sentra-2020': {
    vin: '3N1AB8CVXLY284156',
    stored: { engine: ['P0507'], trans: ['P17F0'] },
    pending: { engine: [], trans: ['P0841'] },
    hasTrans: true,
    refuseClear: true,
    idleRpm: 650,
    rpmPerKmh: 10.5,
    mpgCity: 29,
    mpgHighway: 37,
    idleLph: 0.8,
    ltft: -2.3,
    fuelLevel: 34,
    transWarmC: 84,
    transBlockByte: (c) => inverseByte(SENTRA_CVT, c),
  },
  other: {
    vin: '1FTEW1EG7FF731205',
    stored: { engine: ['P0300'], trans: [] },
    pending: { engine: ['P0301', 'P0306'], trans: [] },
    hasTrans: true,
    refuseClear: false,
    idleRpm: 640,
    rpmPerKmh: 12,
    mpgCity: 17,
    mpgHighway: 23,
    idleLph: 2.0,
    ltft: 3.1,
    fuelLevel: 46,
    transWarmC: 80,
  },
};

/**
 * The Civic has no public CVT temperature yet; in the demo it shows one as if the Explorer had
 * found it, so the tile and logs can be tried. Clearly labelled: the data id is made up.
 */
export const CIVIC_DEMO_EXTRA: ExtraPid = {
  id: 'demo-civic-cvt',
  name: 'CVT fluid temperature (demo value)',
  short: 'CVT',
  module: { name: 'Engine and CVT', request: '7E0', response: '7E8' },
  request: '22F0A1',
  formula: 'A-40',
  unit: '°C',
  min: -40,
  max: 150,
  warnHigh: 105,
  verified: false,
  source: 'Made up for demo mode. The real data id is still to be found with the Explorer.',
};

const MPH_TO_L100 = (mpg: number) => 235.215 / mpg;
const smooth = (x: number) => x * x * (3 - 2 * x);

/** A pretend car that follows a scenario, with temperatures that warm up and cool down over time. */
export class DemoCar extends FakeCar {
  readonly profile: DemoVehicle;
  scenario: DemoScenario;
  private scenarioStart: number;
  private last: number;
  private coolant: number;
  private atf: number;
  private fuel: number;
  /** Intake air: outside temperature, plus heat soak when stopped with a warm engine. */
  private iat = 22;
  private kmSinceClear = 2618;
  private runSeconds = 0;

  constructor(vehicleId: string, scenario: DemoScenario = 'city', now: () => number = () => Date.now()) {
    const profile = DEMO_VEHICLES[vehicleId] ?? DEMO_VEHICLES.other;
    super({ vin: profile.vin, now });
    this.profile = profile;
    this.stored = { engine: [...profile.stored.engine], trans: [...profile.stored.trans] };
    this.pending = { engine: [...profile.pending.engine], trans: [...profile.pending.trans] };
    this.scenario = scenario;
    this.scenarioStart = now();
    this.last = now();
    this.fuel = profile.fuelLevel;
    const cold = scenario === 'cold';
    this.coolant = cold ? 11 : 88;
    this.atf = cold ? 11 : profile.transWarmC - 6;
  }

  setScenario(s: DemoScenario): void {
    this.step();
    this.scenario = s;
    this.scenarioStart = this.now();
    if (s === 'cold') {
      this.coolant = 11;
      this.atf = 11;
      this.runSeconds = 0;
    }
  }

  /** Seconds into the current scenario. */
  private st(): number {
    return (this.now() - this.scenarioStart) / 1000;
  }

  private targetSpeedAt(t: number): number {
    switch (this.scenario) {
      case 'cold':
        // A minute of idling in the driveway, then town.
        return t < 60 ? 0 : this.citySpeed(t - 60);
      case 'city':
        return this.citySpeed(t);
      case 'highway':
        return 109 + 4 * Math.sin(t / 23) + 1.5 * Math.sin(t / 6.5);
      case 'towing':
        return Math.min(88, t * 4) + 3 * Math.sin(t / 19);
    }
  }

  /** Stop-and-go: a 75-second block per traffic light, cruising speed varying light to light. */
  private citySpeed(t: number): number {
    const cycle = 75;
    const n = Math.floor(t / cycle);
    const p = t - n * cycle;
    const cruise = 48 + 14 * Math.sin(n * 2.1);
    if (p < 12) return 0;
    if (p < 24) return cruise * smooth((p - 12) / 12);
    if (p < 58) return cruise + 3 * Math.sin(p / 3);
    if (p < 68) return cruise * (1 - smooth((p - 58) / 10));
    return 0;
  }

  /** Vehicle speed, km/h. */
  override speedNow(): number {
    return Math.max(0, this.targetSpeedAt(this.st()));
  }

  /** km/h per second, positive when speeding up. */
  private accel(): number {
    const t = this.st();
    return this.targetSpeedAt(t + 0.5) - this.targetSpeedAt(t - 0.5);
  }

  override rpmNow(): number {
    const v = this.speedNow();
    const t = this.st();
    // Cold engines idle high until the coolant warms up.
    const idle = this.profile.idleRpm + Math.max(0, 450 * (1 - (this.coolant - 11) / 50));
    if (v < 1) return idle + 15 * Math.sin(t * 2.3);
    const grade = this.scenario === 'towing' ? 1.32 : 1;
    return idle + v * this.profile.rpmPerKmh * grade + Math.max(0, this.accel()) * 160 + 25 * Math.sin(t * 1.9);
  }

  /** Calculated engine load, %. */
  load(): number {
    const v = this.speedNow();
    if (v < 1) return 21 + 2 * Math.sin(this.st());
    const a = this.accel();
    if (this.scenario === 'towing') return 78 + 6 * Math.sin(this.st() / 7);
    if (a < -1) return 12;
    return Math.min(95, 26 + v * 0.13 + Math.max(0, a) * 7);
  }

  throttle(): number {
    return this.speedNow() < 1 ? 15 : Math.min(90, 14 + this.load() * 0.62);
  }

  /** Fuel flow, L/h, from the car's real-world mpg so the economy numbers look familiar. */
  fuelLph(): number {
    const v = this.speedNow();
    const p = this.profile;
    if (v < 1) return p.idleLph * (this.coolant < 60 ? 1.4 : 1);
    if (this.accel() < -1) return p.idleLph * 0.4; // coasting: fuel cut
    const mpg =
      this.scenario === 'towing' ? p.mpgCity * 0.62 : this.scenario === 'highway' ? p.mpgHighway : p.mpgCity * 1.15;
    const base = (MPH_TO_L100(mpg) * v) / 100;
    return base * (1 + Math.max(0, this.accel()) * 0.12) + 0.4 * Math.sin(this.st() / 2.7);
  }

  /** Mass airflow, g/s, matching the fuel flow at 14.7:1 (gasoline weighs 0.74 kg/L). */
  maf(): number {
    return Math.max(1.5, (this.fuelLph() * 740 * 14.7) / 3600);
  }

  private step(): void {
    const now = this.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 120); // tab was asleep: don't jump
    const p = this.profile;
    const towing = this.scenario === 'towing';
    const moving = this.speedNow() > 1;
    const coolTarget = towing ? 101 : this.scenario === 'highway' ? 89 : 92;
    const atfTarget = towing ? 114 : this.scenario === 'highway' ? p.transWarmC : moving ? p.transWarmC - 3 : p.transWarmC - 8;
    // Demo time runs fast: minutes of warm-up instead of a quarter hour.
    this.coolant += (coolTarget - this.coolant) * (1 - Math.exp(-dt / (this.coolant < 70 ? 110 : 60)));
    this.atf += (atfTarget - this.atf) * (1 - Math.exp(-dt / (towing ? 140 : 200)));
    this.fuel = Math.max(4, this.fuel - (this.fuelLph() * dt) / 3600 / 0.7); // ~70 L tank
    this.kmSinceClear += (this.speedNow() * dt) / 3600;
    this.runSeconds += dt;
    const soak = moving ? 3 : Math.max(0, (this.coolant - 40) / 50) * 12;
    this.iat += (22 + soak - this.iat) * (1 - Math.exp(-dt / 45));
  }

  override coolantC(): number {
    this.step();
    return this.coolant;
  }

  override atfC(): number {
    this.step();
    return this.atf;
  }

  /** Every live value in metric, keyed by service 01 PID, plus extras. Used for sample drives. */
  snapshot(): Record<string, number> {
    this.step();
    const t = this.st();
    return {
      '12': this.rpmNow(),
      '13': this.speedNow(),
      '5': this.coolant,
      '4': this.load(),
      '17': this.throttle(),
      '15': this.iat,
      '16': this.maf(),
      '6': 1.5 * Math.sin(t * 1.3),
      '7': this.profile.ltft,
      '47': this.fuel,
      '66': 14.1 + 0.08 * Math.sin(t / 5),
      volts: 14.1 + 0.08 * Math.sin(t / 5),
      lph: this.fuelLph(),
      atf: this.atf,
    };
  }

  override pid(pid: number): number[] | null {
    this.step();
    const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const t = this.st();
    switch (pid) {
      case 0x04: return [clamp((this.load() * 255) / 100)];
      case 0x05: return [clamp(this.coolant + 40)];
      case 0x06: return [clamp(128 + (1.5 * Math.sin(t * 1.3) * 128) / 100)];
      case 0x07: return [clamp(128 + (this.profile.ltft * 128) / 100)];
      case 0x0b: return [clamp(30 + this.load() * 0.7)];
      case 0x0c: return u16(Math.round(this.rpmNow() * 4));
      case 0x0d: return [clamp(this.speedNow())];
      case 0x0e: return [clamp((14 - this.load() * 0.08 + 64) * 2)];
      case 0x0f: return [clamp(this.iat + 40)];
      case 0x10: return u16(Math.round(this.maf() * 100));
      case 0x11: return [clamp((this.throttle() * 255) / 100)];
      case 0x1f: return u16(Math.round(this.runSeconds));
      case 0x2f: return [clamp((this.fuel * 255) / 100)];
      case 0x31: return u16(this.monitorsReset ? Math.round(this.kmSinceClear - 2618) : Math.round(this.kmSinceClear));
      case 0x42: return u16(Math.round((14.1 + 0.08 * Math.sin(t / 5)) * 1000));
      case 0x46: return [clamp(22 + 40)];
      case 0x49: return [clamp(15 + this.throttle() * 0.8)];
      default: return super.pid(pid);
    }
  }

  protected override transBlockTempByte(): number {
    const c = this.atfC();
    return this.profile.transBlockByte ? this.profile.transBlockByte(c) : Math.round(c + 40);
  }

  override answer(ecu: 'engine' | 'trans', req: number[]): number[] | null {
    const svc = req[0];
    if (ecu === 'trans' && !this.profile.hasTrans) return null;
    if (svc === 0x04 && this.profile.refuseClear) return [0x7f, 0x04, 0x33];
    if (ecu === 'engine' && svc === 0x22) {
      // The Civic's made-up CVT temperature (see CIVIC_DEMO_EXTRA).
      if (req[1] === 0xf0 && req[2] === 0xa1 && !this.profile.hasTrans) return [0x62, 0xf0, 0xa1, Math.round(this.atfC() + 40)];
      return [0x7f, 0x22, 0x31];
    }
    return super.answer(ecu, req);
  }
}

export interface DemoDriveData {
  columns: { key: string; name: string; unit: string }[];
  /** [ms since start, ...one value per column] */
  rows: (number | null)[][];
}

/**
 * A sample drive for the Logs screen: runs a DemoCar on a fake clock through the given legs,
 * one row per second, with a made-up GPS track that follows the speed.
 */
export function simulateDrive(
  vehicleId: string,
  legs: [DemoScenario, number][],
  extraId: string | null,
  extraName: string,
  start: { lat: number; lon: number; heading: number },
): DemoDriveData {
  let clock = 0;
  const car = new DemoCar(vehicleId, legs[0][0], () => clock);
  const columns = [
    ...(extraId ? [{ key: extraId, name: extraName, unit: '°C' }] : []),
    { key: 'economy', name: 'Fuel economy (instant)', unit: 'L/100km' },
    { key: '12', name: 'Engine speed', unit: 'rpm' },
    { key: '13', name: 'Vehicle speed', unit: 'km/h' },
    { key: '5', name: 'Coolant temperature', unit: '°C' },
    { key: '4', name: 'Engine load', unit: '%' },
    { key: '17', name: 'Throttle position', unit: '%' },
    { key: '15', name: 'Intake air temperature', unit: '°C' },
    { key: '16', name: 'Mass airflow', unit: 'g/s' },
    { key: '6', name: 'Short-term fuel trim, bank 1', unit: '%' },
    { key: '7', name: 'Long-term fuel trim, bank 1', unit: '%' },
    { key: '47', name: 'Fuel level', unit: '%' },
    { key: '66', name: 'Control module voltage', unit: 'V' },
    { key: 'volts', name: 'Battery at the OBD port', unit: 'V' },
    { key: 'lph', name: 'Fuel flow', unit: 'L/h' },
    { key: 'lat', name: 'Latitude', unit: '°' },
    { key: 'lon', name: 'Longitude', unit: '°' },
  ];
  const rows: (number | null)[][] = [];
  let { lat, lon, heading } = start;
  const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  for (const [i, [scenario, seconds]] of legs.entries()) {
    if (i > 0) car.setScenario(scenario);
    for (let s = 0; s < seconds; s++) {
      const v = car.snapshot();
      const kmh = v['13'];
      // Wander gently; turn at stops in town.
      heading += (scenario === 'highway' || scenario === 'towing' ? 0.3 : 2) * Math.sin(clock / 41_000) + (kmh < 1 && s % 75 === 20 ? 90 : 0);
      const km = kmh / 3600;
      lat += (km / 111.2) * Math.cos((heading * Math.PI) / 180);
      lon += (km / (111.2 * Math.cos((lat * Math.PI) / 180))) * Math.sin((heading * Math.PI) / 180);
      const economy = kmh > 3 ? Math.min(30, (v.lph / kmh) * 100) : null;
      const values: Record<string, number | null> = { ...v, economy, lat: round(lat, 6), lon: round(lon, 6) };
      if (extraId) values[extraId] = v.atf;
      rows.push([clock, ...columns.map((c) => (values[c.key] === null || values[c.key] === undefined ? null : round(values[c.key]!, c.key === 'lat' || c.key === 'lon' ? 6 : 2)))]);
      clock += 1000;
    }
  }
  return { columns, rows };
}
