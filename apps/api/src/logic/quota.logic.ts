import { getAllProvidersDB } from "@srouter/db";
import { fetchLiveOAuthQuota, isOAuthQuotaSupported } from "@srouter/providers";
import type { ProviderQuotaAccount, QuotaResponse } from "@srouter/types";

export class QuotaLogic {
    private static cachedQuota: QuotaResponse | null = null;
    private static cacheExpiresAt = 0;
    private static inFlightPromise: Promise<QuotaResponse> | null = null;
    private static readonly CACHE_TTL_MS = 60_000; // 60 seconds

    public static async getQuotaInfo(forceRefresh = false): Promise<QuotaResponse> {
        const now = Date.now();

        if (!forceRefresh && QuotaLogic.cachedQuota && now < QuotaLogic.cacheExpiresAt) {
            return QuotaLogic.cachedQuota;
        }

        if (QuotaLogic.inFlightPromise) {
            return QuotaLogic.inFlightPromise;
        }

        QuotaLogic.inFlightPromise = (async () => {
            try {
                const dbProviders = await QuotaLogic.getOAuthProviders();
                const providerAccounts: ProviderQuotaAccount[] = [];

                // Fetch quota concurrently across accounts with individual timeout protection
                await Promise.allSettled(
                    dbProviders.map(async (p) => {
                        try {
                            const account = await fetchLiveOAuthQuota({
                                id: p.id,
                                providerId: p.providerId,
                                name: p.name,
                                accessToken: p.accessToken,
                                enabled: p.enabled
                            });
                            if (account) {
                                providerAccounts.push(account);
                            }
                        } catch {
                            // Skip providers whose live quota fails or is temporarily unavailable
                        }
                    })
                );

                const response: QuotaResponse = {
                    object: "quota",
                    totalAccounts: providerAccounts.length,
                    providers: providerAccounts
                };

                QuotaLogic.cachedQuota = response;
                QuotaLogic.cacheExpiresAt = Date.now() + QuotaLogic.CACHE_TTL_MS;
                return response;
            } finally {
                QuotaLogic.inFlightPromise = null;
            }
        })();

        return QuotaLogic.inFlightPromise;
    }

    private static async getOAuthProviders() {
        const all = await getAllProvidersDB();
        // Wajib OAuth: category === 'oauth' atau provider yang mendukung quota OAuth
        return all.filter((p) => {
            if (p.category === "oauth") return true;
            if (isOAuthQuotaSupported(p.providerId) || isOAuthQuotaSupported(p.id)) return true;
            return false;
        });
    }
}
