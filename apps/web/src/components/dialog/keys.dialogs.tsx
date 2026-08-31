import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, KeyRound, Search, X } from "lucide-react";
import type { CreateAPIKeyZod, APIKeyZod, ModelListResponse, UpdateAPIKeyZod } from "@srouter/types";
import { api } from "@/lib/api";
import { cn, formatCompactNumber } from "@/lib/utils";
import { useCopy } from "@/hooks/useCopy";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type ModelScope = "all" | "restricted";

export interface KeyFormData {
    name: string;
    enabled: boolean;
    rate_limit: string;
    quota_limit: string;
    credit_limit: string;
    model_scope: ModelScope;
    selected_models: string[];
}

const default_data: KeyFormData = {
    name: "",
    enabled: true,
    rate_limit: "",
    quota_limit: "",
    credit_limit: "",
    model_scope: "all",
    selected_models: []
};

const quick_amounts = [5, 10, 25, 50];

export interface ModelSelectorProps {
    scope: ModelScope;
    onScopeChange: (scope: ModelScope) => void;
    selected_models: string[];
    onToggleModel: (model_id: string) => void;
    isOpen: boolean;
}

type KeyLimitFieldKey = "rate_limit" | "quota_limit" | "credit_limit";

export interface KeyLimitsFieldsProps {
    form: KeyFormData;
    onChange: <K extends KeyLimitFieldKey>(field: K, val: KeyFormData[K]) => void;
    id_prefix?: string;
}

export type CreateKeyDialogProps = {
    open: boolean;
    creating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: CreateAPIKeyZod) => Promise<void>;
};

export type EditKeyDialogProps = {
    apiKey: APIKeyZod | null;
    open: boolean;
    updating: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (id: string, data: UpdateAPIKeyZod) => Promise<unknown>;
};

export type AddCreditDialogProps = {
    apiKey: APIKeyZod | null;
    open: boolean;
    loading: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (keyId: string, amount: number) => Promise<void>;
};

export type KeyDeleteDialogProps = {
    keyToDelete: APIKeyZod | null;
    deleting: boolean;
    onClose: () => void;
    onConfirm: (keyId: string) => Promise<void>;
};

export type KeySecretModalProps = {
    newKey: APIKeyZod | null;
    onClose: () => void;
};

function maskKey(key: string): string {
    if (key.length <= 14) return key;
    return `${key.slice(0, 10)}••••••••${key.slice(-4)}`;
}

function parseKeyPayload(form: KeyFormData): CreateAPIKeyZod & { enabled: boolean } {
    const rate_num = form.rate_limit.trim() ? parseInt(form.rate_limit, 10) : undefined;
    const quota_num = form.quota_limit.trim() ? parseInt(form.quota_limit, 10) : undefined;
    const credit_num = form.credit_limit.trim() ? parseFloat(form.credit_limit) : undefined;
    const allowed_models =
        form.model_scope === "restricted" && form.selected_models.length > 0
            ? form.selected_models
            : null;

    const rate_limit = Number.isFinite(rate_num) && (rate_num ?? 0) >= 0 ? rate_num : undefined;
    const quota_limit = Number.isFinite(quota_num) && (quota_num ?? 0) >= 0 ? quota_num : undefined;
    const credit_limit =
        Number.isFinite(credit_num) && (credit_num ?? 0) >= 0 ? credit_num : undefined;

    return {
        name: form.name.trim(),
        enabled: form.enabled,
        rate_limit,
        quota_limit,
        credit_limit,
        allowed_models
    };
}

function getKeyFormData(data?: APIKeyZod | null): KeyFormData {
    if (!data) return default_data;
    return {
        name: data.name || "",
        enabled: Boolean(data.enabled),
        rate_limit: data.rate_limit ? String(data.rate_limit) : "",
        quota_limit: data.quota_limit ? String(data.quota_limit) : "",
        credit_limit: data.credit_limit ? String(data.credit_limit) : "",
        model_scope: data.allowed_models && data.allowed_models.length > 0 ? "restricted" : "all",
        selected_models: data.allowed_models ?? []
    };
}

