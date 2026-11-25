'use client';
import { useState } from 'react';
import type { PackId, Strategy } from '@/lib/types';
import { PACK_PRICE } from '@/lib/types';
import { STRATEGY_INFO } from '@/lib/strategies';
import { usd } from '@/lib/format';

const PACKS: { id: PackId; max: string }[] = [
  { id: 'FORGE_28', max: '~10x' }, { id: 'FORGE_48', max: '~11x' }, { id: 'FORGE_88', max: '~9.9x' },
];
const STRATS: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="mb-4 flex items-center gap-3 font-display text-xl font-bold uppercase tracking-wide">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-black">{n}</span>{title}
      </h2>
      {children}
    </section>
  );
}
const input = 'w-full rounded-md border border-line bg-bg px-3 py-2.5 outline-none focus:border-accent';

export function LaunchForm() {
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [desc, setDesc] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [x, setX] = useState('');
  const [tg, setTg] = useState('');
  const [web, setWeb] = useState('');
  const [pack, setPack] = useState<PackId>('FORGE_48');
  const [strategy, setStrategy] = useState<Strategy>('RAFFLE');
  const [split, setSplit] = useState({ dividend: 50, burn: 30, lp: 20 });
  const [tax, setTax] = useState(5);
  const [buy, setBuy] = useState('0.1');

  const setPart = (k: keyof typeof split, v: number) => {
    // keep sum at 100 by redistributing the remainder across the other two, proportionally
    const others = (Object.keys(split) as (keyof typeof split)[]).filter((o) => o !== k);
    const rest = 100 - v;
    const curRest = others.reduce((a, o) => a + split[o], 0);
    const a = curRest ? Math.round((split[others[0]] / curRest) * rest) : Math.round(rest / 2);
    setSplit({ ...split, [k]: v, [others[0]]: a, [others[1]]: rest - a } as typeof split);
  };

  const buyBnb = Number(buy) || 0;
  const launchFee = 0.005;
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10">
      <h1 className="font-display text-4xl font-bold uppercase sm:text-5xl">Launch a <span className="neon-text text-accent">machine</span></h1>
      <p className="mt-2 max-w-2xl text-muted">Your token, your gacha machine. Every setting below is locked forever at launch — choose carefully.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Step n={1} title="Token info">
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <label className="grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-lg border-2 border-dashed border-line bg-bg text-center text-xs text-muted hover:border-accent">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="preview" className="h-full w-full object-cover" />
                ) : <span>Upload image<br />PNG / JPG / GIF</span>}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImg(URL.createObjectURL(f)); }} />
              </label>
              <div className="grid gap-3">
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
                  <input className={`${input} font-mono uppercase`} placeholder="TICKER" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={10} />
                </div>
                <textarea className={`${input} min-h-20`} placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={280} />
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input className={input} placeholder="X link (optional)" value={x} onChange={(e) => setX(e.target.value)} />
              <input className={input} placeholder="Telegram (optional)" value={tg} onChange={(e) => setTg(e.target.value)} />
              <input className={input} placeholder="Website (optional)" value={web} onChange={(e) => setWeb(e.target.value)} />
            </div>
          </Step>

          <Step n={2} title="Pick a pack">
            <div className="grid grid-cols-3 gap-3">
              {PACKS.map((p) => (
                <button key={p.id} onClick={() => setPack(p.id)} className={`rounded-lg border-2 p-4 text-left transition ${pack === p.id ? 'border-accent bg-accent-soft shadow-[4px_4px_0_0_#B6FF2E]' : 'border-line hover:border-accent/50'}`}>
                  <div className="font-display text-3xl font-bold">${PACK_PRICE[p.id]}</div>
                  <div className="text-xs text-muted">per pull · max win {p.max}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Each pull pays the pack price in BNB (Chainlink BNB/USD, ≤10% slippage buffer). Leftover returns to the pot.</p>
          </Step>

          <Step n={3} title="Strategy & tax">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {STRATS.map((s) => {
                const i = STRATEGY_INFO[s];
                return (
                  <button key={s} onClick={() => setStrategy(s)} className={`rounded-lg border-2 p-4 text-left transition ${strategy === s ? 'border-accent bg-accent-soft shadow-[4px_4px_0_0_#B6FF2E]' : 'border-line hover:border-accent/50'}`}>
                    <div className="font-display text-lg font-bold">{i.icon} {i.title}</div>
                    <div className="mt-1 text-xs text-muted">{i.long}</div>
                  </button>
                );
              })}
            </div>
            {strategy === 'SPLIT' && (
              <div className="mt-4 rounded-lg border border-line bg-bg p-4">
                <div className="mb-3 flex justify-between text-sm"><span className="font-semibold">Split ratio</span><span className="font-mono text-success">Total {split.dividend + split.burn + split.lp}%</span></div>
                {(['dividend', 'burn', 'lp'] as const).map((k) => (
                  <label key={k} className="mb-3 block">
                    <div className="flex justify-between text-xs text-muted"><span className="capitalize">{k === 'lp' ? 'LP (locked forever)' : k}</span><span className="font-mono text-fg">{split[k]}%</span></div>
                    <input type="range" min={0} max={100} value={split[k]} onChange={(e) => setPart(k, Number(e.target.value))} className="w-full accent-[#B6FF2E]" />
                  </label>
                ))}
                <p className="text-xs text-muted">Before graduation the LP share is burned instead.</p>
              </div>
            )}
            <div className="mt-5">
              <div className="flex justify-between text-sm"><span className="font-semibold">Trading tax (buy & sell)</span><span className="font-mono text-accent">{tax}%</span></div>
              <input type="range" min={1} max={10} step={1} value={tax} onChange={(e) => setTax(Number(e.target.value))} className="mt-2 w-full accent-[#B6FF2E]" />
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded border border-line p-2"><div className="font-mono text-fg">{(tax * 0.7).toFixed(2)}%</div><div className="text-muted">gacha pot</div></div>
                <div className="rounded border border-line p-2"><div className="font-mono text-fg">{(tax * 0.2).toFixed(2)}%</div><div className="text-muted">$FORGE burn</div></div>
                <div className="rounded border border-line p-2"><div className="font-mono text-fg">{(tax * 0.1).toFixed(2)}%</div><div className="text-muted">treasury</div></div>
              </div>
            </div>
          </Step>

          <Step n={4} title="Initial buy">
            <div className="flex items-center rounded-md border border-line bg-bg px-3 focus-within:border-accent">
              <input value={buy} onChange={(e) => setBuy(e.target.value)} inputMode="decimal" className="w-full bg-transparent py-2.5 font-mono outline-none" />
              <span className="text-sm text-muted">BNB</span>
            </div>
            <p className="mt-2 text-xs text-muted">Optional. Buy in the same transaction as launch so you are first on the curve.</p>
          </Step>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="panel overflow-hidden">
            <div className="grid h-40 place-items-center bg-[radial-gradient(circle_at_30%_25%,#D4FF7A,#3F6B08_70%,#050505)]">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="" className="h-full w-full object-cover" />
              ) : <span className="font-display text-4xl font-bold text-black/60">{t.slice(0, 2) || '??'}</span>}
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-baseline justify-between"><span className="font-semibold">{name || 'Your machine'}</span><span className="font-display font-bold text-glow">${t || 'TICKER'}</span></div>
              <div className="text-xs text-muted">{STRATEGY_INFO[strategy].title} · {tax}% tax · ${PACK_PRICE[pack]} pack</div>
              {strategy === 'SPLIT' && <div className="text-xs text-muted">{split.dividend}/{split.burn}/{split.lp} dividend/burn/LP</div>}
              <div className="rounded-md border border-accent/30 bg-accent-soft/50 p-2.5 text-xs"><div className="flex justify-between"><span className="text-muted">Gacha pot</span><span className="font-mono text-accent">{usd(PACK_PRICE[pack])} to rip</span></div></div>
              <div className="space-y-1 border-t border-line pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted">flap.sh launch fee (est.)</span><span className="font-mono">{launchFee} BNB</span></div>
                <div className="flex justify-between"><span className="text-muted">Initial buy</span><span className="font-mono">{buyBnb} BNB</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span className="font-mono">{(launchFee + buyBnb).toFixed(4)} BNB</span></div>
              </div>
              <button disabled className="btn-chunky w-full py-3 opacity-60">Connect wallet</button>
              <p className="text-center text-xs text-muted">Launched on <span className="text-fg">flap.sh</span> · BNB Chain</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
