'use client';
import Link from 'next/link';
import { useOffT } from '../useOffchain';

/** Slim pointer to /transparency (used above the docs). */
export function TransparencyLink() {
  const t = useOffT();
  return (
    <div className="mx-auto -mb-6 flex max-w-7xl justify-end px-4 pt-6">
      <Link href="/transparency" className="inline-flex items-center gap-2 rounded-md border border-accent/50 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-accent transition hover:bg-accent-soft">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{t('nav')} →
      </Link>
    </div>
  );
}
