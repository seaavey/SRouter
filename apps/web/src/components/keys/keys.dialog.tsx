import { useEffect, useState, type SubmitEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, KeyRound, ShieldCheck } from "lucide-react";
import type { APIKeyZod, CreateAPIKeyZod, UpdateAPIKeyZod } from "@srouter/types";
import { cn } from "@/lib/utils";
import { useKeyForm } from "@/hooks/useKeyForm";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";

import KeyFormFields from "./keys.form-fields";
import KeyModelPicker from "./keys.model-picker";
import KeySecretContent from "./keys.secret-content";
import { maskKey, parseKeyPayload } from "./keys.form-types";
import KeyTelemetryCard from "./keys.telemetry-card";

interface KeyFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    apiKey?: APIKeyZod | null;
    submitLabel: string;
    submittingLabel: string;
    isSubmitting: boolean;
    onSubmit: (payload: ReturnType<typeof parseKeyPayload>) => Promise<boolean>;
}

type CreateKeyDialogProps = {
    open: boolean;
    creating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: CreateAPIKeyZod) => Promise<boolean>;
};

type EditKeyDialogProps = {
    apiKey: APIKeyZod | null;
    open: boolean;
    updating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (id: string, data: UpdateAPIKeyZod) => Promise<boolean>;
};

type KeyDeleteDialogProps = {
    apiKey: APIKeyZod | null;
    deleting: boolean;
    onClose: () => void;
    onConfirm: (keyId: string) => Promise<void>;
};

type KeySecretDialogProps = {
    newKey: APIKeyZod | null;
    onClose: () => void;
};

function KeyFormDialog(props: KeyFormDialogProps) {
    // Remount on open/target change so local form state is re-derived at mount.
    return <KeyFormDialogContent key={`${props.apiKey?.id ?? "new"}:${props.open}`} {...props} />;
}

