/** Where a recorded drive went: a GPX file for maps apps, and a simple outline to draw. */

export interface TrackPoint {
  /** ms since the drive started */
  t: number;
  lat: number;
  lon: number;
  /** km/h, from the car when it reported it */
  speedKmh?: number;
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** GPX 1.1, opens in Google Earth, Apple Maps (via apps), Strava, gpx.studio and the like. */
export function toGpx(name: string, startedAt: number, points: TrackPoint[]): string {
  const pts = points
    .map((p) => {
      const speed = p.speedKmh !== undefined ? `<extensions><speed>${(p.speedKmh / 3.6).toFixed(2)}</speed></extensions>` : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(startedAt + p.t).toISOString()}</time>${speed}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OBD2" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date(startedAt).toISOString()}</time></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Distance between two points in km (haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Fit the track into a width x height box, keeping its shape (longitude squeezed by latitude),
 * north up. Returns screen points with the original speed, for colouring.
 */
export function projectTrack(points: TrackPoint[], width: number, height: number, pad = 8): { x: number; y: number; speedKmh?: number }[] {
  if (!points.length) return [];
  const k = Math.cos(((points.reduce((s, p) => s + p.lat, 0) / points.length) * Math.PI) / 180);
  const xs = points.map((p) => p.lon * k);
  const ys = points.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return points.map((p, i) => ({ x: offX + (xs[i] - minX) * scale, y: height - (offY + (ys[i] - minY) * scale), speedKmh: p.speedKmh }));
}
