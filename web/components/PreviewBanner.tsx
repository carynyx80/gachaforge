'use client';
import { useHealth, useOffT } from './useOffchain';

/**
 * mode 'mock' (or backend unreachable) → "Preview — simulated activity".
 * mode 'offchain' → nothing, or a small "Card buying starts soon" note while renaissReady is false.
 * any other real mode ('vault' / 'live') → nothing. Defaults to the preview banner (safe) until health answers.
 */
export function PreviewBanner() {
  const t = useOffT();
  const { data } = useHealth();
  const mode = data?.mode ?? 'mock';
  if (mode !== 'mock' && mode !== 'offchain') return null;
  if (mode === 'offchain') {
    if (data?.renaissReady !== false) return null;
    return (
      <div role="status" className="border-b border-line bg-bg/90">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1 text-center text-[11px] text-muted">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span>{t('b_soon')}</span>
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="sticky top-16 z-40 border-b border-accent/40 bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-center text-xs">
        <span className="rounded-sm border border-accent px-1.5 py-px font-display font-bold uppercase tracking-wide text-accent">{t('b_preview')}</span>
        <span className="text-fg">{t('b_preview_text')}</span>
      </div>
    </div>
  );
}
