/**
 * Service 01 PID 01: check-engine light, stored code count, and the emissions self-tests
 * ("readiness monitors") that a smog check looks at. Clearing codes resets every monitor to
 * incomplete until the car has been driven through its tests again.
 */

export type MonitorState = 'complete' | 'incomplete' | 'unsupported';

export interface Monitor {
  name: string;
  state: MonitorState;
  /** Continuous monitors run all the time; the others need specific driving. */
  continuous: boolean;
}

export interface Readiness {
  milOn: boolean;
  dtcCount: number;
  diesel: boolean;
  monitors: Monitor[];
}

const SPARK = ['Catalyst', 'Heated catalyst', 'Evaporative system', 'Secondary air', 'A/C refrigerant', 'Oxygen sensor', 'Oxygen sensor heater', 'EGR system'];
const DIESEL = ['NMHC catalyst', 'NOx / SCR', '', 'Boost pressure', '', 'Exhaust gas sensor', 'Particulate filter', 'EGR / VVT'];

/** `b` = the four data bytes after "41 01". */
export function decodeReadiness(b: number[]): Readiness {
  const [A, B, C, D] = b;
  const diesel = (B & 0x08) !== 0;
  const state = (available: boolean, incomplete: boolean): MonitorState =>
    !available ? 'unsupported' : incomplete ? 'incomplete' : 'complete';

  const monitors: Monitor[] = [
    { name: 'Misfire', state: state(!!(B & 0x01), !!(B & 0x10)), continuous: true },
    { name: 'Fuel system', state: state(!!(B & 0x02), !!(B & 0x20)), continuous: true },
    { name: 'Components', state: state(!!(B & 0x04), !!(B & 0x40)), continuous: true },
  ];
  const names = diesel ? DIESEL : SPARK;
  names.forEach((name, i) => {
    if (!name) return;
    monitors.push({ name, state: state(!!(C & (1 << i)), !!(D & (1 << i))), continuous: false });
  });

  return { milOn: (A & 0x80) !== 0, dtcCount: A & 0x7f, diesel, monitors };
}

/**
 * EPA guidance most states follow: 2001 and newer may have one incomplete non-continuous monitor,
 * 1996-2000 may have two. A lit check-engine light fails regardless. States differ; this is a hint.
 */
export function smogVerdict(r: Readiness, modelYear: number | null): { pass: boolean; reason: string } {
  if (r.milOn) return { pass: false, reason: 'The check-engine light is on.' };
  const incomplete = r.monitors.filter((m) => !m.continuous && m.state === 'incomplete').length;
  const allowed = modelYear !== null && modelYear <= 2000 ? 2 : 1;
  if (incomplete > allowed) {
    return {
      pass: false,
      reason: `${incomplete} monitors are still incomplete (most states allow ${allowed}). Drive a mix of highway and town over a few days, then check again.`,
    };
  }
  return {
    pass: true,
    reason: incomplete
      ? `${incomplete} monitor incomplete, within the usual allowance of ${allowed}.`
      : 'All supported monitors are complete.',
  };
}
