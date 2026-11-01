/** The last minute or so of one value, as a thin line under the number. */
export function Sparkline({ values, min, max }: { values: number[]; min: number; max: number }) {
  values = values.filter(Number.isFinite);
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 24" aria-hidden />;
  const lo = Math.min(...[min, ...values].filter(Number.isFinite));
  const hi = Math.max(...[max, ...values].filter(Number.isFinite));
  const span = hi - lo || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(22 - ((v - lo) / span) * 20).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
