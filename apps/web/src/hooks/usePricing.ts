import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PricingListResponse } from "@srouter/types";

export function usePricing() {
    return useQuery({
        queryKey: ["pricing", "models"],
        queryFn: () => api.get<PricingListResponse>("/v1/pricing/models"),
        staleTime: 1000 * 60 * 60, // 1 hour client cache
        gcTime: 1000 * 60 * 60 * 24, // 24 hours garbage collection
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false
    });
}
