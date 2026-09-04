import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { QuotaResponse } from "@srouter/types";

export function useQuota(forceRefresh = false) {
    return useQuery({
        queryKey: ["quota", { forceRefresh }],
        queryFn: () =>
            api.get<QuotaResponse>(forceRefresh ? "/v1/quota?force=true" : "/v1/quota"),
        staleTime: 60_000,
        gcTime: 300_000,
        refetchInterval: 60_000
    });
}

