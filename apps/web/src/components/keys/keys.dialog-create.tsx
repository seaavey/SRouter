import type { CreateAPIKeyZod } from "@srouter/types";
import { KeyFormDialog } from "./keys.dialog-form";

export type CreateKeyDialogProps = {
    open: boolean;
    creating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: CreateAPIKeyZod) => Promise<void>;
};

export function CreateKeyDialog({ open, creating, onOpenChange, onSubmit }: CreateKeyDialogProps) {
    return (
        <KeyFormDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Create API Key"
            description="Generate a bearer token for SDKs, clients, and automated workloads."
            submitLabel="Create API Key"
            submittingLabel="Creating…"
            isSubmitting={creating}
            onSubmit={onSubmit}
        />
    );
}
