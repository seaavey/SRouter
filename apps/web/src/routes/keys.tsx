import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useKeys } from "@/hooks/useKeys";
import type { CreateAPIKeyZod, APIKeyZod } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { KeysSkeleton } from "@/components/skeletons";

import {
    CreateKeyDialog,
    EditKeyDialog,
    KeyDeleteDialog,
    KeyMetrics,
    KeySecretModal,
    KeyTable
} from "@/components/keys";

export const Route = createFileRoute("/keys")({
    staticData: { title: "API Keys" },
    component: KeysPage
});

function KeysPage() {
    const {
        keys,
        loading,
        creating,
        updatingId,
        deletingId,
        newlyCreatedKey,
        setNewlyCreatedKey,
        createKey,
        updateKey,
        deleteKey
    } = useKeys();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [keyToDelete, setKeyToDelete] = useState<APIKeyZod | null>(null);
    const [keyToEdit, setKeyToEdit] = useState<APIKeyZod | null>(null);

    const totalUsageTokens = keys.reduce((acc, k) => acc + (k.usage_tokens || 0), 0);
    const totalUsageCost = keys.reduce((acc, k) => acc + (k.usage_cost || 0), 0);
    const activeKeysCount = keys.filter((k) => k.enabled).length;

    const handleCreateKey = async (data: CreateAPIKeyZod) => {
        const res = await createKey(data);
        if (res) {
            setIsCreateOpen(false);
        }
    };

    const handleDeleteKey = async (id: string) => {
        const success = await deleteKey(id);
        if (success) {
            setKeyToDelete(null);
        }
    };

    if (loading) {
        return <KeysSkeleton />;
    }

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans">
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-ink" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            Access Control
                        </p>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                        API Keys.
                    </h1>
                    <p className="mt-1 text-base font-light text-text-muted font-sans">
                        Credentials for client SDKs, downstream applications, and automated
                        pipelines.
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                        type="button"
                        onClick={() => setIsCreateOpen(true)}
                        className="h-10 shrink-0 gap-2 rounded-full px-5 text-sm font-semibold cursor-pointer shadow-none"
                    >
                        <Plus className="size-4" />
                        <span>Create API Key</span>
                    </Button>
                </div>
            </header>

            <KeyMetrics
                totalKeys={keys.length}
                activeKeys={activeKeysCount}
                totalUsageTokens={totalUsageTokens}
                totalUsageCost={totalUsageCost}
            />

            <KeyTable
                keys={keys}
                deletingId={deletingId}
                onCreateClick={() => setIsCreateOpen(true)}
                onEditClick={(key) => setKeyToEdit(key)}
                onDeleteClick={(key) => setKeyToDelete(key)}
            />

            <CreateKeyDialog
                open={isCreateOpen}
                creating={creating}
                onOpenChange={setIsCreateOpen}
                onSubmit={handleCreateKey}
            />

            <EditKeyDialog
                api_key={keyToEdit}
                open={Boolean(keyToEdit)}
                updating={Boolean(updatingId)}
                onOpenChange={(open) => !open && setKeyToEdit(null)}
                onSubmit={async (id, data) => {
                    await updateKey(id, data);
                }}
            />

            <KeySecretModal new_key={newlyCreatedKey} onClose={() => setNewlyCreatedKey(null)} />

            <KeyDeleteDialog
                IDKey={keyToDelete}
                deleting={Boolean(deletingId)}
                onClose={() => setKeyToDelete(null)}
                onConfirm={handleDeleteKey}
            />
        </div>
    );
}
