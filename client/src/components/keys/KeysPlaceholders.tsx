import { Skeleton } from "@/components/arc/skeleton/skeleton"

/**
 * The keys page's own frame in both tiers: a five-column band from the laptop
 * tier up, one card per key below it, two up from the tablet tier. Bars sit
 * where the real cells do, so the first response does not jump the page. Hidden
 * from assistive tech; the page announces its loading once.
 */
export function KeysPlaceholders({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <div className="hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--shadow-resting)] lg:block">
        <div className="flex h-11 items-center gap-6 border-b border-border px-3">
          <Skeleton className="max-w-[8rem]" lines={1} />
          <Skeleton className="max-w-[3.5rem]" lines={1} />
          <Skeleton className="max-w-[5rem]" lines={1} />
          <Skeleton className="max-w-[4rem]" lines={1} />
          <Skeleton className="ml-auto max-w-[5rem]" lines={1} />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex h-[52px] items-center gap-6 border-b border-border/60 px-3 last:border-b-0"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <Skeleton className="max-w-[7rem]" lines={1} />
            </div>
            <Skeleton className="max-w-[2.5rem]" lines={1} />
            <Skeleton className="max-w-[5rem]" lines={1} />
            <Skeleton className="max-w-[4rem]" lines={1} />
            <Skeleton className="ml-auto max-w-[5rem]" lines={1} />
          </div>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {Array.from({ length: rows }, (_, index) => (
          <li
            key={index}
            className="rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <Skeleton className="max-w-[8rem]" lines={1} />
              </div>
              {/* A track (switch) at its real size, as it sits in the card's corner. */}
              <div className="h-6 w-[42px] shrink-0 rounded-full bg-surface-muted" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <Skeleton className="max-w-[6rem]" lines={1} />
              <Skeleton className="max-w-[3rem]" lines={1} />
            </div>
            <div className="mt-2 h-[3px] w-full rounded-full bg-surface-muted" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <Skeleton className="max-w-[4.5rem]" lines={1} />
              <Skeleton className="max-w-[3.5rem]" lines={1} />
            </div>
            <div className="mt-3 flex justify-end">
              <div className="h-9 w-[176px] rounded-[var(--radius-pill)] bg-surface-muted" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
