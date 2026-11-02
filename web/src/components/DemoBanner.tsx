import { useState } from 'react';
import { FlaskConical, LogOut, RotateCcw } from 'lucide-react';
import { DEMO_SCENARIOS, type DemoScenario } from '../../../core/demo-car.ts';
import { demoScenario, setDemoScenario } from '../lib/demo.ts';
import { realAppUrl } from '../lib/mode.ts';

/** The strip across the top in demo mode: what you're looking at, how the car is driving, a reset. */
export function DemoBanner({ onReset }: { onReset: () => void }) {
  const [scenario, setScenario] = useState<DemoScenario>(demoScenario);
  const hint = DEMO_SCENARIOS.find((s) => s.value === scenario)?.hint;
  return (
    <div className="banner demo-banner">
      <FlaskConical size={15} className="demo-icon" />
      <span>
        <b>Demo mode.</b> Every number is made up; nothing here touches a car or your real logs. <span className="muted">{hint}</span>
      </span>
      <label className="demo-scenario">
        <span className="muted small">Driving</span>
        <select
          aria-label="Demo driving scenario"
          value={scenario}
          onChange={(e) => {
            const s = e.target.value as DemoScenario;
            setScenario(s);
            setDemoScenario(s);
          }}
        >
          {DEMO_SCENARIOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button className="btn-ghost" onClick={onReset} title="Bring back the codes and sample drives">
        <RotateCcw size={13} /> Reset demo
      </button>
      <a className="btn-ghost" href={realAppUrl()}>
        <LogOut size={13} /> Leave demo
      </a>
    </div>
  );
}
