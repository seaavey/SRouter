import { Link } from "@tanstack/react-router"
import { AlertCircle, Cpu } from "lucide-react"

import type { RequestLog } from "@/api/types"
import { Badge } from "@/components/arc/badge/badge"
import { BottomSheet } from "@/components/arc/bottom-sheet/bottom-sheet"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { formatTime, isSuccessStatus, LATENCY, NUMBER, statusTone } from "./types"

export interface LogDetailSheetProps {
  log: RequestLog | null
  onClose: () => void
}

export function LogDetailSheet({ log, onClose }: LogDetailSheetProps) {
  const isSuccess = log ? isSuccessStatus(log.status_code) : true
  const tone = log ? statusTone(log.status_code) : "neutral"

  return (
    <BottomSheet
      open={Boolean(log)}
      onOpenChange={(open) => !open && onClose()}
      title={
        log ? `${log.status_code} ${log.method} ${log.path}` : "Log detail"
      }
      description={
        log
          ? `Recorded at ${formatTime(log.created_at)} · ${LATENCY(log.latency_ms)}`
          : undefined
      }
      detents={[0.55, 0.92]}
      initialDetent={0}
    >
      {log && (
        <div className="space-y-4 py-2 text-xs">
          {/* Status Badge overview */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone} size="md">
              {log.status_code} {log.method}
            </Badge>
            <span className="max-w-sm truncate font-mono text-xs font-medium text-foreground">
              {log.path}
            </span>
          </div>

          {/* Error Banner if failed */}
          {!isSuccess && (log.error_message || log.error_code) && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle
                  size={15}
                  className="shrink-0"
                  aria-hidden="true"
                />
                <span>{log.error_code ?? "Gateway Error"}</span>
              </div>
              {log.error_message && (
                <p className="mt-1.5 font-mono text-xs break-all whitespace-pre-wrap text-foreground/90">
                  {log.error_message}
                </p>
              )}
            </div>
          )}

          {/* General Meta Grid */}
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border/70 bg-surface-muted/25 p-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Request ID</dt>
              <dd className="mt-1 flex items-center gap-1 font-mono font-medium text-foreground">
                <span className="max-w-[12rem] truncate">{log.request_id}</span>
                <CopyButton value={log.request_id} />
              </dd>
            </div>

            <div>
              <dt className="text-muted-foreground">Internal Log ID</dt>
              <dd className="mt-1 flex items-center gap-1 font-mono font-medium text-foreground">
                <span className="max-w-[12rem] truncate">{log.id}</span>
                <CopyButton value={log.id} />
              </dd>
            </div>

            <div>
              <dt className="text-muted-foreground">Provider</dt>
              <dd className="mt-1">
                {log.provider && log.provider !== "default" ? (
                  <Link
                    to="/providers/$providerId"
                    params={{ providerId: log.provider }}
                    className="group/badge inline-flex rounded-[var(--radius-pill)] transition-transform duration-150 ease-out focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none active:scale-95"
                  >
                    <Badge
                      tone="neutral"
                      size="sm"
                      className="cursor-pointer transition-colors group-hover/badge:border-foreground/30 group-hover/badge:bg-surface-muted"
                    >
                      {log.provider}
                    </Badge>
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {log.provider ?? "—"}
                  </span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-muted-foreground">Model Route</dt>
              <dd className="mt-1 truncate font-mono font-medium text-foreground">
                {log.resolved_model ?? log.model ?? "—"}
              </dd>
            </div>

            <div>
              <dt className="text-muted-foreground">API Key ID</dt>
              <dd className="mt-1 truncate font-mono text-foreground">
                {log.api_key_id ? log.api_key_id : "—"}
              </dd>
            </div>

            {typeof log.upstream_status === "number" && (
              <div>
                <dt className="text-muted-foreground">Upstream Status</dt>
                <dd className="mt-1 font-mono font-medium text-foreground tabular-nums">
                  {log.upstream_status}
                </dd>
              </div>
            )}

            <div>
              <dt className="text-muted-foreground">Client IP</dt>
              <dd className="mt-1 font-mono text-foreground">
                {log.ip_address ?? "—"}
              </dd>
            </div>
          </dl>

          {/* Token Usage Breakdown */}
          <div className="rounded-lg border border-border/70 bg-surface-muted/25 p-3">
            <h4 className="mb-2.5 flex items-center gap-1.5 font-medium text-foreground">
              <Cpu size={14} className="text-foreground" aria-hidden="true" />
              Token Accounting
            </h4>

            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Input</dt>
                <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                  {NUMBER.format(log.tokens.input ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Output</dt>
                <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                  {NUMBER.format(log.tokens.output ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cache read</dt>
                <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                  {NUMBER.format(log.tokens.cache_read ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Total</dt>
                <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                  {NUMBER.format(log.tokens.total ?? 0)}
                </dd>
              </div>
            </dl>

            {log.costs?.total && (
              <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-xs">
                <span className="text-muted-foreground">Estimated Cost</span>
                <span className="font-medium text-foreground tabular-nums">
                  {log.costs.total.startsWith("$")
                    ? log.costs.total
                    : `$${log.costs.total}`}{" "}
                  USD
                </span>
              </div>
            )}
          </div>

          {/* Client Info */}
          {log.user_agent && (
            <div className="rounded-lg border border-border/70 bg-surface-muted/25 p-3 text-xs">
              <span className="mb-1 block text-muted-foreground">
                User Agent
              </span>
              <span className="font-mono break-all text-muted-foreground">
                {log.user_agent}
              </span>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
