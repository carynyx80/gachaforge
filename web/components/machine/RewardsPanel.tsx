'use client';
import { useQuery } from '@tanstack/react-query';
import { formatEther, isAddress, type Address, type Hex } from 'viem';
import { useReadContract, useReadContracts, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import type { Machine } from '@/lib/types';
import { getClaims, getRewards } from '@/lib/api';
import { num } from '@/lib/format';
import { CONTRACTS_LIVE, FACTORY_ADDRESS } from '@/lib/chain';
import { machineVaultAbi } from '@/lib/abi/machineVault';
import { gachaForgeFactoryAbi } from '@/lib/abi/gachaForgeFactory';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus, useTx } from '../wallet/tx';
import { useWallet } from '../wallet/useWallet';

export function RewardsPanel({ m }: { m: Machine }) {
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
