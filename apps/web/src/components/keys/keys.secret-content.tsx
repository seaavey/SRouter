import { AlertCircle, Check, Copy } from "lucide-react";
import type { APIKeyZod } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/hooks/useCopy";

interface KeySecretContentProps {
    apiKey: APIKeyZod;
}

export default function KeySecretContent({ apiKey }: KeySecretContentProps) {
    const { copied, copy } = useCopy();

    return (
        <div className="flex max-h-[calc(100dvh-12rem)] flex-col gap-4 overflow-y-auto p-6">
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <AlertCircle
                    className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                />
                <div className="text-xs leading-relaxed text-amber-600 font-sans dark:text-amber-400">
                    Store this key securely in your environment variables. If you lose it, you will
                    need to generate a new key.
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-medium text-ink">
                    <span className="font-semibold font-sans">{apiKey.name}</span>
                    <span className="font-mono text-[10px] text-text-muted">{apiKey.id}</span>
                </div>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <Input
                        type="text"
                        readOnly
                        value={apiKey.key}
                        aria-label="API key"
                        className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 font-mono text-xs text-ink shadow-none focus:outline-none"
                    />
                    <Button
                        type="button"
                        onClick={() => void copy(apiKey.key, "API key copied to clipboard")}
                        className="h-9 w-full shrink-0 cursor-pointer gap-1.5 rounded-full px-4 text-xs font-semibold shadow-none sm:w-auto"
                    >
                        {copied ? (
                            <>
                                <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
                                <span>Copied</span>
                            </>
                        ) : (
                            <>
                                <Copy className="size-3.5" aria-hidden="true" />
                                <span>Copy</span>
                            </>
                        )}
                    </Button>
                </div>
            </div>

            <KeyLimitsSummary apiKey={apiKey} />
            <AllowedModelsSummary models={apiKey.allowed_models} />
        </div>
    );
}

function KeyLimitsSummary({ apiKey }: { apiKey: APIKeyZod }) {
    const hasLimits = apiKey.credit_limit > 0 || apiKey.quota_limit > 0 || apiKey.rate_limit > 0;
    if (!hasLimits) return null;

    return (
        <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs text-text-muted">
            {apiKey.credit_limit > 0 ? (
                <span className="rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1 font-semibold text-ink">
                    Credit: ${apiKey.credit_limit.toFixed(2)} USD
                </span>
            ) : null}
            {apiKey.quota_limit > 0 ? (
                <span className="rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1">
                    Quota: {apiKey.quota_limit.toLocaleString()} tokens
                </span>
            ) : null}
            {apiKey.rate_limit > 0 ? (
                <span className="rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1">
                    Rate: {apiKey.rate_limit.toLocaleString()} req/m
                </span>
            ) : null}
        </div>
    );
}

function AllowedModelsSummary({ models }: { models: string[] | null | undefined }) {
    return models && models.length > 0 ? (
        <div className="flex flex-col gap-2">
            <span className="block text-xs font-medium text-ink font-sans">Allowed models</span>
            <div className="flex flex-wrap gap-1.5">
                {models.map((model) => (
                    <span
                        key={model}
                        className="inline-flex items-center rounded-full border border-hairline-soft bg-canvas-soft px-2.5 py-0.5 font-mono text-xs text-ink"
                    >
                        {model}
                    </span>
                ))}
            </div>
        </div>
    ) : (
        <p className="text-xs text-text-muted font-sans">This key can access all models.</p>
    );
}
