'use client';
import { useQuery } from '@tanstack/react-query';
import { formatEther, isAddress, type Address, type Hex } from 'viem';
import { useReadContract, useReadContracts, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import type { Machine } from '@/lib/types';
import { getClaims, getRewards, getTransparency } from '@/lib/api';
import { ago, num, short } from '@/lib/format';
import { MIN_HOLD_TOKENS } from '@/lib/economics';
import { CONTRACTS_LIVE, FACTORY_ADDRESS, txUrl } from '@/lib/chain';
import { machineVaultAbi } from '@/lib/abi/machineVault';
import { gachaForgeFactoryAbi } from '@/lib/abi/gachaForgeFactory';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus, useTx } from '../wallet/tx';
import { useWallet } from '../wallet/useWallet';
import { useOffT } from '../useOffchain';

/**
 * Rewards. Off-chain mode (no GachaForge contracts, i.e. NEXT_PUBLIC_FACTORY_ADDRESS unset): nothing to
 * claim — dividends are pushed by the backend ops wallet. Shows eligibility, odds, paid-so-far and payouts.
 */
export function RewardsPanel({ m }: { m: Machine }) {
  return CONTRACTS_LIVE ? <VaultRewardsPanel m={m} /> : <OffchainRewardsPanel m={m} />;
}

const PAYOUT_KIND = /DIVIDEND|PAYOUT/i;

