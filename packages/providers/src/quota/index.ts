import type { ProviderQuotaAccount } from "@srouter/types";
import { type IProviderQuotaFetcher, type ProviderQuotaContext } from "./base.js";
import { AntigravityQuotaFetcher } from "./antigravity.js";
import { CodeBuddyCNQuotaFetcher } from "./codebuddy.js";
import { OpenAICodexQuotaFetcher } from "./openai-codex.js";

export * from "./base.js";
export * from "./antigravity.js";
export * from "./codebuddy.js";
export * from "./openai-codex.js";

export async function fetchAntigravityLiveQuota(
    providerId: string,
    accountName: string,
    accessToken: string,
    enabled = true
): Promise<ProviderQuotaAccount> {
    const fetcher = new AntigravityQuotaFetcher();
    return await fetcher.fetchQuota({
        id: providerId,
        providerId: "antigravity",
        name: accountName,
        accessToken,
        enabled
    });
}

export async function fetchCodeBuddyCNLiveQuota(
    providerId: string,
    accountName: string,
    accessToken: string,
    enabled = true
): Promise<ProviderQuotaAccount> {
    const fetcher = new CodeBuddyCNQuotaFetcher();
    return await fetcher.fetchQuota({
        id: providerId,
        providerId: "codebuddy-cn",
        name: accountName,
        accessToken,
        enabled
    });
}

const QUOTA_FETCHERS: IProviderQuotaFetcher[] = [
    new AntigravityQuotaFetcher(),
    new CodeBuddyCNQuotaFetcher(),
    new OpenAICodexQuotaFetcher()
];

export function findQuotaFetcher(providerId: string): IProviderQuotaFetcher | undefined {
    return QUOTA_FETCHERS.find((f) => f.canHandle(providerId));
}

export function isOAuthQuotaSupported(providerId: string): boolean {
    return Boolean(findQuotaFetcher(providerId));
}

export async function fetchLiveOAuthQuota(
    ctx: ProviderQuotaContext
): Promise<ProviderQuotaAccount | null> {
    const fetcher = findQuotaFetcher(ctx.providerId) || findQuotaFetcher(ctx.id);
    if (!fetcher) {
        return null;
    }
    return await fetcher.fetchQuota(ctx);
}
