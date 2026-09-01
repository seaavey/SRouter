import { useQuery } from "@tanstack/react-query";
import { Api } from "@/lib/api";
import type { AnalyticsWindow } from "@srouter/types";

export function useAnalytics(window: AnalyticsWindow) {
    return useQuery({
        queryKey: ["analytics", window],
        queryFn: () => Api.getAnalytics(window),
        refetchInterval: window === "1h" ? 10_000 : 60_000
    });
}