/**
 * Demo mode's moving parts: the pretend car the simulator is talking to (so the banner can change
 * its scenario), and the sample drives seeded into the demo's own drive database.
 */
import { CIVIC_DEMO_EXTRA, DemoCar, simulateDrive, type DemoScenario } from '../../../core/demo-car.ts';
import { vehicleById } from '../../../core/vehicles.ts';
import { clearDrives, countDrives, saveDrive } from './drives.ts';

let scenario: DemoScenario = 'cold';
let current: DemoCar | null = null;

/** A fresh pretend car for this vehicle, in the scenario picked on the banner. */
export function createDemoCar(vehicleId: string): DemoCar {
  current = new DemoCar(vehicleId, scenario);
  return current;
}

export function demoScenario(): DemoScenario {
  return scenario;
}

export function setDemoScenario(s: DemoScenario): void {
  scenario = s;
  current?.setScenario(s);
}

const EXTRA: Record<string, { id: string; name: string } | null> = {
  'pathfinder-2010': { id: 'atf-temp-guess', name: 'Transmission fluid temperature (guess)' },
  'sentra-2020': { id: 'cvt-temp', name: 'CVT fluid temperature (unverified)' },
  'civic-2020': { id: CIVIC_DEMO_EXTRA.id, name: CIVIC_DEMO_EXTRA.name },
  other: null,
};

/** Sample drives: [vehicle, days ago, hour of day, legs (scenario, seconds)]. */
const SAMPLES: [string, number, number, [DemoScenario, number][]][] = [
  ['pathfinder-2010', 0, 8, [['cold', 540], ['city', 360]]],
  ['pathfinder-2010', 2, 10, [['city', 300], ['highway', 1500], ['city', 240]]],
  ['pathfinder-2010', 5, 14, [['city', 240], ['highway', 600], ['towing', 900], ['highway', 300]]],
  ['civic-2020', 1, 17, [['city', 900], ['highway', 720]]],
  ['civic-2020', 4, 7, [['cold', 420], ['city', 480]]],
  ['sentra-2020', 3, 12, [['city', 600], ['highway', 900]]],
  ['other', 6, 16, [['city', 720]]],
];

/** Fill the demo's drive database with sample drives, unless it already has some (or `force`). */
export async function seedDemoDrives(force = false): Promise<void> {
  if (force) await clearDrives();
  else if ((await countDrives()) > 0) return;
  for (const [i, [vehicleId, daysAgo, hour, legs]] of SAMPLES.entries()) {
    const vehicle = vehicleById(vehicleId);
    const extra = EXTRA[vehicleId];
    const start = new Date();
    start.setDate(start.getDate() - daysAgo);
    start.setHours(hour, 5 + i * 7, 0, 0);
    if (start.getTime() > Date.now()) start.setDate(start.getDate() - 1);
    const data = simulateDrive(vehicleId, legs, extra?.id ?? null, extra?.name ?? '', {
      lat: 39.7392 + i * 0.01,
      lon: -104.9903 - i * 0.012,
      heading: i * 50,
    });
    const last = data.rows[data.rows.length - 1][0] as number;
    await saveDrive({
      vehicleId,
      vehicleName: vehicle.name,
      startedAt: start.getTime(),
      endedAt: start.getTime() + last,
      columns: data.columns,
      rows: data.rows,
    });
  }
}
