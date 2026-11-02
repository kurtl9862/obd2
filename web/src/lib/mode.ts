/**
 * Demo mode: the app at /demo (or with ?demo) runs on a made-up car with sample drives, and keeps
 * its settings and drives apart from the real ones, so playing with it never touches real data.
 */
function detect(): boolean {
  if (typeof location === 'undefined') return false;
  const segments = location.pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] === 'demo' || new URLSearchParams(location.search).has('demo');
}

export const IS_DEMO = detect();

/** The real app's address, for the "Leave demo" link. */
export function realAppUrl(): string {
  const path = location.pathname.replace(/\/demo\/?$/, '/') || '/';
  return path + location.hash;
}
