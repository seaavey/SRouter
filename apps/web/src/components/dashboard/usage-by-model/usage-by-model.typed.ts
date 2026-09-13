import type { UsageStats } from "@srouter/types";

export type ModelUsageItem = UsageStats["byModel"][number];

export type UsageByModelTableProps = {
    models: UsageStats["byModel"];
};
