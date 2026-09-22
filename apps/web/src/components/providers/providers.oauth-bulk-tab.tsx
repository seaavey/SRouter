import type { SubmitEvent } from "react";
import type { OAuthConnectState } from "@/hooks/useOAuthConnect";
import { splitTokenLines } from "@/utils/provider-oauth.utils";
import type { OAuthBulkTabConfig } from "./providers.oauth-flow";
import { INPUT_FIELD, OAuthFormActions } from "./providers.oauth-shared";

interface OAuthBulkTabProps {
    tab: OAuthBulkTabConfig;
    connect: OAuthConnectState;
    onCancel: () => void;
}

export default function OAuthBulkTab({ tab, connect, onCancel }: OAuthBulkTabProps) {
    const { bulkInput, setBulkInput, isBulkPending, submitBulk } = connect;
    const bulkLines = splitTokenLines(bulkInput).length;

    const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        submitBulk();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="font-semibold text-ink text-xs">{tab.fieldLabel}</label>
                    {bulkLines > 0 && (
                        <span className="rounded-full bg-field px-2 py-0.5 text-[10px] font-mono text-text-muted">
                            {bulkLines} detected
                        </span>
                    )}
                </div>
                <p className="text-xs text-text-muted leading-relaxed">{tab.description}</p>
                <textarea
                    rows={5}
                    placeholder={tab.placeholder}
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                    className={INPUT_FIELD}
                />
            </div>

            <OAuthFormActions
                submitLabel="Import Accounts"
                pendingLabel="Importing…"
                isPending={isBulkPending}
                onCancel={onCancel}
            />
        </form>
    );
}
