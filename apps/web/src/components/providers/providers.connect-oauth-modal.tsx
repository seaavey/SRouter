import { X } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { useOAuthConnect } from "@/hooks/useOAuthConnect";
import ProviderIcon from "./providers.icon";
import OAuthBrowserTab from "./providers.oauth-browser-tab";
import OAuthBulkTab from "./providers.oauth-bulk-tab";
import OAuthPatTab from "./providers.oauth-pat-tab";
import { OAuthErrorBanner, OAuthTabBar } from "./providers.oauth-shared";

interface ConnectOAuthModalProps {
    provider: ProviderDefinition | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export default function ConnectOAuthModal({
    provider,
    open,
    onOpenChange
}: ConnectOAuthModalProps) {
    const connect = useOAuthConnect({ provider, open, onOpenChange });

    if (!provider) return null;

    const { flow, activeTab } = connect;
    const closeModal = () => onOpenChange(false);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-6 md:p-8 bg-canvas border border-hairline-soft rounded-3xl space-y-5 shadow-none overflow-y-auto max-h-[calc(100dvh-2rem)] font-sans">
                <DialogHeader className="flex flex-row items-center justify-between pb-3.5 border-b border-hairline-soft">
                    <div className="flex items-center gap-3">
                        <ProviderIcon
                            providerId={provider.id}
                            providerUrl={
                                provider.category === "custom_provider"
                                    ? provider.default_base_url
                                    : undefined
                            }
                            className="size-7 rounded-[30%]"
                        />
                        <div>
                            <DialogTitle className="text-base font-bold tracking-tight text-ink font-sans">
                                Connect {provider.name}.
                            </DialogTitle>
                            <DialogDescription className="text-xs text-text-muted">
                                Authenticate and link your account
                            </DialogDescription>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={closeModal}
                        className="inline-flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <X className="size-4" aria-hidden="true" />
                    </button>
                </DialogHeader>

                {connect.hasTabs && (
                    <OAuthTabBar
                        flow={flow}
                        activeTab={activeTab}
                        tabsCount={connect.tabsCount}
                        onChange={connect.setActiveTab}
                    />
                )}

                {connect.error && <OAuthErrorBanner message={connect.error} />}

                {activeTab === "bulk" && flow.bulkTab ? (
                    <OAuthBulkTab tab={flow.bulkTab} connect={connect} onCancel={closeModal} />
                ) : activeTab === "oauth" || !flow.patTab ? (
                    <OAuthBrowserTab
                        providerName={provider.name}
                        isPolling={connect.isPolling}
                        waitingLabel={flow.waitingLabel}
                        connect={connect}
                        onCancel={closeModal}
                    />
                ) : (
                    <OAuthPatTab tab={flow.patTab} connect={connect} onCancel={closeModal} />
                )}
            </DialogContent>
        </Dialog>
    );
}
