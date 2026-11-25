export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-24">
      <div className="flex items-center gap-3 font-mono text-sm text-muted">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
        {label}
      </div>
    </div>
  );
}
