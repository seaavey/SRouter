import type { UsageStatsReport } from "@/generated/api";

export type ModelUsageItem = UsageStatsReport["by_model"][number];

export type UsageByModelTableProps = {
    models: UsageStatsReport["by_model"];
};
