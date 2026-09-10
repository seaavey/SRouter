import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Upload, Trash2, RotateCcw, HardDrive, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { SettingsSection } from "./settings.ui";
import type { StorageStats } from "@/hooks/useSettings";
import type { DatabaseImportResult } from "@/lib/api";
import { downloadDatabaseBlob } from "@/lib/databaseTransfer";

interface DataSettingsProps {
    exportSettings: () => void;
    importSettings: (json: string) => boolean;
    exportDatabase: () => Promise<Blob>;
    importDatabase: (file: File) => Promise<DatabaseImportResult>;
    clearStorage: () => void;
    resetToDefaults: () => void;
    getStorageStats: () => StorageStats;
}

export function isDatabaseFile(file: File | undefined): boolean {
    return file?.name.toLowerCase().endsWith(".db") ?? false;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function DataSettings(props: DataSettingsProps) {
    const {
        exportSettings,
        importSettings,
        exportDatabase,
        importDatabase,
        clearStorage,
        resetToDefaults,
        getStorageStats
    } = props;
    const [stats, setStats] = useState<StorageStats>({
        totalBytes: 0,
        itemsCount: 0,
        settingsBytes: 0
    });
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [isClearOpen, setIsClearOpen] = useState(false);
    const [isResetOpen, setIsResetOpen] = useState(false);
    const [isDatabaseImportOpen, setIsDatabaseImportOpen] = useState(false);
    const [databaseFile, setDatabaseFile] = useState<File>();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const databaseFileInputRef = useRef<HTMLInputElement>(null);

    const databaseExportMutation = useMutation({
        mutationFn: exportDatabase,
        onSuccess: (blob) => {
            downloadDatabaseBlob(blob);
            toast.success("Database export downloaded");
        },
        onError: (error) => {
            toast.error("Database export failed", {
                description: error instanceof Error ? error.message : "Try again."
            });
        }
    });

    const databaseImportMutation = useMutation({
        mutationFn: importDatabase,
        onSuccess: (result) => {
            toast.success("Database imported", {
                description: result.reauth_required
                    ? "Database restored. Sign in again to continue."
                    : result.restart_required
                      ? "Restart SRouter before continuing to use the dashboard."
                      : `Previous database backed up at ${result.backup_path}.`
            });
            if (result.reauth_required) {
                window.location.assign(window.location.href);
                return;
            }
        },
        onError: (error) => {
            toast.error("Database import failed", {
                description:
                    error instanceof Error
                        ? error.message
                        : "Choose a valid SRouter database and try again."
            });
        }
    });

    const refresh = () => setStats(getStorageStats());
    useEffect(() => {
        refresh();
    }, []);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const c = ev.target?.result as string;
            if (c) setImportText(c);
        };
        reader.readAsText(file);
    };

    const handleImport = () => {
        if (!importText.trim()) {
            toast.error("Please provide valid JSON");
            return;
        }
        if (importSettings(importText)) {
            setIsImportOpen(false);
            setImportText("");
            refresh();
        }
    };

    const handleDatabaseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!isDatabaseFile(file)) {
            toast.error("Choose a .db database file");
            event.target.value = "";
            return;
        }
        databaseImportMutation.reset();
        setDatabaseFile(file);
        setIsDatabaseImportOpen(true);
    };

    const closeDatabaseImport = () => {
        if (databaseImportMutation.isPending) return;
        setIsDatabaseImportOpen(false);
        setDatabaseFile(undefined);
        const fileInput = databaseFileInputRef.current;
        if (fileInput) fileInput.value = "";
        databaseImportMutation.reset();
    };

    const handleDatabaseImport = () => {
        if (!databaseFile || databaseImportMutation.isPending) return;
        databaseImportMutation.mutate(databaseFile);
    };

    return (
        <SettingsSection
            id="data"
            icon={HardDrive}
            tag="Backup"
            title="Local Data & Storage"
            description="Client-side configuration snapshot backup, restore, and storage clearing."
        >
            <div className="flex items-center justify-between py-3 font-sans">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">LocalStorage Usage</span>
                </div>
                <span className="font-mono text-xs font-bold tabular-nums text-ink">
                    {formatBytes(stats.totalBytes)} ({stats.itemsCount} keys)
                </span>
            </div>

            <div className="flex flex-wrap gap-2 py-3 font-sans">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={exportSettings}
                    className="rounded-full border border-hairline-soft bg-canvas px-4 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                >
                    <Download className="size-3.5" /> Export
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsImportOpen(true)}
                    className="rounded-full border border-hairline-soft bg-canvas px-4 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                >
                    <Upload className="size-3.5" /> Import
                </Button>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsClearOpen(true)}
                    className="rounded-full px-4 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
                >
                    <Trash2 className="size-3.5" /> Clear Cache
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsResetOpen(true)}
                    className="rounded-full border border-hairline-soft bg-canvas px-4 text-xs font-semibold text-amber-600 dark:text-amber-500 hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                >
                    <RotateCcw className="size-3.5" /> Reset
                </Button>
            </div>

            <div className="border-t border-hairline-soft py-5 font-sans">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 pr-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                            <span>Server database migration</span>
                        </div>
                        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted font-light">
                            Move the complete SQLite database, including API keys and provider
                            credentials. Export files contain sensitive plaintext data.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={databaseExportMutation.isPending}
                            onClick={() => databaseExportMutation.mutate()}
                            className="rounded-full border border-hairline-soft bg-canvas px-4 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                        >
                            <Download className="size-3.5" />
                            <span>
                                {databaseExportMutation.isPending
                                    ? "Exporting..."
                                    : "Export Database"}
                            </span>
                        </Button>
                        <input
                            ref={databaseFileInputRef}
                            type="file"
                            accept=".db"
                            onChange={handleDatabaseFile}
                            className="sr-only"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={databaseImportMutation.isPending}
                            onClick={() => databaseFileInputRef.current?.click()}
                            className="rounded-full border border-hairline-soft bg-canvas px-4 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                        >
                            <Upload className="size-3.5" /> <span>Import Database</span>
                        </Button>
                    </div>
                </div>
            </div>

            <Dialog
                open={isDatabaseImportOpen}
                onOpenChange={(open) => {
                    if (!open) closeDatabaseImport();
                }}
            >
                <DialogContent className="rounded-3xl border border-hairline-soft bg-canvas p-6 md:p-8 shadow-none font-sans max-w-lg">
                    <DialogHeader className="space-y-2 text-left">
                        <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-destructive font-sans">
                            <AlertTriangle className="size-5" /> Replace server database?
                        </DialogTitle>
                        <DialogDescription className="text-sm text-text-muted font-light font-sans">
                            This operation replaces all current SRouter data. API keys and provider
                            credentials from the file will be restored. The current database will be
                            backed up first, but this cannot be undone from the dashboard.
                        </DialogDescription>
                    </DialogHeader>
                    {databaseFile && (
                        <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4 text-xs font-mono">
                            <div className="font-semibold text-ink">{databaseFile.name}</div>
                            <div className="mt-1 text-text-muted">
                                {formatBytes(databaseFile.size)}
                            </div>
                        </div>
                    )}
                    {databaseImportMutation.isError && (
                        <p role="alert" className="text-xs text-destructive font-medium">
                            {databaseImportMutation.error instanceof Error
                                ? databaseImportMutation.error.message
                                : "Import failed. Choose a valid database file and try again."}
                        </p>
                    )}
                    {databaseImportMutation.isSuccess && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            Database backed up at {databaseImportMutation.data.backup_path}.
                            {databaseImportMutation.data.restart_required &&
                                " Restart SRouter before continuing to use the dashboard."}
                        </p>
                    )}
                    <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 sm:space-x-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={databaseImportMutation.isPending}
                            onClick={closeDatabaseImport}
                            className="rounded-full border border-hairline-soft bg-canvas px-5 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={
                                databaseImportMutation.isPending ||
                                (!databaseFile && !databaseImportMutation.isSuccess)
                            }
                            onClick={() => {
                                if (databaseImportMutation.isSuccess) {
                                    closeDatabaseImport();
                                    return;
                                }
                                handleDatabaseImport();
                            }}
                            className="rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none"
                        >
                            {databaseImportMutation.isPending
                                ? "Importing..."
                                : databaseImportMutation.isSuccess
                                  ? "Close"
                                  : "Replace Database"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent className="rounded-3xl border border-hairline-soft bg-canvas p-6 md:p-8 shadow-none font-sans max-w-lg">
                    <DialogHeader className="space-y-2 text-left">
                        <DialogTitle className="text-lg font-semibold text-ink font-sans">
                            Import Settings
                        </DialogTitle>
                        <DialogDescription className="text-sm text-text-muted font-light font-sans">
                            Paste exported JSON or select a file.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-3 font-sans">
                        <input
                            type="file"
                            accept=".json,application/json"
                            ref={fileInputRef}
                            onChange={handleFile}
                            className="hidden"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full rounded-full border border-hairline-soft bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                        >
                            <Upload className="size-3.5" /> Choose File
                        </Button>
                        <textarea
                            rows={5}
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder="Or paste JSON here..."
                            className="w-full rounded-2xl border border-hairline-soft bg-field p-3 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-ink"
                        />
                    </div>
                    <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 sm:space-x-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsImportOpen(false)}
                            className="rounded-full border border-hairline-soft bg-canvas px-5 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleImport}
                            className="rounded-full bg-ink text-canvas hover:opacity-90 px-5 text-xs font-semibold cursor-pointer shadow-none"
                        >
                            Apply Import
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isClearOpen} onOpenChange={setIsClearOpen}>
                <DialogContent className="rounded-3xl border border-hairline-soft bg-canvas p-6 md:p-8 shadow-none font-sans max-w-md">
                    <DialogHeader className="space-y-2 text-left">
                        <DialogTitle className="text-lg font-semibold text-destructive font-sans">
                            Clear cached browser data?
                        </DialogTitle>
                        <DialogDescription className="text-sm text-text-muted font-light font-sans">
                            Removes cached conversations and temporary data from this browser.
                            Settings are preserved. Cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 sm:space-x-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsClearOpen(false)}
                            className="rounded-full border border-hairline-soft bg-canvas px-5 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                                clearStorage();
                                setIsClearOpen(false);
                                refresh();
                            }}
                            className="rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none"
                        >
                            Clear All
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
                <DialogContent className="rounded-3xl border border-hairline-soft bg-canvas p-6 md:p-8 shadow-none font-sans max-w-md">
                    <DialogHeader className="space-y-2 text-left">
                        <DialogTitle className="text-lg font-semibold text-amber-600 dark:text-amber-500 font-sans">
                            Reset to Defaults?
                        </DialogTitle>
                        <DialogDescription className="text-sm text-text-muted font-light font-sans">
                            Timeouts, retries, and gateway parameters will be restored to factory
                            values.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 sm:space-x-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsResetOpen(false)}
                            className="rounded-full border border-hairline-soft bg-canvas px-5 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                resetToDefaults();
                                setIsResetOpen(false);
                                refresh();
                            }}
                            className="rounded-full bg-amber-600 hover:bg-amber-700 text-white px-5 text-xs font-semibold cursor-pointer shadow-none"
                        >
                            Reset
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </SettingsSection>
    );
}
