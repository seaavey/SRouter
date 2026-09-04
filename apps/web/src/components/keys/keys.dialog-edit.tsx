import { useEffect, useState } from "react";
import type { APIKeyZod, UpdateAPIKeyZod } from "@srouter/types";
import { KeyFormDialog } from "./keys.dialog-form";

export type EditKeyDialogProps = {
    api_key: APIKeyZod | null;
    open: boolean;
    updating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (id: string, data: UpdateAPIKeyZod) => Promise<unknown>;
};

export function EditKeyDialog({
    api_key,
    open,
    updating,
    onOpenChange,
    onSubmit
}: EditKeyDialogProps) {
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(api_key);

    useEffect(() => {
        if (api_key) {
            setCachedKey(api_key);
        }
    }, [api_key]);

    const active_key = api_key ?? cachedKey;

    return (
        <KeyFormDialog
            open={open && Boolean(active_key)}
            onOpenChange={onOpenChange}
            title="API Key Details & Settings"
            description="View telemetry and configure rate limits, quotas, and model scopes."
            api_key={active_key}
            submitLabel="Save Changes"
            submittingLabel="Saving…"
            isSubmitting={updating}
            onSubmit={(payload) =>
                active_key ? onSubmit(active_key.id, payload) : Promise.resolve()
            }
        />
    );
}
