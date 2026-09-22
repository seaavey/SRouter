import { AlertCircle, Globe, Key, Layers, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ConnectTab } from "@/hooks/useOAuthConnect";
import type { OAuthFlowConfig } from "./providers.oauth-flow";

export const BTN_SECONDARY =
    "rounded-full px-4 h-9 text-xs font-semibold cursor-pointer border-hairline bg-canvas hover:bg-canvas-soft text-ink shadow-none";
export const BTN_PRIMARY =
    "rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none";
export const INPUT_FIELD =
    "w-full rounded-2xl border-0 bg-field px-4 py-2.5 text-xs font-mono text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none";

interface OAuthErrorBannerProps {
    message: string;
}

export function OAuthErrorBanner({ message }: OAuthErrorBannerProps) {
    return (
        <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="font-mono">{message}</span>
        </div>
    );
}

interface OAuthFormActionsProps {
    submitLabel: string;
    pendingLabel?: string;
    isPending: boolean;
    onCancel: () => void;
}

export function OAuthFormActions({
    submitLabel,
    pendingLabel = "Connecting…",
    isPending,
    onCancel
}: OAuthFormActionsProps) {
    return (
        <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                className={BTN_SECONDARY}
            >
                Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending} className={BTN_PRIMARY}>
                {isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                {isPending ? pendingLabel : submitLabel}
            </Button>
        </div>
    );
}

interface OAuthTabBarProps {
    flow: OAuthFlowConfig;
    activeTab: ConnectTab;
    tabsCount: number;
    onChange: (tab: ConnectTab) => void;
}

function tabButtonClass(active: boolean): string {
    return cn(
        "flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full font-medium transition-all cursor-pointer",
        active
            ? "bg-ink text-canvas font-semibold shadow-none"
            : "text-text-muted hover:text-ink hover:bg-canvas/40"
    );
}

export function OAuthTabBar({ flow, activeTab, tabsCount, onChange }: OAuthTabBarProps) {
    return (
        <div
            className={cn(
                "grid w-full gap-1 rounded-full border border-hairline-soft bg-canvas-soft p-1 text-xs",
                tabsCount === 3 ? "grid-cols-3" : "grid-cols-2"
            )}
        >
            <button
                type="button"
                onClick={() => onChange("oauth")}
                className={tabButtonClass(activeTab === "oauth")}
            >
                <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Browser Login</span>
            </button>
            {flow.patTab && (
                <button
                    type="button"
                    onClick={() => onChange("pat")}
                    className={tabButtonClass(activeTab === "pat")}
                >
                    <Key className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{flow.patTab.tabLabel}</span>
                </button>
            )}
            {flow.bulkTab && (
                <button
                    type="button"
                    onClick={() => onChange("bulk")}
                    className={tabButtonClass(activeTab === "bulk")}
                >
                    <Layers className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">Bulk Add</span>
                </button>
            )}
        </div>
    );
}
