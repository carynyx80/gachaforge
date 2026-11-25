'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PackId, Strategy } from '@/lib/types';
import { PACK_PRICE } from '@/lib/types';
import { FLAP_CUT_PCT, SPLIT, TAX_BPS, TAX_PCT } from '@/lib/economics';
import { STRATEGY_INFO } from '@/lib/strategies';
import { usd } from '@/lib/format';
import { isAddressEqual, parseEther, parseEventLogs, type Address, type Hash, type Hex } from 'viem';
import { usePublicClient, useSignMessage, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import {
  FLAP_ANTI_FARMER_DURATION, FLAP_PORTAL, FLAP_TAX_DURATION, NATIVE, TREASURY_ADDRESS, ZERO_HASH, addrUrl, txUrl,
} from '@/lib/chain';
import { flapPortalAbi } from '@/lib/abi/flapPortal';
import { mineVanitySalt } from '@/lib/vanity';
import { uploadFlapMetadata } from '@/lib/flapUpload';
import { registerMachine, type RegisterBody } from '@/lib/api';
import { registerMessage } from '@/lib/registerMessage';
import { short } from '@/lib/format';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus, useTx } from '../wallet/tx';
import { useWallet } from '../wallet/useWallet';
import { useOffT } from '../useOffchain';

const PACKS: { id: PackId; max: string }[] = [
  { id: 'FORGE_28', max: '~10x' }, { id: 'FORGE_48', max: '~11x' }, { id: 'FORGE_88', max: '~9.9x' },
];
const STRATS: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];

// flap IPortal enums (contracts/src/adapters/flap/IFlapPortal.sol)
const DEX_THRESH_FOUR_FIFTHS = 1;
const MIGRATOR_V2 = 1;
const DEX0_PANCAKE = 0;
const LP_FEE_STANDARD = 0;
const TOKEN_TAXED_V3 = 6;

