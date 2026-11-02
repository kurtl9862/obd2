import { useCallback, useState } from 'react';
import type { UnitSystem } from './units.ts';
import type { ExtraPid } from '../../../core/vehicles.ts';
import { CIVIC_DEMO_EXTRA } from '../../../core/demo-car.ts';
import { IS_DEMO } from './mode.ts';

export type ConnectionKind = 'wifi' | 'serial' | 'ble' | 'sim';

export interface Settings {
  vehicleId: string;
  connection: ConnectionKind;
  bridgeUrl: string;
  baudRate: number;
  units: UnitSystem;
  /** Dashboard tiles the user picked; null = the defaults. */
  tiles: number[] | null;
  /** Carmaker-specific values switched on, by id. */
  extras: string[];
  /** Values found with the explorer or imported, per vehicle id. */
  customExtras: Record<string, ExtraPid[]>;
  /** Beep when a value with a warning limit goes over it. */
  alarmSound: boolean;
  /** Show the fuel economy tile (needs mass airflow and speed). */
  showEconomy: boolean;
  /** Save the laptop's location with recorded drives, for the map and GPX export. */
  recordGps: boolean;
}

/** When the Mac helper serves the app, its WebSocket is on the same host. */
function defaultBridgeUrl(): string {
  if (typeof location !== 'undefined' && location.protocol === 'http:' && location.port === '35001') {
    return `ws://${location.host}/elm`;
  }
  return 'ws://localhost:35001/elm';
}

const DEFAULTS: Settings = {
  vehicleId: 'pathfinder-2010',
  connection: 'wifi',
  bridgeUrl: defaultBridgeUrl(),
  baudRate: 38400,
  units: 'us',
  tiles: null,
  extras: [],
  customExtras: {},
  alarmSound: true,
  showEconomy: true,
  recordGps: true,
};

/** Demo mode: the pretend car, with every carmaker value switched on so the tiles show. */
const DEMO_DEFAULTS: Settings = {
  ...DEFAULTS,
  connection: 'sim',
  extras: ['atf-temp-guess', 'cvt-temp', CIVIC_DEMO_EXTRA.id],
  customExtras: { 'civic-2020': [CIVIC_DEMO_EXTRA] },
  // The sample drives already have a route; don't ask for the laptop's location.
  recordGps: false,
};

const KEY = IS_DEMO ? 'obd2.demo.settings' : 'obd2.settings';
const BASE = IS_DEMO ? DEMO_DEFAULTS : DEFAULTS;

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...BASE, ...JSON.parse(raw) } : BASE;
  } catch {
    return BASE;
  }
}

/** Per-browser preferences. Nothing here needs to be shared or survive a cleared browser. */
export function clearDemoSettings() {
  try {
    if (IS_DEMO) localStorage.removeItem(KEY);
  } catch {
    // nothing saved
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private window or storage blocked: keep it for this visit only
      }
      return next;
    });
  }, []);
  return [settings, update] as const;
}
