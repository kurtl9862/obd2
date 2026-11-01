/**
 * Vehicle profiles. Every car gets the standard OBD-II features; a profile adds what's specific to
 * one model: which modules answer where, carmaker-only values (like transmission temperature),
 * and notes. Profiles are plain data so they can be exported, shared and edited.
 */

import type { Unit } from './pids.ts';

export interface Module {
  name: string;
  /** Request id the module listens on (ATSH). */
  request: string;
  /** Id it answers from (ATCRA). */
  response: string;
}

export interface ExtraPid {
  id: string;
  name: string;
  short: string;
  module: Module;
  /** Full request in hex, e.g. "2101" (service 21, PID 01) or "221E1C" (service 22, data id 1E1C). */
  request: string;
  /** Torque-style: A = first data byte after the echoed service and PID. Result in `unit`. */
  formula: string;
  unit: Unit;
  min: number;
  max: number;
  /** Turn the tile amber above this (metric). */
  warnHigh?: number;
  /** False until someone has checked it against a real reading on this model. */
  verified: boolean;
  source?: string;
}

export interface VehicleProfile {
  id: string;
  name: string;
  make: string;
  model: string;
  year: number | null;
  engine: string;
  transmission: string;
  modules: Module[];
  extraPids: ExtraPid[];
  notes: string[];
}

export const ENGINE: Module = { name: 'Engine', request: '7E0', response: '7E8' };
export const TRANSMISSION: Module = { name: 'Transmission', request: '7E1', response: '7E9' };

/** Names for the standard 11-bit CAN reply ids when a profile doesn't say. */
export const DEFAULT_MODULE_NAMES: Record<string, string> = {
  '7E8': 'Engine',
  '7E9': 'Transmission',
  '7EA': 'Module 7EA',
  '7EB': 'Module 7EB',
};

export const VEHICLES: VehicleProfile[] = [
  {
    id: 'pathfinder-2010',
    name: '2010 Nissan Pathfinder SE',
    make: 'Nissan',
    model: 'Pathfinder',
    year: 2010,
    engine: '4.0L V6 (VQ40DE)',
    transmission: '5-speed automatic (RE5R05A)',
    modules: [ENGINE, TRANSMISSION],
    extraPids: [
      {
        id: 'atf-temp-guess',
        name: 'Transmission fluid temperature (guess)',
        short: 'ATF',
        module: TRANSMISSION,
        request: '2120',
        formula: 'A-55',
        unit: '°C',
        min: -40,
        max: 150,
        warnHigh: 105,
        verified: false,
        source: 'Listed for the Nissan Patrol at obd2australia.com.au; not confirmed on the R51. The TCM explorer (phase 2) will find the real one.',
      },
    ],
    notes: [
      'The radiator has a built-in transmission cooler that can fail and mix coolant into the transmission fluid. Watch transmission temperature and codes P0700-P0780.',
      'Clearing codes also resets the smog readiness monitors.',
    ],
  },
  {
    id: 'civic-2020',
    name: '2020 Honda Civic Sport sedan',
    make: 'Honda',
    model: 'Civic',
    year: 2020,
    engine: '2.0L 4-cylinder (K20C2)',
    transmission: 'CVT',
    modules: [{ name: 'Engine and CVT', request: '7E0', response: '7E8' }],
    extraPids: [],
    notes: [
      'Honda runs the CVT from the engine computer and keeps extra values behind service 22. No public data id for CVT fluid temperature is confirmed yet; the explorer (phase 2) will look for it.',
      'Owners report about 190 °F as normal CVT temperature and 230 °F on long climbs.',
    ],
  },
  {
    id: 'sentra-2020',
    name: '2020 Nissan Sentra SR',
    make: 'Nissan',
    model: 'Sentra',
    year: 2020,
    engine: '2.0L 4-cylinder (MR20DD)',
    transmission: 'Xtronic CVT',
    modules: [ENGINE, TRANSMISSION],
    extraPids: [
      {
        id: 'cvt-temp',
        name: 'CVT fluid temperature (unverified)',
        short: 'CVT',
        module: TRANSMISSION,
        request: '2101',
        formula: '0.000000002344*AD^5 - 0.000001387*AD^4 + 0.0003193*AD^3 - 0.03501*AD^2 + 2.302*AD - 36.6',
        unit: '°C',
        min: -30,
        max: 140,
        warnHigh: 105,
        verified: false,
        source: 'Shared for Nissan CVTs on the torque-bhp.com forum; not yet checked on a 2020 Sentra.',
      },
    ],
    notes: [
      '2020 and newer Sentras have Nissan’s security gateway. Reading data should work; clearing codes may be refused without a gateway bypass cable.',
    ],
  },
  {
    id: 'other',
    name: 'Other vehicle',
    make: '',
    model: '',
    year: null,
    engine: '',
    transmission: '',
    modules: [ENGINE, TRANSMISSION],
    extraPids: [],
    notes: ['Standard OBD-II only: live data, codes, readiness and VIN work on any 1996 or newer car.'],
  },
];

export function vehicleById(id: string): VehicleProfile {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[VEHICLES.length - 1];
}

/** Profiles that fit a VIN's maker and model year, best first. */
export function suggestVehicles(maker: string | null, year: number | null): VehicleProfile[] {
  return VEHICLES.filter((v) => v.make && v.make === maker && (year === null || v.year === year));
}

export function moduleName(profile: VehicleProfile, responseId: string): string {
  return profile.modules.find((m) => m.response === responseId)?.name ?? DEFAULT_MODULE_NAMES[responseId] ?? `Module ${responseId}`;
}
