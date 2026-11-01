/**
 * Fuel use from engine data. Gasoline engines run near 14.7 g of air per g of fuel, and gasoline
 * weighs about 740 g per liter, so mass airflow gives fuel flow. A fuel-rate PID (5E), when the car
 * has one, is used instead.
 */

const AIR_FUEL_RATIO = 14.7;
const GASOLINE_G_PER_L = 740;

export function litersPerHourFromMaf(mafGramsPerSecond: number): number {
  return (mafGramsPerSecond * 3600) / (AIR_FUEL_RATIO * GASOLINE_G_PER_L);
}

/** L/100 km, or null when stopped (economy is meaningless at 0 km/h). */
export function litersPer100km(litersPerHour: number, speedKmh: number): number | null {
  if (speedKmh < 3) return null;
  return (litersPerHour / speedKmh) * 100;
}

export function mpgFromLitersPer100km(l100: number): number {
  return 235.215 / l100;
}

export interface TripTotals {
  km: number;
  liters: number;
  seconds: number;
}

/** Integrate speed (km/h) and fuel flow (L/h) over timestamped samples (ms). */
export function tripTotals(points: { t: number; speedKmh?: number; litersPerHour?: number }[]): TripTotals {
  let km = 0;
  let liters = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const hours = (b.t - a.t) / 3_600_000;
    if (hours <= 0 || hours > 0.01) continue; // skip gaps over 36 s (paused or dropped)
    if (a.speedKmh !== undefined && b.speedKmh !== undefined) km += ((a.speedKmh + b.speedKmh) / 2) * hours;
    if (a.litersPerHour !== undefined && b.litersPerHour !== undefined) liters += ((a.litersPerHour + b.litersPerHour) / 2) * hours;
  }
  const seconds = points.length > 1 ? (points[points.length - 1].t - points[0].t) / 1000 : 0;
  return { km, liters, seconds };
}
