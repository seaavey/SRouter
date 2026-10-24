import { useRef } from "react"

import { Button } from "@/components/arc/button/button"
import { DateRangePicker } from "@/components/arc/date-range-picker/date-range-picker"
import type { DateRange } from "@/components/arc/date-range-picker/date-range-picker"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { Select } from "@/components/arc/select/select"
import { type LogStatusFilter, STATUS_FILTER_OPTIONS } from "./types"

export interface LogToolbarProps {
  statusFilter: LogStatusFilter
  onStatusChange: (value: LogStatusFilter) => void
  customRange: DateRange | null
  onCustomRangeChange: (range: DateRange | null) => void
  apiKeyID: string
  keyOptions: { value: string; label: string }[]
  onKeyChange: (value: string) => void
}

/** The toolbar's own labels sit beside the one the Arc select renders, so every
    control shares one label tier. */
function ToolbarLabel({ children }: { children: string }) {
  return <span className="text-sm font-medium text-foreground">{children}</span>
}

export function LogToolbar({
  statusFilter,
  onStatusChange,
  customRange,
  onCustomRangeChange,
  apiKeyID,
  keyOptions,
  onKeyChange,
}: LogToolbarProps) {
  // The panel positions and sizes itself inside this row. Left to the viewport,
  // the page padding and the shell's own overflow clip its right edge on a
  // phone, which cuts the last preset and the Sunday column.
  const row = useRef<HTMLDivElement>(null)

  return (
    // Phone: one column. Tablet: the range takes the first row, key and status
    // share the second. Laptop and desktop: three columns on one row.
    <div
      ref={row}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
        <ToolbarLabel>Time range</ToolbarLabel>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DateRangePicker
            label="Time range"
            // No range means every hour the database holds, so the trigger
            // names that state instead of leaving an empty field.
            placeholder="All time"
            value={customRange}
            onChange={onCustomRangeChange}
            maxDate={new Date()}
            weekStartsOn={1}
            boundary={() => row.current}
            fullWidth
            className="min-w-0 flex-1"
          />
          {customRange && (
            <Button
              variant="ghost"
              size="md"
              aria-label="Clear the date range"
              onClick={() => onCustomRangeChange(null)}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <Select
        label="API key"
        value={apiKeyID}
        onValueChange={onKeyChange}
        options={keyOptions}
        className="w-full"
      />

      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
        <ToolbarLabel>Status</ToolbarLabel>
        <SegmentedControl
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onValueChange={(value) => onStatusChange(value as LogStatusFilter)}
          label="Filter status"
        />
      </div>
    </div>
  )
}
