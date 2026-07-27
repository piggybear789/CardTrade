export default function ListingsLoading() {
  return (
    <main id="main-content" tabIndex={-1}
      className="flex min-h-0 w-full flex-1 flex-col focus:outline-none"
      aria-busy="true" aria-label="Loading marketplace">
      <p className="sr-only" role="status">Loading marketplace…</p>
      <div className="px-4 pt-5 sm:px-6 lg:hidden" aria-hidden="true">
        <div className="h-3 w-24 animate-pulse rounded bg-gold/25 motion-reduce:animate-none" />
        <div className="mt-2 h-9 w-44 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row" aria-hidden="true">
        <aside className="hidden shrink-0 border-r border-border/80 bg-card/90 px-5 lg:block lg:w-[220px] xl:w-[250px] 2xl:w-[270px]">
          <div className="space-y-3 py-7">
            <div className="h-3 w-24 animate-pulse rounded bg-gold/25 motion-reduce:animate-none" />
            <div className="h-9 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="mt-6 h-10 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            {[78, 92, 70, 84, 74].map((width) => (
              <div key={width} className="h-9 animate-pulse rounded bg-muted motion-reduce:animate-none"
                style={{ width: `${width}%` }} />
            ))}
          </div>
        </aside>
        <section className="min-w-0 flex-1 px-4 pb-10 pt-5 sm:px-6 lg:px-7 lg:py-7 xl:px-8">
          <div className="border-b border-border/70 pb-4">
            <div className="h-8 w-52 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-lg border bg-card">
                <div className="aspect-[4/5] animate-pulse bg-muted motion-reduce:animate-none" />
                <div className="space-y-3 p-3">
                  <div className="h-4 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                  <div className="h-5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
