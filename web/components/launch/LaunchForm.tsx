'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { PackId, Strategy } from '@/lib/types';
import { PACK_PRICE } from '@/lib/types';
import {
  CREATOR_POT_MIN_BPS, CREATOR_SHARE_PCT, MACHINE_TAX_DEFAULT_PCT, MACHINE_TAX_OPTIONS, POT_SHARE_DEFAULT_BPS, POT_SHARE_MAX_BPS,
  machineSplit, type MachineSplit,
} from '@/lib/economics';
import { STRATEGY_INFO } from '@/lib/strategies';
import { short, usd } from '@/lib/format';
import { isAddress, isAddressEqual, parseEther, parseEventLogs, type Address, type Hash, type Hex } from 'viem';
import { usePublicClient, useSignMessage, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import {
  FLAP_ANTI_FARMER_DURATION, FLAP_PORTAL, FLAP_TAX_DURATION, NATIVE, TREASURY_ADDRESS, ZERO_HASH, addrUrl, txUrl,
} from '@/lib/chain';
import { flapPortalAbi } from '@/lib/abi/flapPortal';
import { mineVanitySalt } from '@/lib/vanity';
import { uploadFlapMetadata } from '@/lib/flapUpload';
import { registerMachine, type RegisterBody } from '@/lib/api';
import { registerMessage as buildRegisterMessage } from '@/lib/registerMessage';
import { ActionButton } from '../wallet/ActionButton';
import { useTx } from '../wallet/tx';
import { useWallet } from '../wallet/useWallet';
import { useOffT } from '../useOffchain';
import type { OffKey } from '@/lib/offchain-i18n';

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
const loadPending = (): PendingReg | null => {
  try {
    const v = localStorage.getItem(PENDING_KEY);
    if (!v) return null;
    const p = JSON.parse(v) as PendingReg;
    return typeof p.buyTaxBps === 'number' && typeof p.potShareBps === 'number' && p.payout ? p : null; // pre-v3 entries can't be re-signed
  } catch { return null; }
};
const savePending = (p: PendingReg | null) => { try { if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else localStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Phase = 'idle' | 'upload' | 'mine' | 'sign' | 'register' | 'done';
type Prog = 'upload' | 'mine' | 'wallet' | 'confirm' | 'register' | 'done';
const PROG: { k: Prog; label: OffKey }[] = [
  { k: 'upload', label: 'pg_upload' }, { k: 'mine', label: 'pg_mine' }, { k: 'wallet', label: 'pg_wallet' },
  { k: 'confirm', label: 'pg_confirm' }, { k: 'register', label: 'pg_register' }, { k: 'done', label: 'pg_done' },
];

const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i;
const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
const inputCls = (bad?: boolean) =>
  `block w-full min-w-0 rounded-md border bg-bg px-3 py-2.5 text-sm text-fg placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 ${bad ? 'border-danger' : 'border-line'}`;

/** Segment colours of the split bar (same order everywhere). */
const SEG = [
  { k: 'flap', color: '#8E9686', label: 'bk_flap' },
  { k: 'company', color: '#F4F7EE', label: 'bk_company' },
  { k: 'buyback', color: '#D4FF7A', label: 'bk_forge' },
  { k: 'pot', color: '#B6FF2E', label: 'bk_pot' },
  { k: 'creator', color: '#3DDC97', label: 'bk_creator' },
] as const satisfies readonly { k: keyof MachineSplit; color: string; label: OffKey }[];

const dollars = (n: number) => '$' + n.toFixed(2);

// ------------------------------------------------------------------ building blocks
function Section({ n, title, id, children }: { n: number; title: string; id: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="panel min-w-0 scroll-mt-24 p-4 sm:p-6">
      <h2 id={`${id}-h`} className="mb-5 flex min-w-0 items-center gap-3 font-display text-base font-extrabold uppercase tracking-wide sm:text-lg">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-black">{n}</span>
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Field({ id, label, aside, hint, error, children }: { id: string; label: string; aside?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-w-0 items-baseline justify-between gap-2">
        <label htmlFor={id} className="min-w-0 truncate text-sm font-semibold text-fg">{label}</label>
        {aside && <span className="shrink-0 text-xs text-muted">{aside}</span>}
      </div>
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="mt-1.5 text-xs text-danger">{error}</p>
        : hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

function SplitBar({ s, className = 'h-3' }: { s: MachineSplit; className?: string }) {
  return (
    <div className={`flex w-full overflow-hidden rounded-sm bg-black/60 ring-1 ring-line ${className}`} aria-hidden>
      {SEG.map((g) => (
        <span key={g.k} className="h-full transition-[width] duration-300" style={{ width: `${s.tax ? (s[g.k] / s.tax) * 100 : 0}%`, background: g.color }} />
      ))}
    </div>
  );
}

function TaxPicker({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 flex w-full items-baseline justify-between gap-2 text-sm font-semibold">
        <span>{label}</span><span className="font-mono text-accent">{value}%</span>
      </legend>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {MACHINE_TAX_OPTIONS.map((p) => {
          const on = p === value;
          return (
            <button key={p} type="button" role="radio" aria-checked={on} id={`${id}-${p}`} onClick={() => onChange(p)}
              className={`h-10 min-w-0 rounded-md border-2 font-mono text-sm font-bold transition ${ring} ${on ? 'border-accent bg-accent text-black' : 'border-line bg-bg text-muted hover:border-accent/60 hover:text-fg'}`}>
              {p}%
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ form
export function LaunchForm() {
  const ot = useOffT();
  const w = useWallet();
  const router = useRouter();
  const client = usePublicClient({ chainId: bsc.id });
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const tx = useTx();

  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [desc, setDesc] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [x, setX] = useState('');
  const [tg, setTg] = useState('');
  const [web, setWeb] = useState('');
  const [pack, setPack] = useState<PackId>('FORGE_48');
  const [strategy, setStrategy] = useState<Strategy>('RAFFLE');
  const [split, setSplit] = useState({ dividend: 50, burn: 30, lp: 20 });
  const [buyTax, setBuyTax] = useState(MACHINE_TAX_DEFAULT_PCT);
  const [sellTax, setSellTax] = useState(MACHINE_TAX_DEFAULT_PCT);
  const [potPct, setPotPct] = useState(POT_SHARE_DEFAULT_BPS / 100);
  const [payout, setPayout] = useState('');
  const [payoutTouched, setPayoutTouched] = useState(false);
  const [buy, setBuy] = useState('0.1');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [mining, setMining] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReg | null>(null);
  const [regErr, setRegErr] = useState<string | null>(null);
  useEffect(() => { setPending(loadPending()); }, []);

  // Payout defaults to the connected wallet until the creator edits it.
  useEffect(() => { if (!payoutTouched && w.address) setPayout(w.address); }, [w.address, payoutTouched]);

  const setPart = (k: keyof typeof split, v: number) => {
    // keep sum at 100 by redistributing the remainder across the other two, proportionally
    const others = (Object.keys(split) as (keyof typeof split)[]).filter((o) => o !== k);
    const rest = 100 - v;
    const curRest = others.reduce((a, o) => a + split[o], 0);
    const a = curRest ? Math.round((split[others[0]] / curRest) * rest) : Math.round(rest / 2);
    setSplit({ ...split, [k]: v, [others[0]]: a, [others[1]]: rest - a } as typeof split);
  };

  const onFile = (f?: File | null) => {
    if (!f || !/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) return;
    setFile(f);
    setImg((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
    setTouched((t) => ({ ...t, image: true }));
  };

  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const buyBnb = Number(buy);
  const potShareBps = potPct * 100;
  const sBuy = useMemo(() => machineSplit(buyTax * 100, potShareBps), [buyTax, potShareBps]);
  const sSell = useMemo(() => machineSplit(sellTax * 100, potShareBps), [sellTax, potShareBps]);

  const errors: Record<string, string | null> = {
    image: file ? null : ot('e_image'),
    name: name.trim() ? null : ot('e_name'),
    ticker: t ? null : ot('e_ticker'),
    x: !x.trim() || URL_RE.test(x.trim()) ? null : ot('e_url'),
    tg: !tg.trim() || URL_RE.test(tg.trim()) ? null : ot('e_url'),
    web: !web.trim() || URL_RE.test(web.trim()) ? null : ot('e_url'),
    payout: isAddress(payout.trim()) ? null : ot('e_payout'),
    buy: buy.trim() !== '' && Number.isFinite(buyBnb) && buyBnb >= 0 ? null : ot('e_buy'),
  };
  const errCount = Object.values(errors).filter(Boolean).length;
  const show = (k: string) => (attempted || touched[k] ? errors[k] : null);
  const touch = (k: string) => () => setTouched((s) => ({ ...s, [k]: true }));
  const busy = phase !== 'idle' && phase !== 'done';

  /** Sign (if needed) + POST /api/machines/register with a few retries (the backend may need a block or two). */
  const register = async (p: PendingReg) => {
    setPhase('register');
    setRegErr(null);
    // The launch tx sender signs the canonical message so nobody else can pick tax split / payout / pack / strategy.
    if (!p.signature) {
      if (!p.token) { setRegErr('Register failed: token address unknown'); setPhase('idle'); return; }
      try {
        const message = buildRegisterMessage({
          token: p.token, pack: p.pack, strategy: p.strategy, split: p.split ?? null,
          buyTaxBps: p.buyTaxBps, sellTaxBps: p.sellTaxBps, potShareBps: p.potShareBps, payout: p.payout, chainId: bsc.id,
        });
        const signature = await signMessageAsync({ message });
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
        const { token: _t, ticker: _k, ...body } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
        const r = await registerMachine(body);
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

  const formTop = useRef<HTMLDivElement>(null);
  const launch = async () => {
    if (errCount > 0) {
      setAttempted(true);
      const first = Object.keys(errors).find((k) => errors[k]);
      document.getElementById(`f-${first}`)?.focus({ preventScroll: true });
      document.getElementById(`f-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!file || !w.address || !client) return;
    setErr(null);
    setRegErr(null);
    tx.reset();
    let stage: Phase = 'upload';
    try {
      // 1. image + metadata → flap.sh IPFS (returns metadata CID for `meta`)
      setPhase('upload');
      const cid = await uploadFlapMetadata(file, { description: desc, website: web.trim(), twitter: x.trim(), telegram: tg.trim(), creator: w.address });

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

      // 3. Portal.newTokenV6 from the creator's wallet. Creator-chosen tax → 100% (mktBps) to the GachaForge ops wallet.
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
          buyTaxRate: buyTax * 100, sellTaxRate: sellTax * 100,
          taxDuration: FLAP_TAX_DURATION, antiFarmerDuration: FLAP_ANTI_FARMER_DURATION,
          mktBps: 10_000, deflationBps: 0, dividendBps: 0, lpBps: 0,
          minimumShareBalance: BigInt(0), dividendToken: NATIVE, commissionReceiver: NATIVE,
          tokenVersion: TOKEN_TAXED_V3,
        }],
      }), `Launch $${t}`);
      if (!receipt) { setPhase('idle'); setErr(null); return; }
      const ev = parseEventLogs({ abi: flapPortalAbi, logs: receipt.logs, eventName: 'TokenCreated' })
        .find((l) => isAddressEqual(l.address, FLAP_PORTAL));
      const token = ev?.args.token ?? predicted;

      // 4. record tax split / payout / pack / strategy off-chain (immutable once registered)
      const p: PendingReg = {
        txHash: receipt.transactionHash as Hash, pack, strategy, token, ticker: t,
        buyTaxBps: buyTax * 100, sellTaxBps: sellTax * 100, potShareBps, payout: payout.trim(),
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

  // progress state for the review step
  const prog: Prog | null = phase === 'upload' ? 'upload' : phase === 'mine' ? 'mine'
    : phase === 'sign' ? (tx.state.s === 'confirming' || tx.state.s === 'success' ? 'confirm' : 'wallet')
    : phase === 'register' ? 'register' : phase === 'done' ? 'done' : null;
  const progAt = prog ? PROG.findIndex((p) => p.k === prog) : -1;
  const btnLabel = phase === 'upload' ? ot('l_uploading')
    : phase === 'mine' ? ot('l_mining', { n: Math.round(mining / 1000) })
    : prog === 'wallet' ? ot('l_wallet')
    : prog === 'confirm' ? ot('l_confirming')
    : phase === 'register' ? ot('l_registering')
    : phase === 'done' ? ot('l_done')
    : attempted && errCount ? ot('e_fix', { n: errCount }) : ot('l_launch', { t: t || 'TOKEN' });
  const treasuryShort = `${TREASURY_ADDRESS.slice(0, 6)}…${TREASURY_ADDRESS.slice(-4)}`;
  const payoutShort = isAddress(payout.trim()) ? short(payout.trim()) : '—';
  const youPct = 100 - potPct;
  const total = Number.isFinite(buyBnb) && buyBnb > 0 ? buyBnb : 0;

  const launchBtn = (cls = '') => (
    <ActionButton onClick={launch} busy={busy || tx.busy} className={cls}>
      <span className="min-w-0 truncate">{btnLabel}</span>
    </ActionButton>
  );

  return (
    <div ref={formTop} className="mx-auto max-w-7xl px-4 pb-32 pt-8 sm:pt-10 lg:pb-16">
      <header className="min-w-0">
        <h1 className="font-display text-[1.75rem] font-extrabold uppercase leading-tight sm:text-[2.4rem]">
          {ot('l_title_1')} <span className="neon-text text-accent">{ot('l_title_2')}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted sm:text-base">{ot('l_sub')}</p>
      </header>

      {pending && phase === 'idle' && (
        <div role="alert" className="mt-6 flex min-w-0 flex-col gap-4 rounded-md border-2 border-accent bg-accent-soft/40 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-display font-bold uppercase">{ot('l_pending')} · ${pending.ticker}</div>
            <p className="mt-1 text-fg/90">{ot('l_reg_fail')} {ot('l_reg_note')}</p>
            {regErr && <p className="mt-1 break-words font-mono text-xs text-danger">{regErr}</p>}
            <a href={txUrl(pending.txHash)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-xs text-muted underline">{short(pending.txHash)} ↗</a>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" className={`btn-chunky px-4 py-2 text-sm ${ring}`} onClick={() => register(pending)}>{ot('l_reg_retry')}</button>
            <button type="button" className={`btn-ghost px-3 py-2 text-sm ${ring}`} onClick={() => { savePending(null); setPending(null); }}>{ot('l_dismiss')}</button>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* ------------------------------------------------ form */}
        <div className="flex min-w-0 flex-col gap-6">
          <Section n={1} id="s-token" title={ot('l_s1')}>
            <div className="grid gap-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="mb-1.5 text-sm font-semibold">{ot('f_image')}</div>
                <label
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
                  className={`group relative grid aspect-square w-full max-w-[10rem] cursor-pointer place-items-center overflow-hidden rounded-lg border-2 border-dashed bg-bg text-center transition focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface ${drag ? 'border-accent bg-accent-soft/40' : show('image') ? 'border-danger' : 'border-line hover:border-accent/70'}`}>
                  {img ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt="" className="h-full w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">{ot('f_image_change')}</span>
                    </>
                  ) : (
                    <span className="px-3 text-xs leading-relaxed text-muted">
                      <span className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-full border-2 border-line text-lg text-fg">+</span>
                      <span className="block">{ot('f_image_drop')}</span><span className="mt-1 block font-mono text-[9px] leading-tight">{ot('f_image_types')}</span>
                    </span>
                  )}
                  <input id="f-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only"
                    aria-invalid={!!show('image')} aria-describedby={show('image') ? 'f-image-err' : undefined}
                    onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
                {show('image') && <p id="f-image-err" role="alert" className="mt-1.5 text-xs text-danger">{show('image')}</p>}
              </div>
              <div className="grid min-w-0 content-start gap-4">
                <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
                  <Field id="f-name" label={ot('f_name')} aside={`${name.length}/32`} error={show('name')}>
                    <input id="f-name" className={inputCls(!!show('name'))} placeholder={ot('f_name_ph')} value={name} maxLength={32}
                      aria-invalid={!!show('name')} onBlur={touch('name')} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field id="f-ticker" label={ot('f_ticker')} error={show('ticker')}>
                    <div className={`flex min-w-0 items-center rounded-md border bg-bg pl-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 ${show('ticker') ? 'border-danger' : 'border-line'}`}>
                      <span className="font-mono text-sm text-muted">$</span>
                      <input id="f-ticker" className="w-full min-w-0 bg-transparent px-1.5 py-2.5 font-mono text-sm uppercase outline-none placeholder:text-muted/70" placeholder="TICKER"
                        value={ticker} maxLength={10} aria-invalid={!!show('ticker')} onBlur={touch('ticker')}
                        onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
                    </div>
                  </Field>
                </div>
                <Field id="f-desc" label={ot('f_desc')} aside={`${desc.length}/280`}>
                  <textarea id="f-desc" className={`${inputCls()} min-h-24 resize-y`} placeholder={ot('f_desc_ph')} value={desc} maxLength={280} onChange={(e) => setDesc(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-3">
              {([['x', ot('f_x'), x, setX, 'https://x.com/…'], ['tg', ot('f_tg'), tg, setTg, 'https://t.me/…'], ['web', ot('f_web'), web, setWeb, 'https://…']] as const).map(([k, label, v, set, ph]) => (
                <Field key={k} id={`f-${k}`} label={label} aside={ot('f_optional')} error={show(k)}>
                  <input id={`f-${k}`} className={inputCls(!!show(k))} placeholder={ph} value={v} inputMode="url" autoComplete="url"
                    aria-invalid={!!show(k)} onBlur={touch(k)} onChange={(e) => set(e.target.value)} />
                </Field>
              ))}
            </div>
          </Section>

          <Section n={2} id="s-pack" title={ot('l_s2')}>
            <div role="radiogroup" aria-label={ot('l_s2')} className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]">
              {PACKS.map((p) => {
                const on = pack === p.id;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPack(p.id)}
                    className={`min-w-0 rounded-lg border-2 p-3 text-left transition sm:p-4 ${ring} ${on ? 'border-accent bg-accent-soft shadow-[4px_4px_0_0_#B6FF2E]' : 'border-line bg-bg hover:border-accent/50'}`}>
                    <div className="font-mono text-2xl font-bold sm:text-3xl">${PACK_PRICE[p.id]}</div>
                    <div className="mt-1 text-xs text-muted">{ot('pk_per')}</div>
                    <div className="text-xs text-muted">{ot('pk_max')} <span className="font-mono text-fg/80">{p.max}</span></div>
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">{ot('pk_hint')}</p>
          </Section>

          <Section n={3} id="s-strategy" title={ot('l_s3')}>
            <div role="radiogroup" aria-label={ot('l_s3')} className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
              {STRATS.map((s) => {
                const i = STRATEGY_INFO[s];
                const on = strategy === s;
                return (
                  <button key={s} type="button" role="radio" aria-checked={on} onClick={() => setStrategy(s)}
                    className={`min-w-0 rounded-lg border-2 p-4 text-left transition ${ring} ${on ? 'border-accent bg-accent-soft shadow-[4px_4px_0_0_#B6FF2E]' : 'border-line bg-bg hover:border-accent/50'}`}>
                    <div className="flex min-w-0 items-center gap-2 text-base font-semibold"><span aria-hidden>{i.icon}</span><span className="truncate">{i.title}</span></div>
                    <div className="mt-1.5 text-xs leading-relaxed text-muted">{i.long}</div>
                  </button>
                );
              })}
            </div>
            {strategy === 'SPLIT' && (
              <div className="mt-4 rounded-lg border border-line bg-bg p-4">
                <div className="mb-4 flex justify-between gap-2 text-sm"><span className="font-semibold">{ot('st_ratio')}</span><span className="font-mono text-success">{ot('st_total')} {split.dividend + split.burn + split.lp}%</span></div>
                <div className="grid gap-4">
                  {(['dividend', 'burn', 'lp'] as const).map((k) => (
                    <label key={k} className="block min-w-0">
                      <div className="mb-1 flex justify-between gap-2 text-xs text-muted"><span className="truncate">{ot(k === 'lp' ? 'st_lp' : k === 'burn' ? 'st_burn' : 'st_dividend')}</span><span className="font-mono text-fg">{split[k]}%</span></div>
                      <input type="range" min={0} max={100} value={split[k]} onChange={(e) => setPart(k, Number(e.target.value))} className="gf-range w-full" style={{ ['--fill' as string]: `${split[k]}%` }} />
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">{ot('st_lp_note')}</p>
              </div>
            )}
          </Section>

          <Section n={4} id="s-tax" title={ot('l_s4')}>
            <div className="grid gap-6">
              <div className="grid gap-4">
                <TaxPicker id="f-buytax" label={ot('tx_buy')} value={buyTax} onChange={setBuyTax} />
                <TaxPicker id="f-selltax" label={ot('tx_sell')} value={sellTax} onChange={setSellTax} />
                <p className="text-xs text-muted">{ot('tx_hint')}</p>
              </div>

              <div className="min-w-0 rounded-lg border border-line bg-bg p-4">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <label htmlFor="f-potshare" className="font-display text-sm font-extrabold uppercase tracking-wide">{ot('ps_title')}</label>
                  <span className="font-mono text-xs text-muted">
                    <span className="text-accent">{potPct}% {ot('ps_pot')}</span> · <span className="text-success">{youPct}% {ot('ps_you')}</span>
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold">{ot('ps_label')}</div>
                <div className="mt-4 px-0.5">
                  <input id="f-potshare" type="range" min={CREATOR_POT_MIN_BPS / 100} max={POT_SHARE_MAX_BPS / 100} step={1} value={potPct}
                    onChange={(e) => setPotPct(Number(e.target.value))} aria-valuetext={`${potPct}% ${ot('ps_pot')}, ${youPct}% ${ot('ps_you')}`}
                    list="potshare-ticks" className="gf-range w-full" style={{ ['--fill' as string]: `${((potPct - 20) / 80) * 100}%` }} />
                  <datalist id="potshare-ticks">{[20, 50, 80, 100].map((v) => <option key={v} value={v} />)}</datalist>
                  <div className="relative mx-2 mt-1 h-5" aria-hidden>
                    {[20, 50, 80, 100].map((v) => {
                      const pos = ((v - 20) / 80) * 100;
                      return (
                        <button key={v} type="button" tabIndex={-1} onClick={() => setPotPct(v)}
                          className={`absolute top-0 flex flex-col items-center font-mono text-[10px] ${potPct === v ? 'text-accent' : 'text-muted'} hover:text-fg`}
                          style={{ left: `${pos}%`, transform: v === 20 ? 'translateX(-0.25rem)' : v === 100 ? 'translateX(calc(-100% + 0.25rem))' : 'translateX(-50%)' }}>
                          <span className="mb-0.5 h-1.5 w-px bg-current" />{v}%
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">{ot('ps_hint')}</p>

                {/* live breakdown */}
                <div className="mt-4 border-t border-line pt-4">
                  <div className="mb-2 flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate font-display text-xs font-extrabold uppercase tracking-wide">{ot('bk_title')}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">{ot('bk_buy')} {buyTax}%</span>
                  </div>
                  <SplitBar s={sBuy} />
                  <table className="mt-3 w-full table-fixed text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                        <th className="w-auto pb-1.5 font-normal" />
                        <th className="w-[4.75rem] pb-1.5 text-right font-normal sm:w-24">{ot('bk_buy')} {buyTax}%</th>
                        <th className="w-[4.75rem] pb-1.5 text-right font-normal sm:w-24">{ot('bk_sell')} {sellTax}%</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <tr className="border-b border-line font-bold">
                        <td className="truncate py-1.5 font-sans">{ot('bk_tax')}</td>
                        <td className="py-1.5 text-right">{dollars(1000 * sBuy.tax)}</td>
                        <td className="py-1.5 text-right">{dollars(1000 * sSell.tax)}</td>
                      </tr>
                      {SEG.map((g) => (
                        <tr key={g.k} className={g.k === 'pot' ? 'text-accent' : g.k === 'creator' ? 'text-success' : ''}>
                          <td className="py-1 font-sans">
                            <span className={`flex min-w-0 items-center gap-2 ${g.k === 'company' || g.k === 'buyback' ? 'pl-3' : ''}`}>
                              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: g.color }} />
                              <span className="truncate">{ot(g.label)}</span>
                            </span>
                          </td>
                          <td className="py-1 text-right">{dollars(1000 * sBuy[g.k])}</td>
                          <td className="py-1 text-right">{dollars(1000 * sSell[g.k])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10px] text-muted">{ot('bk_gf')} = {ot('bk_company')} + {ot('bk_forge')}</p>
                </div>
              </div>

              <Field id="f-payout" label={ot('po_label')} error={show('payout')}
                hint={w.connected ? ot('po_hint') : ot('po_connect')}
                aside={w.address && payout.trim().toLowerCase() !== w.address.toLowerCase()
                  ? <button type="button" className={`rounded text-accent underline ${ring}`} onClick={() => { setPayout(w.address!); setPayoutTouched(false); }}>{ot('po_use')}</button>
                  : undefined}>
                <input id="f-payout" className={`${inputCls(!!show('payout'))} font-mono`} placeholder="0x…" value={payout} spellCheck={false} autoComplete="off"
                  aria-invalid={!!show('payout')} onBlur={touch('payout')} onChange={(e) => { setPayout(e.target.value.trim()); setPayoutTouched(true); }} />
              </Field>
            </div>
          </Section>

          <Section n={5} id="s-buy" title={ot('l_s5')}>
            <Field id="f-buy" label={ot('ib_label')} hint={ot('ib_hint')} error={show('buy')}>
              <div className={`flex min-w-0 items-center rounded-md border bg-bg pr-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 ${show('buy') ? 'border-danger' : 'border-line'}`}>
                <input id="f-buy" value={buy} inputMode="decimal" aria-invalid={!!show('buy')} onBlur={touch('buy')}
                  onChange={(e) => setBuy(e.target.value.replace(/[^0-9.]/g, ''))} className="w-full min-w-0 bg-transparent px-3 py-2.5 font-mono text-sm outline-none" />
                <span className="shrink-0 font-mono text-sm text-muted">BNB</span>
              </div>
            </Field>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {['0', '0.1', '0.5', '1'].map((q) => (
                <button key={q} type="button" onClick={() => setBuy(q)}
                  className={`h-9 rounded-md border font-mono text-xs transition ${ring} ${buy === q ? 'border-accent text-fg' : 'border-line text-muted hover:border-accent/60 hover:text-fg'}`}>{q}</button>
              ))}
            </div>
          </Section>

          <Section n={6} id="s-review" title={ot('l_s6')}>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                [ot('rv_token'), <span key="t" className="flex min-w-0 items-baseline justify-end gap-2"><span className="truncate">{name.trim() || '—'}</span><span className="shrink-0 font-mono text-glow">${t || '—'}</span></span>],
                [ot('rv_pack'), <span key="p" className="font-mono">${PACK_PRICE[pack]}</span>],
                [ot('rv_strategy'), <span key="s" className="truncate">{STRATEGY_INFO[strategy].title}{strategy === 'SPLIT' && <span className="font-mono text-muted"> {split.dividend}/{split.burn}/{split.lp}</span>}</span>],
                [ot('rv_tax'), <span key="x" className="font-mono">{buyTax}% / {sellTax}%</span>],
                [ot('rv_split'), <span key="sp" className="truncate font-mono">{ot('rv_pot_you', { pot: potPct, you: youPct })}</span>],
                [ot('rv_payout'), <span key="po" className="truncate font-mono">{payoutShort}</span>],
                [ot('rv_buy'), <span key="b" className="font-mono">{total} BNB</span>],
                [ot('rv_fee'), <span key="f" className="font-mono">{ot('rv_fee_v')}</span>],
              ] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/70 pb-2">
                  <dt className="shrink-0 text-muted">{k}</dt><dd className="min-w-0 text-right">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 rounded-md border-2 border-accent/60 bg-bg p-4 text-xs leading-relaxed">
              <div className="mb-1.5 font-display text-[11px] font-extrabold uppercase tracking-wide text-accent">{ot('l_before')}</div>
              <p className="break-words text-fg">{ot('l_disclose', { treasury: treasuryShort, payout: payoutShort })}</p>
              <p className="mt-1.5 text-muted">{ot('l_disclose_lock', { buy: buyTax, sell: sellTax })}</p>
              <a href={addrUrl(TREASURY_ADDRESS)} target="_blank" rel="noreferrer" className={`mt-1.5 block truncate font-mono text-[10px] text-muted underline hover:text-fg ${ring}`}>{TREASURY_ADDRESS} ↗</a>
            </div>

            <ol className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Launch progress">
              {PROG.map((p, i) => {
                const st = progAt < 0 ? 'todo' : i < progAt || prog === 'done' ? 'done' : i === progAt ? 'now' : 'todo';
                return (
                  <li key={p.k} aria-current={st === 'now' ? 'step' : undefined}
                    className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-2 text-[11px] sm:gap-2 sm:px-2.5 sm:text-xs ${st === 'done' ? 'border-success/50 text-success' : st === 'now' ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted'}`}>
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold ${st === 'done' ? 'bg-success text-black' : st === 'now' ? 'bg-accent text-black' : 'border border-line'}`}>
                      {st === 'done' ? '✓' : st === 'now' ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-black border-t-transparent" /> : i + 1}
                    </span>
                    <span className="min-w-0 truncate">{ot(p.label)}</span>
                  </li>
                );
              })}
            </ol>
            {tx.state.s === 'confirming' && (
              <a href={txUrl(tx.state.hash)} target="_blank" rel="noreferrer" className="mt-2 block truncate font-mono text-xs text-accent underline">{short(tx.state.hash)} ↗</a>
            )}

            <div className="mt-6">{launchBtn()}</div>
            {(err || (tx.state.s === 'error' && phase === 'idle')) && (
              <div role="alert" className="mt-4 break-words rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">✕ {err || (tx.state.s === 'error' ? tx.state.message : '')}</div>
            )}
            {pending && phase === 'idle' && <a href={`/m/${pending.token}`} className="mt-4 block text-center text-sm text-accent underline">{ot('l_open')}</a>}
            <p className="mt-4 text-center text-xs text-muted">{ot('l_via')}</p>
          </Section>
        </div>

        {/* ------------------------------------------------ sticky summary */}
        <aside className="min-w-0 lg:sticky lg:top-24">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-xs font-extrabold uppercase tracking-wide">{ot('pv_title')}</span>
              <span className="font-mono text-[10px] text-muted">BNB Chain · flap.sh</span>
            </div>
            <div className="flex min-w-0 gap-4 p-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-[radial-gradient(circle_at_30%_25%,#D4FF7A,#3F6B08_70%,#050505)] ring-2 ring-accent/40">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-full w-full object-cover" />
                ) : <span className="font-display text-2xl font-bold text-black/60">{t.slice(0, 2) || '??'}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{name.trim() || ot('pv_machine')}</div>
                <div className="truncate font-mono text-sm font-bold text-glow">${t || 'TICKER'}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded border border-line px-1.5 py-0.5">{STRATEGY_INFO[strategy].icon} {STRATEGY_INFO[strategy].title}</span>
                  <span className="rounded border border-line px-1.5 py-0.5 font-mono">${PACK_PRICE[pack]}</span>
                  <span className="rounded border border-accent/50 px-1.5 py-0.5 font-mono text-accent">{buyTax}% / {sellTax}%</span>
                </div>
              </div>
            </div>
            <div className="space-y-4 border-t border-line p-4">
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold">{ot('rv_split')}</span>
                  <span className="font-mono text-muted">{ot('pv_per_1k')}</span>
                </div>
                <SplitBar s={sBuy} className="h-2.5" />
                <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 font-mono text-[11px] sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {SEG.map((g) => (
                    <li key={g.k} className="flex min-w-0 items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 font-sans text-muted"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: g.color }} /><span className="truncate">{ot(g.label)}</span></span>
                      <span className={g.k === 'pot' ? 'text-accent' : g.k === 'creator' ? 'text-success' : ''}>{dollars(1000 * sBuy[g.k])}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent-soft/50 px-3 py-2 text-xs">
                <span className="text-muted">{ot('pv_pot')}</span><span className="font-mono text-accent">{usd(PACK_PRICE[pack])} {ot('pv_to_rip')}</span>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><span className="text-muted">{ot('rv_payout')}</span><span className="truncate font-mono">{payoutShort}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted">{ot('rv_buy')}</span><span className="font-mono">{total} BNB</span></div>
                <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-semibold"><span>{ot('rv_total')}</span><span className="font-mono">{total.toFixed(4)} BNB</span></div>
              </div>
              <div className="hidden lg:block">{launchBtn()}</div>
            </div>
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------ mobile sticky launch bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-line bg-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-mono text-sm font-bold">{total.toFixed(4)} BNB</div>
            <div className="truncate font-mono text-[11px] text-muted">{buyTax}% / {sellTax}% · {potPct}% {ot('ps_pot')}</div>
          </div>
          <div className="w-[58%] max-w-xs shrink-0">{launchBtn('!py-2.5 text-sm')}</div>
        </div>
      </div>
    </div>
  );
}
