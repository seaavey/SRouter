import { KeyRound } from "lucide-react"

import type { APIKeyResponse } from "@/api/types"
import { Badge } from "@/components/arc/badge/badge"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { MONEY, NUMBER } from "@/components/usage/types"

interface PortalKeysProps {
  keys: APIKeyResponse[]
}

function modelsLabel(models: string[] | null) {
  if (models === null) {
    return "All models"
  }
  return models.length === 0 ? "None" : NUMBER.format(models.length)
}

export default function PortalKeys({ keys }: PortalKeysProps) {
  return (
    <section
      aria-labelledby="portal-keys-heading"
      className="min-w-0 rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-[var(--shadow-resting)] sm:p-5"
    >
      <div className="border-b border-border pb-3">
        <h2
          id="portal-keys-heading"
          className="text-sm font-medium tracking-tight text-foreground"
        >
          Keys
        </h2>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          Keys issued to this account. They are read-only on this screen.
        </p>
      </div>

      {keys.length === 0 ? (
        <div className="pt-4">
          <EmptyState
            icon={<KeyRound size={28} aria-hidden="true" />}
            title="No keys issued"
            description="Your gateway operator issues the API keys this account uses. Ask them to create one for you."
          />
        </div>
      ) : (
        <div className="overflow-x-auto pt-1">
          <table className="w-full min-w-[48rem] border-collapse text-left text-xs">
            <caption className="sr-only">
              API keys issued to your account
            </caption>
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Name
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Prefix
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Token quota
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Credit
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Allowed models
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr
                  key={key.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {key.name}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                    {key.key_prefix}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={key.enabled ? "success" : "neutral"} size="sm">
                      {key.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {key.quota_limit === 0
                      ? `${NUMBER.format(key.usage_tokens)} / Unlimited`
                      : `${NUMBER.format(key.usage_tokens)} / ${NUMBER.format(key.quota_limit)}`}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {`${MONEY.format(key.usage_cost ?? 0)} / ${
                      key.credit_limit === null || key.credit_limit === 0
                        ? "No cap"
                        : MONEY.format(key.credit_limit)
                    }`}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
                    {modelsLabel(key.allowed_models)}
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground tabular-nums">
                    {new Date(key.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