function useKeyForm(data?: APIKeyZod | null, is_open?: boolean) {
    const [form, setForm] = useState<KeyFormData>(() => getKeyFormData(data));

    useEffect(() => {
        if (data && is_open) {
            setForm(getKeyFormData(data));
        } else if (!is_open && !data) {
            setForm(default_data);
        }
    }, [data, is_open]);

    const updateField = <K extends keyof KeyFormData>(field: K, val: KeyFormData[K]) => {
        setForm((prev) => ({ ...prev, [field]: val }));
    };

    const toggleModel = (model_id: string) => {
        setForm((prev) => ({
            ...prev,
            selected_models: prev.selected_models.includes(model_id)
                ? prev.selected_models.filter((id) => id !== model_id)
                : [...prev.selected_models, model_id]
        }));
    };

    const resetForm = () => setForm(default_data);

    return { form, updateField, toggleModel, resetForm, getPayload: () => parseKeyPayload(form) };
}

function KeyLimitsFields({ form, onChange, id_prefix = "" }: KeyLimitsFieldsProps) {
    interface FieldConfig {
        key: KeyLimitFieldKey;
        label: string;
        suffix: string;
        id: string;
        helper: string;
        placeholder: string;
        min: string;
        step?: string;
        type: "number" | "text";
    }
    const fields: FieldConfig[] = [
        {
            key: "rate_limit",
            label: "Rate limit",
            suffix: "(req/m)",
            id: "rate-limit",
            helper: "Max req/min",
            placeholder: "Unlimited",
            min: "0",
            type: "number"
        },
        {
            key: "quota_limit",
            label: "Token quota",
            suffix: "(tokens)",
            id: "quota-limit",
            helper: "Max tokens",
            placeholder: "Unlimited",
            min: "0",
            type: "number"
        },
        {
            key: "credit_limit",
            label: "Credit limit",
            suffix: "($ USD)",
            id: "credit-limit",
            helper: "Prepaid budget",
            placeholder: "Unlimited",
            min: "0",
            step: "0.01",
            type: "number"
        }
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {fields.map(({ key, label, suffix, id, helper, placeholder, min, step, type }) => (
                <div key={id} className="space-y-1.5">
                    <Label
                        htmlFor={`${id_prefix}${id}`}
                        className="block text-xs font-medium text-foreground"
                    >
                        {label}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">
                            {suffix}
                        </span>
                    </Label>
                    <Input
                        id={`${id_prefix}${id}`}
                        type={type}
                        min={min}
                        step={step}
                        value={form[key]}
                        onChange={(e) => onChange(key, e.target.value)}
                        placeholder={placeholder}
                        className="h-9 font-mono text-xs rounded-md bg-background border-input"
                    />
                    <p className="text-[10px] text-muted-foreground">{helper}</p>
                </div>
            ))}
        </div>
    );
}

