export interface DBAPIKey {
    id: string;
    key: string;
    name: string;
    enabled: boolean;
    rateLimit: number;
    quotaLimit: number;
    usageTokens: number;
    allowed_models?: string[] | null;
    createdAt: number;
}
