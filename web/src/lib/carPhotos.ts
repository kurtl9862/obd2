/**
 * Photos of our own cars, from Halberd's Vehicles view (the 1.x branch, dashboard/web/public/cars).
 * Background removed, plates blanked. Cars without a photo (like "Other vehicle") get an icon.
 */
import pathfinder from '../assets/cars/pathfinder-2010.webp';
import civic from '../assets/cars/civic-2020.webp';
import sentra from '../assets/cars/sentra-2020.webp';

const PHOTOS: Record<string, string> = {
  'pathfinder-2010': pathfinder,
  'civic-2020': civic,
  'sentra-2020': sentra,
};

export function carPhoto(vehicleId: string): string | null {
  return PHOTOS[vehicleId] ?? null;
}
