import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { providersListQuery } from "@/api/providers"
import type {
  AnalyticsReport,
  UsageByModel,
  UsageStatsReport,
} from "@/api/types"
import type { ModelMetric, ModelRow } from "../types"

export default function useModelBreakdown({
  analyticsData,
  usageData,
}: {
  analyticsData?: AnalyticsReport
  usageData?: UsageStatsReport
}) {
  const [metric, setMetric] = useState<ModelMetric>("cost")
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
  // The analytics payload carries the routing id only; a custom provider's id is
  // a UUID, so the badge needs this lookup to name the driver.
  const providers = useQuery(providersListQuery)
  const providerNames = useMemo(
    () =>
      new Map(
        (providers.data?.data ?? []).map((provider) => [
          provider.id,
          provider.name,
        ])
      ),
    [providers.data]
  )

  const modelRows = useMemo<ModelRow[]>(() => {
    const models = analyticsData?.top_models ?? []
    const valueOf = (model: (typeof models)[number]) =>
      metric === "cost"
        ? (model.est_cost ?? 0)
        : metric === "tokens"
          ? model.total_tokens
          : model.total_requests
    const total = models.reduce((sum, model) => sum + valueOf(model), 0)

    return models
      .map((model, index) => ({
        id: `${index}-${model.provider_id}-${model.model ?? "unknown"}`,
        model: model.model ?? "Unknown model",
        provider: model.provider_id,
        providerName: providerNames.get(model.provider_id) ?? model.provider_id,
        requests: model.total_requests,
        tokens: model.total_tokens,
        promptTokens: model.prompt_tokens,
        cachedTokens: model.cached_tokens,
        cost: model.est_cost,
        value: valueOf(model),
        share: total > 0 ? (valueOf(model) / total) * 100 : 0,
      }))
      .sort((left, right) => right.value - left.value)
  }, [analyticsData, metric, providerNames])

  const lifetimeModels = useMemo(() => {
    const byModel = new Map<string, UsageByModel>()
    for (const row of usageData?.data.by_model ?? []) {
      byModel.set(row.model, row)
    }
    return byModel
  }, [usageData])

  function toggleExpanded(modelID: string) {
    setExpandedModel((prev) => (prev === modelID ? null : modelID))
  }

  return {
    metric,
    setMetric,
    expandedModel,
    toggleExpanded,
    modelRows,
    lifetimeModels,
  }
}
