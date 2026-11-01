let ctx: AudioContext | null = null;

/** Three short high beeps. Browsers only allow sound after you've clicked something on the page. */
export function beep(): void {
  try {
    ctx ??= new AudioContext();
    const start = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1760;
      gain.gain.setValueAtTime(0.0001, start + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.3, start + i * 0.25 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.25 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + i * 0.25);
      osc.stop(start + i * 0.25 + 0.2);
    }
  } catch {
    // no audio available; the on-screen alarm still shows
  }
}