/** Launch tx that confirmed but whose /api/machines/register call hasn't succeeded yet (survives reloads). */
interface PendingReg extends RegisterBody { token?: string; ticker: string }
const PENDING_KEY = 'gf:pendingRegister';
const loadPending = (): PendingReg | null => { try { const v = localStorage.getItem(PENDING_KEY); return v ? (JSON.parse(v) as PendingReg) : null; } catch { return null; } };
const savePending = (p: PendingReg | null) => { try { if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else localStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Phase = 'idle' | 'upload' | 'mine' | 'sign' | 'register' | 'done';

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
  const [file, setFile] = useState<File | null>(null);
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

  const ot = useOffT();
  const w = useWallet();
  const router = useRouter();
  const client = usePublicClient({ chainId: bsc.id });
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const tx = useTx();
  const [phase, setPhase] = useState<Phase>('idle');
  const [mining, setMining] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReg | null>(null);
  const [regErr, setRegErr] = useState<string | null>(null);
  useEffect(() => { setPending(loadPending()); }, []);

  const valid = name.trim().length > 0 && t.length > 0 && Number.isFinite(buyBnb) && buyBnb >= 0;
  const busy = phase !== 'idle' && phase !== 'done';

  /** POST /api/machines/register with a few retries (the backend may need a block or two to see the tx). */
  const register = async (p: PendingReg) => {
    setPhase('register');
    setRegErr(null);
    // The launch tx sender signs the canonical message so nobody else can pick pack/strategy (EIP-191 personal_sign).
    if (!p.signature) {
      if (!p.token) { setRegErr('Register failed: token address unknown'); setPhase('idle'); return; }
      try {
        const signature = await signMessageAsync({ message: registerMessage({ token: p.token, pack: p.pack, strategy: p.strategy, split: p.split, chainId: bsc.id }) });
        p = { ...p, signature };
        savePending(p);
        setPending(p);
      } catch (e) {
        setRegErr((e as Error).message || 'Signature rejected');
        setPhase('idle');
        return;
      }
    }
    let last: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await registerMachine({ txHash: p.txHash, pack: p.pack, strategy: p.strategy, split: p.split, signature: p.signature });
        savePending(null);
        setPending(null);
        setPhase('done');
        router.push(`/m/${r.address ?? p.token}`);
        return;
      } catch (e) {
        last = e;
        const status = (e as { status?: number }).status;
        if (status === 401) { p = { ...p, signature: undefined }; savePending(p); setPending(p); break; } // bad signature: re-sign on retry
        if (status && status >= 400 && status < 500 && status !== 404 && status !== 409 && status !== 425) break; // verification rejected
        await sleep(2500 * (i + 1));
      }
    }
    setRegErr(last instanceof Error ? last.message : 'Register failed');
    setPhase('idle');
  };

  const launch = async () => {
    if (!valid || !file || !w.address || !client) return;
    setErr(null);
    setRegErr(null);
    tx.reset();
    let stage: Phase = 'upload';
    try {
      // 1. image + metadata → flap.sh IPFS (returns metadata CID for `meta`)
      setPhase('upload');
      const cid = await uploadFlapMetadata(file, { description: desc, website: web, twitter: x, telegram: tg, creator: w.address });

      // 2. vanity salt: Portal CREATE2 clone of Tax Token V3 impl must end in 7777 and be unused
      stage = 'mine';
      setPhase('mine');
      setMining(0);
      let salt: Hex, predicted: Address;
      for (;;) {
        ({ salt, token: predicted } = await mineVanitySalt((n) => setMining(n)));
        const code = await client.getCode({ address: predicted });
        if (!code || code === '0x') break;
      }

      // 3. Portal.newTokenV6 from the creator's wallet. Tax 2%/2% → 100% (mktBps) to the GachaForge treasury.
      stage = 'sign';
      setPhase('sign');
      const value = parseEther(String(buyBnb));
      const receipt = await tx.run(() => writeContractAsync({
        address: FLAP_PORTAL, abi: flapPortalAbi, functionName: 'newTokenV6', chainId: bsc.id, value,
        args: [{
          name: name.trim(), symbol: t, meta: cid,
          dexThresh: DEX_THRESH_FOUR_FIFTHS, salt, migratorType: MIGRATOR_V2,
          quoteToken: NATIVE, quoteAmt: value, beneficiary: TREASURY_ADDRESS,
          permitData: '0x', extensionID: ZERO_HASH, extensionData: '0x',
          dexId: DEX0_PANCAKE, lpFeeProfile: LP_FEE_STANDARD,
          buyTaxRate: TAX_BPS, sellTaxRate: TAX_BPS,
          taxDuration: FLAP_TAX_DURATION, antiFarmerDuration: FLAP_ANTI_FARMER_DURATION,
          mktBps: 10_000, deflationBps: 0, dividendBps: 0, lpBps: 0,
          minimumShareBalance: BigInt(0), dividendToken: NATIVE, commissionReceiver: NATIVE,
          tokenVersion: TOKEN_TAXED_V3,
        }],
      }), `Launch $${t}`);
      if (!receipt) { setPhase('idle'); return; }
      const ev = parseEventLogs({ abi: flapPortalAbi, logs: receipt.logs, eventName: 'TokenCreated' })
        .find((l) => isAddressEqual(l.address, FLAP_PORTAL));
      const token = ev?.args.token ?? predicted;

      // 4. record pack/strategy off-chain (immutable once registered)
      const p: PendingReg = {
        txHash: receipt.transactionHash as Hash, pack, strategy, token, ticker: t,
        ...(strategy === 'SPLIT' ? { split: { dividendBps: split.dividend * 100, burnBps: split.burn * 100, lpBps: split.lp * 100 } } : {}),
      };
      savePending(p);
      setPending(p);
      await register(p);
    } catch (e) {
      setErr(stage === 'upload' ? `${ot('l_upload_fail')}: ${(e as Error).message}` : (e as Error).message || 'Failed');
      setPhase('idle');
    }
  };

  const steps: { k: Phase; label: string }[] = [
    { k: 'upload', label: ot('l_step_upload') }, { k: 'mine', label: ot('l_step_mine') },
    { k: 'sign', label: ot('l_step_sign') }, { k: 'register', label: ot('l_step_register') },
  ];
  const order: Phase[] = ['upload', 'mine', 'sign', 'register', 'done'];
  const at = order.indexOf(phase);
  const btnLabel = phase === 'upload' ? ot('l_uploading')
    : phase === 'mine' ? ot('l_mining', { n: Math.round(mining / 1000) })
    : phase === 'sign' ? ot('l_launching')
    : phase === 'register' ? ot('l_registering')
    : !valid ? ot('l_enter') : !file ? ot('l_need_image') : ot('l_launch', { t });
  const treasuryShort = `${TREASURY_ADDRESS.slice(0, 6)}…${TREASURY_ADDRESS.slice(-4)}`;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10">
      <h1 className="font-display text-3xl font-extrabold uppercase sm:text-[2.6rem]">Launch a <span className="neon-text text-accent">machine</span></h1>
      <p className="mt-2 max-w-2xl text-muted">{ot('l_sub')}</p>
      {pending && phase === 'idle' && (
        <div role="alert" className="mt-6 flex flex-col gap-3 rounded-md border-2 border-accent bg-accent-soft/40 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-display font-bold uppercase">{ot('l_pending')} · ${pending.ticker}</div>
            <p className="mt-1 text-fg/90">{ot('l_reg_fail')} {ot('l_reg_note')}</p>
            {regErr && <p className="mt-1 font-mono text-xs text-danger">{regErr}</p>}
            <a href={txUrl(pending.txHash)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-xs text-muted underline">{short(pending.txHash)} ↗</a>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-chunky px-4 py-2 text-sm" onClick={() => register(pending)}>{ot('l_reg_retry')}</button>
            <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => { savePending(null); setPending(null); }}>{ot('l_dismiss')}</button>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Step n={1} title="Token info">
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <label className="grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-lg border-2 border-dashed border-line bg-bg text-center text-xs text-muted hover:border-accent">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="preview" className="h-full w-full object-cover" />
                ) : <span>Upload image<br />PNG / JPG / GIF</span>}
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setImg(URL.createObjectURL(f)); } }} />
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
              <div className="rounded-md border-2 border-accent/60 bg-bg p-3 text-xs leading-relaxed">
                <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-wide text-accent">{ot('l_before')}</div>
                <p className="text-fg">{ot('l_disclose', { treasury: treasuryShort })}</p>
                <a href={addrUrl(TREASURY_ADDRESS)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[10px] text-muted underline hover:text-fg">{TREASURY_ADDRESS} ↗</a>
              </div>
              {busy && (
                <ol className="space-y-1 text-xs">
                  {steps.map((st, i) => (
                    <li key={st.k} className={`flex items-center gap-2 ${i < at ? 'text-success' : i === at ? 'text-fg' : 'text-muted'}`}>
                      <span className="w-4 text-center font-mono">{i < at ? '✓' : i === at ? '›' : '·'}</span>{st.label}
                    </li>
                  ))}
                </ol>
              )}
              <ActionButton onClick={launch} busy={busy || tx.busy} disabled={!valid || !file}>
                {btnLabel}
              </ActionButton>
              <TxStatus state={tx.state} />
              {err && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">✕ {err}</div>}
              {pending && phase === 'idle' && <a href={`/m/${pending.token}`} className="block text-center text-sm text-accent underline">{ot('l_open')}</a>}
              <p className="text-center text-xs text-muted">{ot('l_via')}</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
