/**
 * Finds carmaker-only values (like transmission fluid temperature) that nobody has published.
 *
 * 1. Scan: ask one module for every data block in a range (service 21 PIDs 01-FF, or service 22
 *    data ids) and keep the ones it answers.
 * 2. Record: read those blocks every few seconds during a drive from a cold start, along with
 *    coolant and intake air temperature as references.
 * 3. Rank: fluid temperature starts near the outside temperature and climbs steadily as the engine
 *    warms, so bytes that rise smoothly with coolant are the likely ones. The offset (A-40, A-50 …)
 *    is guessed from where the byte started compared to the intake air temperature.
 */
import type { Elm327 } from './elm327.ts';
import { AdapterError } from './parse.ts';
import type { ExtraPid, Module } from './vehicles.ts';

export type ExploreService = '21' | '22';

/** Every request in a range: "2101".."21FF", or "22" + 4-digit data ids. */
export function rangeRequests(service: ExploreService, from: number, to: number): string[] {
  const width = service === '21' ? 2 : 4;
  const out: string[] = [];
  for (let id = from; id <= to; id++) out.push(service + id.toString(16).toUpperCase().padStart(width, '0'));
  return out;
}

export interface FoundBlock {
  request: string;
  /** Data bytes after the echoed service and id. */
  length: number;
}

function echoLength(request: string): number {
  return request.length / 2; // service byte echoed as +0x40, then the id (1 or 2 bytes)
}

/** Data bytes after the echo, or null if the module refused or stayed quiet. */
async function readBlock(elm: Elm327, module: Module, request: string, timeoutMs: number): Promise<number[] | null> {
  try {
    const replies = await elm.request(request, timeoutMs);
    const service = parseInt(request.slice(0, 2), 16);
    const reply = replies.find((r) => r.ecu === module.response && r.data[0] === service + 0x40) ?? replies.find((r) => r.data[0] === service + 0x40);
    return reply ? reply.data.slice(echoLength(request)) : null;
  } catch (err) {
    if (err instanceof AdapterError) return null;
    throw err;
  }
}

export async function scanModule(
  elm: Elm327,
  module: Module,
  requests: string[],
  onProgress?: (done: number, total: number, found: FoundBlock[]) => void,
  shouldStop?: () => boolean,
): Promise<FoundBlock[]> {
  const found: FoundBlock[] = [];
  await elm.setTarget(module.request, module.response);
  try {
    for (let i = 0; i < requests.length; i++) {
      if (shouldStop?.()) break;
      const data = await readBlock(elm, module, requests[i], 1000);
      if (data && data.length > 0) found.push({ request: requests[i], length: data.length });
      onProgress?.(i + 1, requests.length, found);
    }
  } finally {
    await elm.setTarget(null);
  }
  return found;
}

export interface Sample {
  /** Milliseconds since the recording started. */
  t: number;
  blocks: Record<string, number[]>;
  coolant?: number;
  intake?: number;
}

/** One pass: the two reference temperatures from the engine, then every found block from the module. */
export async function takeSample(elm: Elm327, module: Module, blocks: FoundBlock[], t: number): Promise<Sample> {
  const sample: Sample = { t, blocks: {} };
  await elm.setTarget(null);
  for (const [pid, key] of [
    ['0105', 'coolant'],
    ['010F', 'intake'],
  ] as const) {
    try {
      const r = (await elm.request(pid, 2000)).find((m) => m.data[0] === 0x41);
      if (r) sample[key] = r.data[2] - 40;
    } catch (err) {
      if (!(err instanceof AdapterError)) throw err;
    }
  }
  await elm.setTarget(module.request, module.response);
  try {
    for (const b of blocks) {
      const data = await readBlock(elm, module, b.request, 2000);
      if (data) sample.blocks[b.request] = data;
    }
  } finally {
    await elm.setTarget(null);
  }
  return sample;
}

export interface Candidate {
  request: string;
  /** Byte position, 0 = A. */
  index: number;
  letter: string;
  offset: number;
  formula: string;
  score: number;
  /** Raw rise over the recording. */
  rise: number;
  correlation: number;
  /** Temperatures (°C) the formula gives at the start and end. */
  startC: number;
  endC: number;
  series: number[];
}

export function byteLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Offsets carmakers commonly use for one-byte temperatures. */
const COMMON_OFFSETS = [40, 50, 55, 60, 64, 85];

export function rankCandidates(samples: Sample[], minSamples = 5): Candidate[] {
  if (samples.length < minSamples) return [];
  const requests = new Set(samples.flatMap((s) => Object.keys(s.blocks)));
  const refStart = samples[0].intake ?? samples[0].coolant ?? 20;
  const out: Candidate[] = [];

  for (const request of requests) {
    const rows = samples.filter((s) => s.blocks[request]);
    if (rows.length < minSamples) continue;
    const width = Math.max(...rows.map((s) => s.blocks[request].length));
    for (let index = 0; index < width; index++) {
      const pts = rows.filter((s) => s.blocks[request][index] !== undefined);
      const series = pts.map((s) => s.blocks[request][index]);
      if (series.length < minSamples) continue;
      const first = series[0];
      const last = series[series.length - 1];
      const rise = last - first;
      if (rise < 8) continue; // a warm-up moves fluid temperature well over 8 °C

      const diffs = series.slice(1).map((v, i) => v - series[i]);
      // Counters and timers climb by the same step every time; temperatures don't.
      if (diffs.every((d) => d === diffs[0])) continue;
      const steady = diffs.filter((d) => d >= -1).length / diffs.length;
      if (steady < 0.8) continue;

      const coolant = pts.map((s) => s.coolant);
      const ref = coolant.every((c) => c !== undefined) ? (coolant as number[]) : pts.map((s) => s.t);
      const correlation = pearson(series, ref);
      if (correlation < 0.6) continue;

      let offset = Math.round(first - refStart);
      const near = COMMON_OFFSETS.filter((o) => Math.abs(o - offset) <= 6).sort(
        (a, b) => Math.abs(a - offset) - Math.abs(b - offset),
      )[0];
      if (near !== undefined) offset = near;
      const startC = first - offset;
      const endC = last - offset;
      if (startC < -40 || startC > 70 || endC > 160) continue;

      const letter = byteLetter(index);
      const score = correlation * steady * Math.min(1, rise / 25) * (near !== undefined ? 1 : 0.85);
      out.push({ request, index, letter, offset, formula: `${letter}-${offset}`, score, rise, correlation, startC, endC, series });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** Turn a candidate into a value the dashboard can show. */
export function candidateToExtra(c: Candidate, module: Module, name: string, short: string, foundOn: string): ExtraPid {
  return {
    id: `found-${c.request}-${c.letter}`.toLowerCase(),
    name,
    short,
    module,
    request: c.request,
    formula: c.formula,
    unit: '°C',
    min: -40,
    max: 150,
    warnHigh: 105,
    verified: true,
    source: `Found by the explorer on your car (${foundOn}): byte ${c.letter} of ${c.request}, ${c.formula}.`,
  };
}
