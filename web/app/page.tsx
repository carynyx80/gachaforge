import { Suspense } from 'react';
import { getAboutToRip, getActivity, getAllMachines, getRecentPulls, getStats } from '@/lib/api';
import { Hero } from '@/components/Hero';
import { Ticker } from '@/components/Ticker';
import { Scoreboard } from '@/components/Scoreboard';
import { RecentPulls } from '@/components/RecentPulls';
import { AboutToRip } from '@/components/AboutToRip';
import { Board } from '@/components/Board';
import { LiveRefresh } from '@/components/LiveRefresh';
import { FeeFlow } from '@/components/live/FeeFlow';
import { PageLoading } from '@/components/PageLoading';
import { ForgeBanner } from '@/components/forge/ForgeBanner';

async function HomeData() {
  const [stats, activity, pulls, rip, machines] = await Promise.all([
    getStats(), getActivity(40), getRecentPulls(8), getAboutToRip(), getAllMachines(),
  ]);
  return (
    <>
      <Ticker events={activity} />
      <Scoreboard stats={stats} />
      <FeeFlow />
      <div className="mx-auto grid max-w-7xl gap-8 px-4 pt-16 lg:grid-cols-[1.6fr_1fr]">
        <RecentPulls pulls={pulls} />
        <AboutToRip machines={rip} />
      </div>
      <Board machines={machines} />
    </>
  );
}

export default function Home() {
  return (
    <>
      <LiveRefresh />
      <ForgeBanner />
      <Hero />
      <Suspense fallback={<PageLoading label="Loading machines…" />}>
        <HomeData />
      </Suspense>
    </>
  );
}
