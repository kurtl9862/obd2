import { Car } from 'lucide-react';
import { carPhoto } from '../lib/carPhotos.ts';

/** A car's photo, or a car icon when there isn't one. `size` sets the frame (see .car-photo in styles.css). */
export function CarPhoto({ vehicleId, name, size }: { vehicleId: string; name: string; size: 'thumb' | 'tile' | 'hero' }) {
  const src = carPhoto(vehicleId);
  return (
    <span className={`car-photo is-${size}${src ? '' : ' is-empty'}`}>
      {src ? <img src={src} alt={name} draggable={false} /> : <Car size={size === 'thumb' ? 14 : size === 'tile' ? 26 : 40} aria-hidden />}
    </span>
  );
}
