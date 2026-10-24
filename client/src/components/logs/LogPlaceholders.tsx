import { Skeleton } from "@/components/arc/skeleton/skeleton"

/**
 * The log table's own frame: a header band, then one band per row. Bars sit
 * where the real columns do, so the table does not jump when the first page
 * arrives. Hidden from assistive tech: the page announces its loading state
 * once, and repeating it per row would only chatter.
 */
export function LogRowPlaceholders({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--shadow-resting)]"
      aria-hidden="true"
    >
      <div className="flex h-11 items-center gap-6 border-b border-border px-3">
        <Skeleton className="max-w-[4rem]" lines={1} />
        <Skeleton className="max-w-[4rem]" lines={1} />
        <Skeleton className="max-w-[12rem]" lines={1} />
        <Skeleton className="ml-auto max-w-[4rem]" lines={1} />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex h-[52px] items-center gap-6 border-b border-border/60 px-3 last:border-b-0"
        >
          <Skeleton className="max-w-[5.5rem]" lines={1} />
          <Skeleton className="max-w-[2.5rem]" lines={1} />
          <Skeleton className="max-w-[16rem]" lines={1} />
          <Skeleton className="max-w-[9rem]" lines={1} />
          <Skeleton className="ml-auto max-w-[4rem]" lines={1} />
        </div>
      ))}
    </div>
  )
}
