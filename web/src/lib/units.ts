import type { Unit } from '../../../core/pids.ts';

export type UnitSystem = 'us' | 'metric';

/** Values arrive metric; show US units unless the user picks metric. */
export function display(value: number, unit: Unit, system: UnitSystem): { value: number; unit: string } {
  if (system === 'metric') return { value, unit };
  switch (unit) {
    case '°C':
      return { value: value * 1.8 + 32, unit: '°F' };
    case 'km/h':
      return { value: value * 0.621371, unit: 'mph' };
    case 'km':
      return { value: value * 0.621371, unit: 'mi' };
    case 'kPa':
      return { value: value * 0.145038, unit: 'psi' };
    case 'L/h':
      return { value: value * 0.264172, unit: 'gal/h' };
    default:
      return { value, unit };
  }
}

/** Sensible decimals per unit. */
export function fmt(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '–';
  const digits = unit === 'V' || unit === 'λ' || unit === 'psi' || unit === 'gal/h' ? (unit === 'λ' ? 3 : 1) : unit === 'g/s' || unit === '%' ? 1 : 0;
  return value.toFixed(digits);
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}
