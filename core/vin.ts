import type { EcuMessage } from './parse.ts';

/**
 * VIN from a service 09 PID 02 reply. CAN sends one long message ([49 02 01] + 17 characters);
 * older protocols send five short ones, each with a sequence byte and zero padding. Either way,
 * the VIN is the last 17 VIN-legal characters.
 */
export function parseVin(messages: EcuMessage[]): string | null {
  const chars: string[] = [];
  for (const m of messages) {
    for (const b of m.data.slice(2)) {
      const c = String.fromCharCode(b);
      if (/[0-9A-HJ-NPR-Z]/.test(c)) chars.push(c);
    }
  }
  if (chars.length < 17) return null;
  return chars.slice(-17).join('');
}

const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/**
 * Model year from the 10th character. The code repeats every 30 years; for North American cars a
 * letter in position 7 means 2010 or later.
 */
export function vinModelYear(vin: string): number | null {
  if (vin.length !== 17) return null;
  const i = YEAR_CODES.indexOf(vin[9]);
  if (i === -1) return null;
  const year = 1980 + i;
  return /[A-Z]/.test(vin[6]) ? year + 30 : year;
}

/** The first characters say who built the car. Longest match wins. */
const MAKERS: [string, string][] = [
  ['1N', 'Nissan'], ['3N', 'Nissan'], ['5N1', 'Nissan'], ['JN', 'Nissan'],
  ['1HG', 'Honda'], ['2HG', 'Honda'], ['19X', 'Honda'], ['5FN', 'Honda'], ['5J6', 'Honda'], ['7FA', 'Honda'], ['JH', 'Honda'], ['SHH', 'Honda'],
  ['19U', 'Acura'], ['5J8', 'Acura'],
  ['JT', 'Toyota'], ['4T', 'Toyota'], ['5TD', 'Toyota'], ['5TF', 'Toyota'], ['2T', 'Toyota'],
  ['1F', 'Ford'], ['3F', 'Ford'], ['1G', 'General Motors'], ['3G', 'General Motors'],
  ['1C', 'Chrysler / Jeep / Ram'], ['2C', 'Chrysler / Jeep / Ram'], ['3C', 'Chrysler / Jeep / Ram'],
  ['JM', 'Mazda'], ['JF', 'Subaru'], ['4S', 'Subaru'], ['KM', 'Hyundai'], ['5NP', 'Hyundai'], ['KN', 'Kia'], ['5XY', 'Kia'],
  ['WBA', 'BMW'], ['WVW', 'Volkswagen'], ['3VW', 'Volkswagen'], ['WAU', 'Audi'], ['WDD', 'Mercedes-Benz'], ['YV', 'Volvo'],
];

export function vinMaker(vin: string): string | null {
  let best: [string, string] | null = null;
  for (const m of MAKERS) if (vin.startsWith(m[0]) && (!best || m[0].length > best[0].length)) best = m;
  return best ? best[1] : null;
}
