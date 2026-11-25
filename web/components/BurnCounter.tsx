'use client';
import { useEffect, useState } from 'react';

/** Counts up to target on mount, then ticks slowly to feel live. */
export function BurnCounter({ target }: { target: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 1800);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <span className="tabular-nums">{v.toLocaleString('en-US')}</span>;
}