function OffchainRewardsPanel({ m }: { m: Machine }) {
  const t = useOffT();
  const w = useWallet();
  const rewards = useQuery({
    queryKey: ['rewards', m.address, w.address],
    queryFn: () => getRewards(m.address, w.address!),
    enabled: !!w.address,
    refetchInterval: 30_000,
  });
  // Machine-level payouts from the public ops-wallet log (fallback when the rewards view has none).
  const transparency = useQuery({ queryKey: ['transparency'], queryFn: getTransparency, refetchInterval: 60_000, retry: false });
  const r = rewards.data;
  const mine = r?.payouts;
  const machinePayouts = (transparency.data?.txs ?? []).filter((x) => PAYOUT_KIND.test(x.kind) && x.machine?.toLowerCase() === m.address.toLowerCase());
  const list = mine ?? (transparency.data ? machinePayouts.map((x) => ({ amountBnb: x.valueBnb ?? 0, txHash: x.hash, timestamp: x.timestamp ?? 0, to: x.to })) : undefined);
  const paidRaw = r?.paidBnb ?? r?.totalEarnedBnb;
  const paid = typeof paidRaw === 'number' && Number.isFinite(paidRaw) ? paidRaw : undefined;

  return (
    <div className="panel p-4">
      <h3 className="font-display text-lg font-bold uppercase tracking-wide">{t('r_title')}</h3>
      {!w.connected ? (
        <p className="mt-1 text-sm text-muted">{t('r_connect', { min: MIN_HOLD_TOKENS.toLocaleString('en-US'), t: m.ticker })}</p>
      ) : rewards.isLoading ? (
        <p className="mt-2 text-sm text-muted">{t('r_loading')}</p>
      ) : rewards.isError || !r ? (
        <p className="mt-2 text-sm text-danger">{t('r_error')}</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">{t('r_status')}</span>
            <span className={`rounded px-2 py-0.5 font-display text-xs font-bold uppercase tracking-wide ${r.eligible ? 'bg-accent text-black' : 'border border-line text-muted'}`}>{r.eligible ? t('r_eligible') : t('r_not')}</span>
          </div>
          <div className="flex justify-between"><span className="text-muted">{t('r_balance')}</span><span className="font-mono">{num(r.balance)} {m.ticker}</span></div>
          {!r.eligible && <div className="flex justify-between"><span className="text-muted">{t('r_needed')}</span><span className="font-mono">{num(r.minBalance)} {m.ticker}</span></div>}
          <div className="flex justify-between"><span className="text-muted">{t('r_odds')}</span><span className="font-mono">{r.oddsPct.toFixed(2)}%</span></div>
          {paid !== undefined && (
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>{t('r_paid')}</span><span className="font-mono text-accent">{paid.toFixed(4)} BNB</span></div>
          )}
        </div>
      )}
      <p className="mt-3 rounded-md border border-accent/30 bg-accent-soft/40 px-3 py-2 text-xs text-fg/90">{t('r_auto')}</p>
      {list && (
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-widest text-muted">{t('r_recent')}</div>
          {list.length === 0 ? (
            <p className="mt-1 text-xs text-muted">{t('r_none')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-line font-mono text-xs">
              {list.slice(0, 5).map((p) => (
                <li key={p.txHash} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-accent">+{p.amountBnb.toFixed(4)} BNB</span>
                  {'to' in p && p.to ? <span className="text-muted">{short(p.to as string)}</span> : null}
                  <a href={txUrl(p.txHash)} target="_blank" rel="noreferrer" className="text-muted hover:text-fg">{p.timestamp ? ago(p.timestamp) : 'tx'} ↗</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function VaultRewardsPanel({ m }: { m: Machine }) {
  const w = useWallet();
  const vault = m.vault as Address;

  const rewards = useQuery({
    queryKey: ['rewards', m.address, w.address],
    queryFn: () => getRewards(m.address, w.address!),
    enabled: !!w.address,
    refetchInterval: 30_000,
  });
  const claims = useQuery({
    queryKey: ['claims', m.address, w.address],
    queryFn: () => getClaims(m.address, w.address!),
    enabled: !!w.address,
  });

  // Real vault = registered with the configured factory on BSC.
  const { data: isVault } = useReadContract({
    address: FACTORY_ADDRESS, abi: gachaForgeFactoryAbi, functionName: 'isVault', args: [vault], chainId: bsc.id,
    query: { enabled: CONTRACTS_LIVE && isAddress(m.vault) },
  });
  const claimable = CONTRACTS_LIVE && isVault === true;

  const items = claims.data?.items ?? [];
  const onchain = useReadContracts({
    contracts: items.map((c) => ({ address: vault, abi: machineVaultAbi, functionName: 'claimed' as const, args: [BigInt(c.epoch), w.address!] as const, chainId: bsc.id })),
    query: { enabled: claimable && !!w.address && items.length > 0 },
  });
  const open = items.filter((c, i) => !claimable || onchain.data?.[i]?.result !== true);
  const openWei = open.reduce((a, c) => a + BigInt(c.amountWei), BigInt(0));

  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const claimAll = async () => {
    for (const c of open) {
      const r = await tx.run(() => writeContractAsync({
        address: vault, abi: machineVaultAbi, functionName: 'claim', chainId: bsc.id,
        args: [BigInt(c.epoch), BigInt(c.amountWei), c.proof as Hex[]],
      }), `Claim round ${c.epoch}`);
      if (!r) break;
    }
    onchain.refetch(); claims.refetch(); rewards.refetch();
  };

  const r = rewards.data;
  const claimableBnb = items.length ? Number(formatEther(openWei)) : r?.claimableBnb ?? 0;

  return (
    <div className="panel p-4">
      <h3 className="font-display text-lg font-bold uppercase tracking-wide">Your rewards</h3>
      {!w.connected ? (
        <p className="mt-1 text-sm text-muted">Connect a wallet to see your eligibility, odds and claimable BNB. Hold ≥ 100,000 ${m.ticker} (0.01% of supply) at snapshot to qualify.</p>
      ) : rewards.isLoading ? (
        <p className="mt-2 text-sm text-muted">Loading your position…</p>
      ) : rewards.isError || !r ? (
        <p className="mt-2 text-sm text-danger">Couldn’t load rewards. Try again shortly.</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Status</span>
            <span className={`rounded px-2 py-0.5 font-display text-xs font-bold uppercase tracking-wide ${r.eligible ? 'bg-accent text-black' : 'border border-line text-muted'}`}>{r.eligible ? 'Eligible' : 'Not eligible'}</span>
          </div>
          <div className="flex justify-between"><span className="text-muted">Your balance</span><span className="font-mono">{num(r.balance)} {m.ticker}</span></div>
          {!r.eligible && <div className="flex justify-between"><span className="text-muted">Needed</span><span className="font-mono">{num(r.minBalance)} {m.ticker}</span></div>}
          <div className="flex justify-between"><span className="text-muted">Raffle odds</span><span className="font-mono">{r.oddsPct.toFixed(2)}%</span></div>
          <div className="flex justify-between"><span className="text-muted">Total earned</span><span className="font-mono">{r.totalEarnedBnb.toFixed(4)} BNB</span></div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Claimable</span><span className="font-mono text-accent">{claimableBnb.toFixed(4)} BNB</span></div>
        </div>
      )}
      <div className="mt-3">
        <ActionButton variant="ghost" onClick={claimAll} busy={tx.busy}
          disabledLabel={!claimable ? 'Live after mainnet launch' : undefined}
          disabled={open.length === 0 || openWei === BigInt(0)}>
          {tx.busy ? 'Claiming…' : open.length === 0 ? 'Nothing to claim' : `Claim ${Number(formatEther(openWei)).toFixed(4)} BNB${open.length > 1 ? ` (${open.length} rounds)` : ''}`}
        </ActionButton>
      </div>
      <TxStatus state={tx.state} />
    </div>
  );
}