function ModelSelector({
    scope,
    onScopeChange,
    selected_models,
    onToggleModel,
    isOpen
}: ModelSelectorProps) {
    const [model_search, setModelSearch] = useState("");

    const { data: model_data, isPending } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
        enabled: isOpen && scope === "restricted"
    });

    const models = useMemo(() => model_data?.data ?? [], [model_data]);
    const filteredModels = useMemo(() => {
        const query = model_search.trim().toLowerCase();
        return query ? models.filter((m) => m.id.toLowerCase().includes(query)) : models;
    }, [models, model_search]);

    const scopeOptions = [
        {
            value: "all" as const,
            title: "All models",
            desc: "Unrestricted access"
        },
        {
            value: "restricted" as const,
            title: "Specific models",
            desc: "Restrict to a subset"
        }
    ];

    const scopeButtonClass = (active: boolean) =>
        cn(
            "rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer",
            active
                ? "border-primary bg-primary/10 text-foreground font-semibold"
                : "border-input bg-background text-muted-foreground hover:text-foreground"
        );

    return (
        <div className="space-y-2 pt-1">
            <Label className="block text-xs font-medium text-foreground">Allowed models</Label>
            <div className="grid grid-cols-2 gap-2">
                {scopeOptions.map(({ value, title, desc }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onScopeChange(value)}
                        className={scopeButtonClass(scope === value)}
                    >
                        {title}
                        <span className="block text-[10px] font-normal opacity-70">{desc}</span>
                    </button>
                ))}
            </div>

            {scope === "restricted" ? (
                <div className="space-y-2 rounded-md border border-border/70 bg-background/50 p-2.5">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                        <Input
                            type="text"
                            value={model_search}
                            onChange={(e) => setModelSearch(e.target.value)}
                            placeholder="Search models…"
                            className="h-8 pl-8 pr-7 font-mono text-xs rounded-md bg-background"
                        />
                        {model_search ? (
                            <button
                                type="button"
                                onClick={() => setModelSearch("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                aria-label="Clear search"
                            >
                                <X className="size-3" />
                            </button>
                        ) : null}
                    </div>

                    <div className="max-h-40 overflow-y-auto rounded-md">
                        {isPending ? (
                            <p className="py-3 text-center text-[11px] text-muted-foreground">
                                Loading models…
                            </p>
                        ) : filteredModels.length === 0 ? (
                            <p className="py-3 text-center text-[11px] text-muted-foreground">
                                No models matched your search.
                            </p>
                        ) : (
                            <ul className="space-y-0.5">
                                {filteredModels.map((model) => {
                                    const isSelected = selected_models.includes(model.id);
                                    return (
                                        <li key={model.id}>
                                            <button
                                                type="button"
                                                onClick={() => onToggleModel(model.id)}
                                                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors cursor-pointer ${
                                                    isSelected
                                                        ? "bg-primary/10 text-foreground font-medium"
                                                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                                }`}
                                            >
                                                <span className="truncate">{model.id}</span>
                                                {isSelected ? (
                                                    <Check className="size-3.5 shrink-0 text-primary" />
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <p className="text-[11px] text-muted-foreground font-sans">
                        {selected_models.length > 0
                            ? `${selected_models.length} model${selected_models.length === 1 ? "" : "s"} selected`
                            : "Select at least one model, or the key stays unrestricted."}
                    </p>
                </div>
            ) : null}
        </div>
    );
}

function KeyTelemetryCard({ apiKey }: { apiKey: APIKeyZod }) {
    const { copied, copy } = useCopy();
    const remaining_credit =
        (apiKey.credit_limit ?? 0) > 0
            ? Math.max(0, (apiKey.credit_limit ?? 0) - (apiKey.usage_cost ?? 0))
            : null;

    return (
        <div className="rounded-xl border border-border/70 bg-secondary/15 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Bearer Token</span>
                <code
                    onClick={() => void copy(apiKey.key, "API key copied to clipboard")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-secondary hover:border-border cursor-pointer transition-colors"
                    title="Click to copy full key"
                >
                    {apiKey.key}
                    {copied === apiKey.key ? (
                        <Check className="size-3 text-emerald-500" />
                    ) : (
                        <Copy className="size-3 opacity-60" />
                    )}
                </code>
            </div>

            <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/60 bg-background/60 py-2 px-1 text-center font-mono">
                <div className="px-2">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                        Usage
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        {formatCompactNumber(apiKey.usage_tokens ?? 0)}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">tok</span>
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                        Spent
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        ${(apiKey.usage_cost ?? 0).toFixed(2)}
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                        Balance
                    </span>
                    <span className="text-xs font-semibold text-emerald-500 tabular-nums">
                        {remaining_credit !== null
                            ? `$${remaining_credit.toFixed(2)}`
                            : "Unlimited"}
                    </span>
                </div>
            </div>
        </div>
    );
}

export interface KeyFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    apiKey?: APIKeyZod | null;
    submitLabel: string;
    submittingLabel: string;
    isSubmitting: boolean;
    onSubmit: (payload: ReturnType<typeof parseKeyPayload>) => Promise<void | unknown>;
}

export function KeyFormDialog({
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
    const { form, updateField, toggleModel, resetForm, getPayload } = useKeyForm(apiKey, open);
    const IDPrefix = apiKey ? "edit-" : "create-";

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const payload = getPayload();
        if (!payload.name) return;

        await onSubmit(payload);
        if (!apiKey) {
            resetForm();
        } else {
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-md bg-secondary text-foreground">
                            <KeyRound className="size-3.5" />
                        </div>
                        <DialogTitle className="text-base font-semibold text-foreground">
                            {title}
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                {apiKey ? <KeyTelemetryCard apiKey={apiKey} /> : null}

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                    <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-1.5">
                            <Label
                                htmlFor={`${IDPrefix}key-name`}
                                className="block text-xs font-medium text-foreground"
                            >
                                Key Name <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id={`${IDPrefix}key-name`}
                                type="text"
                                required
                                autoFocus={!apiKey}
                                value={form.name}
                                onChange={(e) => updateField("name", e.target.value)}
                                placeholder="e.g. production-backend"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor={`${IDPrefix}key-status`}
                                className="block text-xs font-medium text-foreground"
                            >
                                Status
                            </Label>
                            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2.5">
                                <Switch
                                    id={`${IDPrefix}key-status`}
                                    checked={form.enabled}
                                    onCheckedChange={(checked) => updateField("enabled", checked)}
                                />
                                <span
                                    className={cn(
                                        "text-xs font-medium select-none min-w-14",
                                        form.enabled
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-muted-foreground"
                                    )}
                                >
                                    {form.enabled ? "Active" : "Disabled"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <KeyLimitsFields form={form} onChange={updateField} id_prefix={IDPrefix} />

                    <ModelSelector
                        scope={form.model_scope}
                        onScopeChange={(scope) => updateField("model_scope", scope)}
                        selected_models={form.selected_models}
                        onToggleModel={toggleModel}
                        isOpen={open}
                    />

                    <DialogFooter className="pt-2 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-8.5 text-xs font-medium cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting || !form.name.trim()}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {isSubmitting ? submittingLabel : submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

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

    const activeKey = apiKey ?? cachedKey;

    return (
        <KeyFormDialog
            open={open && Boolean(activeKey)}
            onOpenChange={onOpenChange}
            title="API Key Details & Settings"
            description="View telemetry and configure rate limits, quotas, and model scopes."
            apiKey={activeKey}
            submitLabel="Save Changes"
            submittingLabel="Saving…"
            isSubmitting={updating}
            onSubmit={(payload) =>
                activeKey ? onSubmit(activeKey.id, payload) : Promise.resolve()
            }
        />
    );
}

export function AddCreditDialog({
    apiKey,
    open,
    loading,
    onOpenChange,
    onSubmit
}: AddCreditDialogProps) {
    const [amount, setAmount] = useState("");
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(apiKey);

    useEffect(() => {
        if (apiKey) {
            setCachedKey(apiKey);
        }
    }, [apiKey]);

    const activeKey = apiKey ?? cachedKey;

    const current_limit = activeKey?.credit_limit ?? 0;
    const current_cost = activeKey?.usage_cost ?? 0;
    const remaining_balance = current_limit > 0 ? Math.max(0, current_limit - current_cost) : null;

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const num = parseFloat(amount);
        if (!Number.isFinite(num) || num <= 0 || !activeKey) return;

        await onSubmit(activeKey.id, num);
        setAmount("");
        onOpenChange(false);
    };

    return (
        <Dialog open={open && Boolean(activeKey)} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Add Credit
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Add prepaid dollar balance to{" "}
                        <span className="font-semibold text-foreground font-mono">
                            {activeKey?.name}
                        </span>
                        .
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-lg border border-border/70 bg-secondary/30 p-3 my-2 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Current Balance:</span>
                        <span className="font-mono font-semibold text-foreground">
                            {remaining_balance !== null
                                ? `$${remaining_balance.toFixed(2)} USD`
                                : "Unlimited"}
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                        <span>Lifetime Spent:</span>
                        <span className="font-mono">${current_cost.toFixed(3)} USD</span>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                    <div className="space-y-2">
                        <Label
                            htmlFor="add-amount"
                            className="block text-xs font-medium text-foreground"
                        >
                            Amount to add ($ USD) <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="add-amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                            autoFocus
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="e.g. 10.00"
                            className="h-9 font-mono text-xs rounded-md bg-background border-input"
                        />

                        <div className="flex items-center gap-1.5 pt-1">
                            {quick_amounts.map((val) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setAmount(String(val))}
                                    className="rounded-md border border-border/70 bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
                                >
                                    +${val}
                                </button>
                            ))}
                        </div>
                    </div>

                    <DialogFooter className="pt-3 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-8.5 text-xs font-medium cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading || !amount || parseFloat(amount) <= 0}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {loading ? "Adding…" : "Add Credit"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function KeyDeleteDialog({
    keyToDelete,
    deleting,
    onClose,
    onConfirm
}: KeyDeleteDialogProps) {
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(keyToDelete);

    useEffect(() => {
        if (keyToDelete) {
            setCachedKey(keyToDelete);
        }
    }, [keyToDelete]);

    const activeKey = keyToDelete ?? cachedKey;

    return (
        <Dialog open={Boolean(keyToDelete)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-destructive">
                        Revoke API Key
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Are you sure you want to revoke{" "}
                        <span className="font-semibold text-foreground">{activeKey?.name}</span>?
                        Any downstream requests using this token will immediately fail with HTTP 401
                        Unauthorized.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs font-mono space-y-1 my-1">
                    <div className="text-muted-foreground text-[11px]">Token identifier</div>
                    <code className="text-foreground text-xs">
                        {activeKey ? maskKey(activeKey.key) : ""}
                    </code>
                </div>

                <DialogFooter className="pt-2 gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        className="h-8.5 text-xs font-medium cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting || !activeKey}
                        onClick={() => activeKey && void onConfirm(activeKey.id)}
                        className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        {deleting ? "Revoking…" : "Revoke Key"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function KeySecretModal({ newKey, onClose }: KeySecretModalProps) {
    const { copied, copy } = useCopy();
    const [cachedKey, setCachedKey] = useState<APIKeyZod | null>(newKey);

    useEffect(() => {
        if (newKey) {
            setCachedKey(newKey);
        }
    }, [newKey]);

    const activeKey = newKey ?? cachedKey;

    return (
        <Dialog open={Boolean(newKey)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Save Your API Key
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Copy this secret token now. For security reasons, it will not be shown
                        again.
                    </DialogDescription>
                </DialogHeader>

                {activeKey ? (
                    <div className="space-y-3.5 py-2">
                        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 flex items-start gap-2.5">
                            <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                                Store this key securely in your environment variables. If you lose
                                it, you will need to generate a new key.
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs font-medium text-foreground">
                                <span>{activeKey.name}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                    {activeKey.id}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={activeKey.key}
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground select-all focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <Button
                                    type="button"
                                    onClick={() =>
                                        void copy(activeKey.key, "API key copied to clipboard")
                                    }
                                    className="h-9 px-3.5 text-xs font-semibold shrink-0 cursor-pointer shadow-xs gap-1.5"
                                >
                                    {copied === activeKey.key ? (
                                        <>
                                            <Check className="size-3.5 text-emerald-400" />
                                            <span>Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="size-3.5" />
                                            <span>Copy</span>
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>

                        {(activeKey.credit_limit > 0 ||
                            activeKey.quota_limit > 0 ||
                            activeKey.rate_limit > 0) && (
                            <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground pt-1">
                                {activeKey.credit_limit > 0 && (
                                    <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                        Credit: ${activeKey.credit_limit.toFixed(2)} USD
                                    </span>
                                )}
                                {activeKey.quota_limit > 0 && (
                                    <span className="rounded-md border border-border/60 bg-secondary/40 px-2 py-0.5">
                                        Quota: {activeKey.quota_limit.toLocaleString()} tokens
                                    </span>
                                )}
                                {activeKey.rate_limit > 0 && (
                                    <span className="rounded-md border border-border/60 bg-secondary/40 px-2 py-0.5">
                                        Rate: {activeKey.rate_limit.toLocaleString()} req/m
                                    </span>
                                )}
                            </div>
                        )}

                        {activeKey.allowed_models && activeKey.allowed_models.length > 0 ? (
                            <div className="space-y-1.5">
                                <span className="block text-xs font-medium text-foreground">
                                    Allowed models
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {activeKey.allowed_models.map((model) => (
                                        <span
                                            key={model}
                                            className="inline-flex items-center rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-foreground"
                                        >
                                            {model}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-[11px] text-muted-foreground">
                                This key can access all models.
                            </p>
                        )}
                    </div>
                ) : null}

                <DialogFooter className="pt-2">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
