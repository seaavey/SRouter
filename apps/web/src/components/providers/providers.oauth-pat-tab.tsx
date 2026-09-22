import type { SubmitEvent } from "react";
import type { OAuthConnectState } from "@/hooks/useOAuthConnect";
import type { OAuthPatTabConfig } from "./providers.oauth-flow";
import { INPUT_FIELD, OAuthFormActions } from "./providers.oauth-shared";

interface OAuthPatTabProps {
    tab: OAuthPatTabConfig;
    connect: OAuthConnectState;
    onCancel: () => void;
}

export default function OAuthPatTab({ tab, connect, onCancel }: OAuthPatTabProps) {
    const { patInput, setPatInput, isPatPending, submitPat } = connect;

    const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        submitPat();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="space-y-1.5">
                <label className="font-semibold text-foreground block text-xs">
                    {tab.fieldLabel}
                </label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {tab.description}
                </p>
                <input
                    type="password"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={tab.placeholder}
                    value={patInput}
                    onChange={(e) => setPatInput(e.target.value)}
                    className={INPUT_FIELD}
                />
            </div>

            <OAuthFormActions
                submitLabel={tab.submitLabel}
                isPending={isPatPending}
                onCancel={onCancel}
            />
        </form>
    );
}
