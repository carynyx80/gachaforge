import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getActivity, getMachine, getMachinePulls, getMachineTrades } from '@/lib/api';
import { MachineView } from '@/components/machine/MachineView';
import { LiveRefresh } from '@/components/LiveRefresh';
import { PageLoading } from '@/components/PageLoading';

async function MachineData({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const machine = await getMachine(address);
  if (!machine) notFound();
  const [pulls, trades, activity] = await Promise.all([
    getMachinePulls(machine.address), getMachineTrades(machine.address), getActivity(100),
  ]);
  const acts = activity.filter((a) => a.machine.toLowerCase() === machine.address.toLowerCase());
  return <MachineView m={machine} pulls={pulls.items} trades={trades.items} activity={acts} />;
}

export default function MachinePage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <>
      <LiveRefresh />
      <Suspense fallback={<PageLoading label="Loading machine…" />}>
        <MachineData params={params} />
      </Suspense>
    </>
  );
}
