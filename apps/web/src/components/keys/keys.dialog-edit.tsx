import { useEffect, useState } from "react";
import type { APIKeyZod, UpdateAPIKeyZod } from "@srouter/types";
import { KeyFormDialog } from "./keys.dialog-form";

export type EditKeyDialogProps = {
    apiKey: APIKeyZod | null;
    open: boolean;
    updating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (id: string, data: UpdateAPIKeyZod) => Promise<unknown>;
};

export function EditKeyDialog({
    apiKey,
    open,
    updating,
    onOpenChange,
    onSubmit
}: EditKeyDialogProps) {
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(apiKey);

    useEffect(() => {
        if (apiKey) {
            setCachedKey(apiKey);
        }
    }, [apiKey]);

    const active_key = apiKey ?? cachedKey;

    return (
        <KeyFormDialog
            open={open && Boolean(active_key)}
            onOpenChange={onOpenChange}
            title="API Key Details & Settings"
            description="View telemetry and configure rate limits, quotas, and model scopes."
            apiKey={active_key}
            submitLabel="Save Changes"
            submittingLabel="Saving…"
            isSubmitting={updating}
            onSubmit={(payload) =>
                active_key ? onSubmit(active_key.id, payload) : Promise.resolve()
            }
        />
    );
}
