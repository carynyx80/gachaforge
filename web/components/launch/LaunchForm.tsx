'use client';
import { useState } from 'react';
import type { PackId, Strategy } from '@/lib/types';
import { PACK_PRICE } from '@/lib/types';
import { FLAP_CUT_PCT, SPLIT, TAX_BPS, TAX_PCT } from '@/lib/economics';
import { STRATEGY_INFO } from '@/lib/strategies';
import { usd } from '@/lib/format';
import { parseEther, parseEventLogs, type Hex } from 'viem';
import { useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { CONTRACTS_LIVE, FACTORY_ADDRESS } from '@/lib/chain';
import { gachaForgeFactoryAbi } from '@/lib/abi/gachaForgeFactory';
import { mineVanitySalt } from '@/lib/vanity';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus, useTx } from '../wallet/tx';

const PACKS: { id: PackId; max: string }[] = [
  { id: 'FORGE_28', max: '~10x' }, { id: 'FORGE_48', max: '~11x' }, { id: 'FORGE_88', max: '~9.9x' },
];
const STRATS: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];
// Enum indices match contracts/src/libraries/GachaTypes.sol
const PACK_INDEX: Record<PackId, number> = { FORGE_28: 0, FORGE_48: 1, FORGE_88: 2 };
const STRATEGY_INDEX: Record<Strategy, number> = { RAFFLE: 0, HIT_HUNTER: 1, DIVIDEND: 2, BURN: 3, SPLIT: 4 };

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
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [mining, setMining] = useState<number | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);
  const valid = name.trim().length > 0 && t.length > 0 && Number.isFinite(buyBnb) && buyBnb >= 0;

  const launch = async () => {
    const factory = FACTORY_ADDRESS;
    if (!factory || !valid) return;
    setLaunched(null);
    setMining(0);
    let salt: Hex;
    try {
      ({ salt } = await mineVanitySalt((n) => setMining(n)));
    } finally {
      setMining(null);
    }
    const sp = strategy === 'SPLIT'
      ? { dividendBps: split.dividend * 100, burnBps: split.burn * 100, lpBps: split.lp * 100 }
      : { dividendBps: 0, burnBps: 0, lpBps: 0 };
    const receipt = await tx.run(() => writeContractAsync({
      address: factory, abi: gachaForgeFactoryAbi, functionName: 'launch', chainId: bsc.id,
      // TODO(meta): upload image + metadata via flap (funcs.flap.sh/api/upload) and pass the CID here.
      args: [{ name: name.trim(), symbol: t, meta: '', packId: PACK_INDEX[pack], strategy: STRATEGY_INDEX[strategy], taxBps: TAX_BPS, split: sp, salt, extraData: '0x' }],
      value: parseEther(String(buyBnb)),
    }), `Launch $${t}`);
    if (receipt) {
      const ev = parseEventLogs({ abi: gachaForgeFactoryAbi, logs: receipt.logs, eventName: 'MachineLaunched' })[0];
      if (ev) setLaunched(ev.args.token);
    }
  };

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
            <div className="mt-5 rounded-lg border border-line bg-bg p-4">
              <div className="flex justify-between text-sm"><span className="font-semibold">Trading tax</span><span className="font-mono text-accent">{TAX_PCT}% buy / {TAX_PCT}% sell</span></div>
              <p className="mt-1 text-xs text-muted">Fixed for every GachaForge token and locked at launch. The creator receives 0%.</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded border border-line p-2"><div className="font-mono text-fg">{SPLIT.platform}%</div><div className="text-muted">GachaForge platform</div></div>
                <div className="rounded border border-line p-2"><div className="font-mono text-fg">{SPLIT.pot}%</div><div className="text-muted">gacha pot</div></div>
                <div className="rounded border border-line p-2"><div className="font-mono text-fg">{SPLIT.buyback}%</div><div className="text-muted">$FORGE buyback & burn</div></div>
              </div>
              <p className="mt-2 text-xs text-muted">flap.sh keeps {FLAP_CUT_PCT}% of the tax before it reaches GachaForge; the split applies to the rest.</p>
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
              <div className="text-xs text-muted">{STRATEGY_INFO[strategy].title} · {TAX_PCT}% tax · ${PACK_PRICE[pack]} pack</div>
              {strategy === 'SPLIT' && <div className="text-xs text-muted">{split.dividend}/{split.burn}/{split.lp} dividend/burn/LP</div>}
              <div className="rounded-md border border-accent/30 bg-accent-soft/50 p-2.5 text-xs"><div className="flex justify-between"><span className="text-muted">Gacha pot</span><span className="font-mono text-accent">{usd(PACK_PRICE[pack])} to rip</span></div></div>
              <div className="space-y-1 border-t border-line pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted">flap.sh launch fee</span><span className="font-mono">0 BNB + gas</span></div>
                <div className="flex justify-between"><span className="text-muted">Initial buy</span><span className="font-mono">{buyBnb} BNB</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span className="font-mono">{buyBnb.toFixed(4)} BNB</span></div>
              </div>
              <ActionButton onClick={launch} busy={tx.busy || mining !== null}
                disabledLabel={CONTRACTS_LIVE ? undefined : 'Launching opens soon'}
                disabled={!valid}>
                {mining !== null ? `Mining token address… ${Math.round(mining / 1000)}k` : tx.busy ? 'Launching…' : valid ? `Launch $${t}` : 'Enter name & ticker'}
              </ActionButton>
              <TxStatus state={tx.state} />
              {launched && <a href={`/m/${launched}`} className="block text-center text-sm text-accent underline">Open your machine →</a>}
              <p className="text-center text-xs text-muted">Launched on <span className="text-fg">flap.sh</span> · BNB Chain</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
