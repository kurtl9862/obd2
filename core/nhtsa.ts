/**
 * Free US government vehicle data (NHTSA): what a VIN decodes to, and open safety recalls.
 * No key needed. The web app calls these directly, or through the Mac helper if the browser
 * blocks it (see bridge/bridge.ts, /nhtsa/...).
 */

export const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
export const RECALLS_BASE = 'https://api.nhtsa.gov/recalls';

export function vinDecodeUrl(vin: string, base = VPIC_BASE): string {
  return `${base}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
}

export function recallsUrl(make: string, model: string, year: number, base = RECALLS_BASE): string {
  const q = new URLSearchParams({ make, model, modelYear: String(year) });
  return `${base}/recallsByVehicle?${q}`;
}

export interface DecodedVin {
  make: string;
  model: string;
  year: number | null;
  trim: string;
  engine: string;
  transmission: string;
  drive: string;
  body: string;
  fuel: string;
  /** vPIC's own warning when the VIN has problems (bad check digit etc.), or null. */
  warning: string | null;
}

type Raw = Record<string, string | null | undefined>;

const clean = (v: string | null | undefined) => (v ?? '').trim();
const title = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function parseVinDecode(json: unknown): DecodedVin | null {
  const r = (json as { Results?: Raw[] })?.Results?.[0];
  if (!r || !clean(r.Make)) return null;
  const litres = clean(r.DisplacementL);
  const cyl = clean(r.EngineCylinders);
  const engineModel = clean(r.EngineModel);
  const engine = [litres && `${Number(litres).toFixed(1)}L`, cyl && `${cyl}-cylinder`, engineModel && `(${engineModel})`].filter(Boolean).join(' ');
  const trans = [clean(r.TransmissionSpeeds) && `${clean(r.TransmissionSpeeds)}-speed`, clean(r.TransmissionStyle)].filter(Boolean).join(' ');
  const code = clean(r.ErrorCode);
  return {
    make: title(clean(r.Make)),
    model: clean(r.Model),
    year: Number(clean(r.ModelYear)) || null,
    trim: clean(r.Trim),
    engine,
    transmission: trans,
    drive: clean(r.DriveType),
    body: clean(r.BodyClass),
    fuel: clean(r.FuelTypePrimary),
    // "0" = clean decode; anything else comes with an explanation in ErrorText.
    warning: code && !code.split(',').every((c) => c.trim() === '0') ? clean(r.ErrorText) || 'NHTSA flagged a problem with this VIN' : null,
  };
}

export interface Recall {
  campaign: string;
  date: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  /** NHTSA says don't drive it until fixed. */
  parkIt: boolean;
}

export function parseRecalls(json: unknown): Recall[] {
  const results = (json as { results?: Raw[] })?.results ?? [];
  return results
    .map((r) => ({
      campaign: clean(r.NHTSACampaignNumber),
      date: clean(r.ReportReceivedDate),
      component: clean(r.Component),
      summary: clean(r.Summary),
      consequence: clean(r.Consequence),
      remedy: clean(r.Remedy),
      parkIt: String(r.parkIt) === 'true',
    }))
    .sort((a, b) => recallTime(b.date) - recallTime(a.date));
}

/** NHTSA dates come as "dd/mm/yyyy" in this API. */
function recallTime(d: string): number {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : Date.parse(d) || 0;
}

/** A Claude conversation with the code and the car already filled in. */
export function askClaudeUrl(code: string, description: string | null, car: string, extra = ''): string {
  const prompt =
    `My ${car || 'car'} has trouble code ${code}${description ? ` (${description})` : ''}. ` +
    `What does it usually mean on this vehicle, what are the most likely causes from cheapest to most expensive, ` +
    `what can I check myself, and is it safe to keep driving?${extra ? ` ${extra}` : ''}`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
