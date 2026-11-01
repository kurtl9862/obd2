import { useCallback, useState } from 'react';
import type { UnitSystem } from './units.ts';
import type { ExtraPid } from '../../../core/vehicles.ts';

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

const KEY = 'obd2.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Per-browser preferences. Nothing here needs to be shared or survive a cleared browser. */
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
