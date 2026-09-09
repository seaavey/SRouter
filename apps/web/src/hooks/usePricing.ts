import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PricingListResponse } from "@srouter/types";

export function usePricing(options: { forceRefresh?: boolean } = {}) {
    return useQuery({
        queryKey: ["pricing", "models", { forceRefresh: !!options.forceRefresh }],
        queryFn: () => {
            const url = options.forceRefresh ? "/v1/pricing/models?refresh=true" : "/v1/pricing/models";
            return api.get<PricingListResponse>(url);
        },
        staleTime: 1000 * 60 * 60, // 1 hour client cache
        gcTime: 1000 * 60 * 60 * 24, // 24 hours garbage collection
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false
    });
}
