/**
 * One pass over the car for the health report: codes, readiness, battery, a handful of
 * telling values (fuel trims, coolant, distance since codes were cleared) and any
 * carmaker-specific values you turned on. Every step is best-effort, so a car that refuses
 * one request still gets a report.
 */
import type { Elm327 } from './elm327.ts';
import { LiveReader, readCodes, readExtra, readReadiness, readVin, supportedPids, type FoundCode } from './obd.ts';
import type { Readiness } from './readiness.ts';
import type { ExtraPid } from './vehicles.ts';

/** Values a mechanic looks at first. Only the ones the car supports are read. */
export const HEALTH_PIDS = [0x05, 0x0c, 0x04, 0x06, 0x07, 0x08, 0x09, 0x0f, 0x42, 0x2f, 0x21, 0x4d, 0x31, 0x30, 0x4e, 0x1f];

export interface HealthCheck {
  at: number;
  vin: string | null;
  codes: FoundCode[] | null;
  readiness: Readiness | null;
  battery: number | null;
  values: Map<number, number>;
  extras: { extra: ExtraPid; value: number }[];
  problems: string[];
}

export async function collectHealth(elm: Elm327, extras: ExtraPid[] = [], supported?: number[]): Promise<HealthCheck> {
  const problems: string[] = [];
  const attempt = async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      problems.push(`${what}: ${(err as Error).message}`);
      return null;
    }
  };
  const vin = await attempt('VIN', () => readVin(elm));
  const codes = await attempt('Trouble codes', () => readCodes(elm));
  const readiness = await attempt('Readiness', () => readReadiness(elm));
  const battery = await attempt('Battery voltage', () => elm.voltage());
  const sup = supported ?? (await attempt('Supported values', () => supportedPids(elm))) ?? [];
  const pids = HEALTH_PIDS.filter((p) => sup.includes(p));
  const values = (await attempt('Live values', () => new LiveReader(elm).read(pids))) ?? new Map<number, number>();
  const extraValues: HealthCheck['extras'] = [];
  for (const extra of extras) {
    const value = await attempt(extra.name, () => readExtra(elm, extra));
    if (value !== null && Number.isFinite(value)) extraValues.push({ extra, value });
  }
  return { at: Date.now(), vin, codes, readiness, battery, values, extras: extraValues, problems };
}

/** Plain-language flags for the top of the report. */
export function healthFlags(h: HealthCheck): { level: 'bad' | 'warn' | 'good'; text: string }[] {
  const flags: { level: 'bad' | 'warn' | 'good'; text: string }[] = [];
  const stored = h.codes?.filter((c) => c.kind !== 'pending') ?? [];
  const pending = h.codes?.filter((c) => c.kind === 'pending') ?? [];
  if (h.readiness?.milOn) flags.push({ level: 'bad', text: 'Check-engine light is on.' });
  if (stored.length) flags.push({ level: 'bad', text: `${stored.length} stored trouble code${stored.length === 1 ? '' : 's'}.` });
  if (pending.length) flags.push({ level: 'warn', text: `${pending.length} pending code${pending.length === 1 ? '' : 's'} (seen once, not confirmed).` });
  const trims = [0x07, 0x09].map((p) => h.values.get(p)).filter((v): v is number => v !== undefined);
  for (const t of trims)
    if (Math.abs(t) >= 10) {
      flags.push({ level: 'warn', text: `Long-term fuel trim is ${t > 0 ? '+' : ''}${t.toFixed(1)}% (running ${t > 0 ? 'lean: vacuum leak, weak pump or dirty MAF' : 'rich: leaking injector or O2 sensor'} are common causes).` });
      break;
    }
  if (h.battery !== null && h.values.get(0x0c) && h.battery < 13) flags.push({ level: 'warn', text: `Battery is ${h.battery.toFixed(1)} V with the engine running; the alternator should hold 13.5–14.7 V.` });
  if (h.battery !== null && !h.values.get(0x0c) && h.battery < 12.2) flags.push({ level: 'warn', text: `Battery is ${h.battery.toFixed(1)} V with the engine off; a healthy one rests at 12.4–12.7 V.` });
  const sinceClear = h.values.get(0x31);
  if (sinceClear !== undefined && sinceClear < 50 && h.codes && !h.codes.length)
    flags.push({ level: 'warn', text: `Codes were cleared recently (${Math.round(sinceClear)} km ago). A clean scan right after clearing doesn’t prove much.` });
  if (!flags.length && h.codes) flags.push({ level: 'good', text: 'No codes, check-engine light off.' });
  return flags;
}
