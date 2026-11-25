'use client';
import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './useLiveFees';

/** Tweens a number to its new value (~450ms ease-out). Reduced motion: jumps. */
export function useTween(value: number, ms = 450) {
  const reduce = usePrefersReducedMotion();
  const [v, setV] = useState(value);
  const from = useRef(value);
  const cur = useRef(value);
  useEffect(() => {
    if (reduce || !Number.isFinite(value)) { cur.current = value; setV(value); return; }
    from.current = cur.current;
    let start = -1;
    let raf = 0;
    const step = (t: number) => {
      if (start < 0) start = t;
      const k = Math.min(1, Math.max(0, (t - start) / ms));
      const e = 1 - Math.pow(1 - k, 3);
      cur.current = from.current + (value - from.current) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduce]);
  return v;
}

export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const v = useTween(value);
  return <span className={className}>{format(v)}</span>;
}
