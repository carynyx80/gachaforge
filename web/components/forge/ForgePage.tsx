'use client';
import './forge.css';
import { isPreview } from '@/lib/forge';
import { PageLoading } from '../PageLoading';
import { ForgeChart } from './ForgeChart';
import { ForgeComing } from './ForgeComing';
import { ForgeFuel } from './ForgeFuel';
import { ForgeHeader, ForgeStats, ForgeTrades } from './ForgeLive';
import { ForgeTradeBar } from './ForgeTradeBar';
import { useForge, useForgeT } from './useForge';

export function ForgePage() {
  const t = useForgeT();
  const { state, loaded, live, trades, subscribeTrades, fixture } = useForge();
  if (!loaded) return <PageLoading label="Loading $FORGE…" />;

  if (!live || !state?.token) {
    return (
      <>
        <ForgeComing state={state} />
        <div className="mx-auto max-w-7xl px-4">
          <ForgeFuel pendingBnb={state?.buybackPendingBnb} totalBnb={state?.buybackTotalBnb} />
        </div>
      </>
    );
  }

  const token = state.token;
  const preview = isPreview(state);
  return (
    <div className="relative">
      <div className="hero-sky pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 pt-8">
        {preview && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent-soft px-3 py-2 text-xs">
            <span className="rounded-sm border border-accent px-1.5 py-px font-display font-bold uppercase text-accent">{t('preview')}</span>
            <span className="text-fg">{t('preview_note')}</span>
            {fixture && <span className="font-mono text-muted">(dev fixture)</span>}
          </div>
        )}
        <ForgeHeader token={token} preview={preview} />
        <ForgeStats token={token} />
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <ForgeChart subscribeTrades={subscribeTrades} fixture={fixture === 'preview'} />
          <ForgeTrades trades={trades} symbol={token.symbol} />
        </div>
        <ForgeTradeBar token={token} preview={preview} />
        <ForgeFuel pendingBnb={token.buybackPendingBnb} totalBnb={token.buybackTotalBnb} burnedTokens={token.burnedTokens} />
      </div>
    </div>
  );
}