function KeyFormDialogContent({
    open,
    onOpenChange,
    title,
    description,
    apiKey = null,
    submitLabel,
    submittingLabel,
    isSubmitting,
    onSubmit
}: KeyFormDialogProps) {
    const { form, updateField, toggleModel, resetForm, getPayload } = useKeyForm(apiKey);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const idPrefix = apiKey ? "edit-" : "create-";
    const formId = `${idPrefix}key-form`;

    useEffect(() => {
        if (!open || form.model_scope === "all") {
            setIsPickerOpen(false);
        }
    }, [form.model_scope, open]);

    const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payload = getPayload();
        if (!payload.name) return;

        const submitted = await onSubmit(payload);
        if (!submitted) return;

        if (!apiKey) {
            resetForm();
            setIsPickerOpen(false);
        } else {
            onOpenChange(false);
        }
    };

    const isSidePanelOpen = form.model_scope === "restricted" && isPickerOpen;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="pointer-events-auto flex w-auto max-w-none items-center justify-center overflow-visible border-none bg-transparent p-0 shadow-none">
                <motion.div
                    layout="position"
                    transition={{ type: "spring", stiffness: 350, damping: 32 }}
                    className={cn(
                        "flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] flex-col items-stretch justify-center gap-4 overflow-y-auto font-sans md:flex-row md:items-start md:overflow-visible",
                        isSidePanelOpen ? "max-w-3xl lg:max-w-4xl" : "max-w-lg"
                    )}
                >
                    <motion.div
                        layout="position"
                        transition={{ type: "spring", stiffness: 350, damping: 32 }}
                        className="flex max-h-[calc(100dvh-2.5rem)] w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-hairline-soft bg-canvas p-0 shadow-none md:w-[460px] lg:w-[480px]"
                    >
                        <div className="shrink-0 border-b border-hairline-soft bg-canvas px-6 py-5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink">
                                        <KeyRound className="size-4" aria-hidden="true" />
                                    </div>
                                    <div className="min-w-0">
                                        <DialogTitle className="truncate text-base font-[650] tracking-tight text-ink font-sans">
                                            {title}
                                        </DialogTitle>
                                        <DialogDescription className="mt-0.5 truncate text-xs text-text-muted font-sans">
                                            {description}
                                        </DialogDescription>
                                    </div>
                                </div>
                                {apiKey ? (
                                    <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-canvas-soft px-3 py-1 font-mono text-xs text-text-muted sm:inline-flex">
                                        <ShieldCheck
                                            className="size-3 text-emerald-600 dark:text-emerald-400"
                                            aria-hidden="true"
                                        />
                                        {apiKey.id.slice(0, 8)}…
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
                            {apiKey ? <KeyTelemetryCard apiKey={apiKey} /> : null}

                            <form id={formId} onSubmit={handleSubmit}>
                                <KeyFormFields
                                    form={form}
                                    idPrefix={idPrefix}
                                    onChange={updateField}
                                    onScopeChange={(scope) => {
                                        updateField("model_scope", scope);
                                        setIsPickerOpen(scope === "restricted");
                                    }}
                                    onOpenPicker={() => setIsPickerOpen(true)}
                                />
                            </form>
                        </div>
                        <div className="mt-0 flex shrink-0 flex-row items-center justify-end gap-2 border-t border-hairline-soft bg-canvas px-6 py-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                className="h-9 flex-1 cursor-pointer rounded-full px-5 text-xs font-medium shadow-none sm:flex-initial"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                form={formId}
                                disabled={isSubmitting || !form.name.trim()}
                                className="h-9 flex-1 cursor-pointer rounded-full px-5 text-xs font-semibold shadow-none sm:flex-initial"
                            >
                                {isSubmitting ? submittingLabel : submitLabel}
                            </Button>
                        </div>
                    </motion.div>
                    <AnimatePresence>
                        {isSidePanelOpen ? (
                            <motion.div
                                key="allowed-models-pool"
                                initial={{ opacity: 0, x: -16, scale: 0.98, width: 0 }}
                                animate={{ opacity: 1, x: 0, scale: 1, width: "auto" }}
                                exit={{ opacity: 0, x: -16, scale: 0.98, width: 0 }}
                                transition={{ type: "spring", stiffness: 350, damping: 32 }}
                            >
                                <KeyModelPicker
                                    selectedModels={form.selected_models}
                                    onToggleModel={toggleModel}
                                    onClear={() => updateField("selected_models", [])}
                                    onClose={() => setIsPickerOpen(false)}
                                />
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </motion.div>
            </DialogContent>
        </Dialog>
    );
}

export function CreateKeyDialog({ open, creating, onOpenChange, onSubmit }: CreateKeyDialogProps) {
    return (
        <KeyFormDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Create API Key."
            description="Generate a bearer token for SDKs, clients, and automated workloads."
            submitLabel="Generate Key"
            submittingLabel="Generating…"
            isSubmitting={creating}
            onSubmit={onSubmit}
        />
    );
}

export function EditKeyDialog({
    apiKey,
    open,
    updating,
    onOpenChange,
    onSubmit
}: EditKeyDialogProps) {
    const activeKey = useCachedKey(apiKey);

    return (
        <KeyFormDialog
            open={open && Boolean(activeKey)}
            onOpenChange={onOpenChange}
            title="API Key Details."
            description="View telemetry and configure rate limits, quotas, and model scopes."
            apiKey={activeKey}
            submitLabel="Save Changes"
            submittingLabel="Saving…"
            isSubmitting={updating}
            onSubmit={(payload) =>
                activeKey ? onSubmit(activeKey.id, payload) : Promise.resolve(false)
            }
        />
    );
}

export function KeyDeleteDialog({ apiKey, deleting, onClose, onConfirm }: KeyDeleteDialogProps) {
    const activeKey = useCachedKey(apiKey);

    return (
        <Dialog open={Boolean(apiKey)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex max-w-md flex-col overflow-hidden rounded-3xl border border-hairline-soft bg-canvas p-0 font-sans shadow-none sm:max-w-md">
                <DialogHeader className="shrink-0 border-b border-red-500/20 bg-red-500/5 px-6 py-5 text-left">
                    <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                            <AlertTriangle className="size-4" aria-hidden="true" />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-[650] tracking-tight text-red-600 font-sans dark:text-red-400">
                                Revoke API Key.
                            </DialogTitle>
                            <DialogDescription className="mt-0.5 text-xs leading-tight text-text-muted font-sans">
                                This action is permanent and immediate.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex flex-col gap-4 p-6">
                    <p className="text-xs leading-relaxed text-text-muted font-sans">
                        Are you sure you want to revoke{" "}
                        <span className="font-semibold text-ink font-sans">{activeKey?.name}</span>?
                        Any downstream requests using this token will immediately fail with HTTP 401
                        Unauthorized.
                    </p>

                    <div className="flex flex-col gap-1 rounded-2xl border border-hairline-soft bg-canvas-soft p-3.5 font-mono text-xs">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                            Token identifier
                        </div>
                        <code className="block truncate text-xs text-ink font-mono">
                            {activeKey ? maskKey(activeKey.key) : ""}
                        </code>
                    </div>
                </div>

                <DialogFooter className="mt-0 flex shrink-0 flex-row items-center justify-end gap-2 border-t border-hairline-soft bg-canvas px-6 py-4">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        className="h-9 cursor-pointer rounded-full px-5 text-xs font-medium shadow-none"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting || !activeKey}
                        onClick={() => activeKey && void onConfirm(activeKey.id)}
                        className="h-9 cursor-pointer rounded-full bg-red-600 px-5 text-xs font-semibold text-white shadow-none hover:bg-red-700"
                    >
                        {deleting ? "Revoking…" : "Revoke Key"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function KeySecretDialog({ newKey, onClose }: KeySecretDialogProps) {
    return (
        <Dialog open={Boolean(newKey)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex w-[calc(100vw-1.5rem)] max-w-md flex-col overflow-hidden rounded-3xl border border-hairline-soft bg-canvas p-0 font-sans shadow-none sm:max-w-md">
                <DialogHeader className="shrink-0 border-b border-hairline-soft bg-canvas px-6 py-5 text-left">
                    <DialogTitle className="text-base font-[650] tracking-tight text-ink font-sans">
                        Save Your API Key.
                    </DialogTitle>
                    <DialogDescription className="mt-0.5 text-xs text-text-muted font-sans">
                        Copy this secret token now. For security reasons, it will not be shown
                        again.
                    </DialogDescription>
                </DialogHeader>

                {newKey ? <KeySecretContent apiKey={newKey} /> : null}

                <DialogFooter className="mt-0 flex shrink-0 items-center justify-end border-t border-hairline-soft bg-canvas px-6 py-4">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="h-9 w-full cursor-pointer rounded-full px-5 text-xs font-semibold shadow-none sm:w-auto"
                    >
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function useCachedKey(apiKey: APIKeyZod | null) {
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(apiKey);

    useEffect(() => {
        if (apiKey) setCachedKey(apiKey);
    }, [apiKey]);

    return apiKey ?? cachedKey;
}
