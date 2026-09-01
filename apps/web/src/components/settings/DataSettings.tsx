import { useState, useRef, useEffect } from "react";
import {
    Database,
    Download,
    Upload,
    Trash2,
    RotateCcw,
    HardDrive,
    AlertTriangle,
    FileJson,
    Check,
    Loader2
} from "lucide-react";
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
import { SettingsSection, SettingsRow } from "./settings-ui";
import type { StorageStats } from "@/hooks/useSettings";

interface DataSettingsProps {
    exportSettings: () => void;
    importSettings: (json: string) => boolean;
    clearPlaygroundHistory: () => void;
    resetToDefaults: () => void;
    getStorageStats: () => StorageStats;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function DataSettings({
    exportSettings,
    importSettings,
    clearPlaygroundHistory,
    resetToDefaults,
    getStorageStats
}: DataSettingsProps) {
    const [stats, setStats] = useState<StorageStats>({
        totalBytes: 0,
        itemsCount: 0,
        playgroundBytes: 0,
        settingsBytes: 0
    });

    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [isClearOpen, setIsClearOpen] = useState(false);
    const [isResetOpen, setIsResetOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const refreshStats = () => {
        setStats(getStorageStats());
    };

    useEffect(() => {
        refreshStats();
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (content) setImportText(content);
        };
        reader.readAsText(file);
    };

    const handleImportSubmit = () => {
        if (!importText.trim()) {
            toast.error("Please provide valid JSON configuration");
            return;
        }
        const success = importSettings(importText);
        if (success) {
            setIsImportOpen(false);
            setImportText("");
            refreshStats();
        }
    };

    const handleConfirmClear = () => {
        clearPlaygroundHistory();
        setIsClearOpen(false);
        refreshStats();
    };

    const handleConfirmReset = () => {
        resetToDefaults();
        setIsResetOpen(false);
        refreshStats();
    };

    return (
        <div className="space-y-5">
            <SettingsSection
                title="Data, Backup & Local Storage"
                description="Inspect local storage footprint, export portability backups, or purge local session cache."
                icon={<Database className="size-4" />}
            >
                {/* Storage Usage Meter */}
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <HardDrive className="size-4 text-muted-foreground" />
                            <span className="text-xs font-bold text-foreground">
                                Browser LocalStorage
                            </span>
                        </div>
                        <span className="text-xs font-mono font-bold tabular-nums text-foreground">
                            {formatBytes(stats.totalBytes)} ({stats.itemsCount} keys)
                        </span>
                    </div>

                    <div className="space-y-1.5">
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                            <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{
                                    width: `${stats.totalBytes > 0 ? (stats.playgroundBytes / stats.totalBytes) * 100 : 0}%`
                                }}
                                title={`Playground: ${formatBytes(stats.playgroundBytes)}`}
                            />
                            <div
                                className="h-full bg-amber-500 transition-all duration-300"
                                style={{
                                    width: `${stats.totalBytes > 0 ? (stats.settingsBytes / stats.totalBytes) * 100 : 0}%`
                                }}
                                title={`Settings: ${formatBytes(stats.settingsBytes)}`}
                            />
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <span className="size-2 rounded-full bg-blue-500" />
                                Playground: {formatBytes(stats.playgroundBytes)}
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="size-2 rounded-full bg-amber-500" />
                                Preferences: {formatBytes(stats.settingsBytes)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Action Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col justify-between p-4 rounded-xl border border-border/70 bg-background space-y-3">
                        <div className="space-y-1">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <Download className="size-3.5 text-blue-500" />
                                <span>Export Configuration</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Download all preferences as an offline JSON archive.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={exportSettings}
                            className="w-full font-semibold cursor-pointer"
                        >
                            <Download className="size-3.5" />
                            Export Backup JSON
                        </Button>
                    </div>
                    <div className="flex flex-col justify-between p-4 rounded-xl border border-border/70 bg-background space-y-3">
                        <div className="space-y-1">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <Upload className="size-3.5 text-emerald-500" />
                                <span>Import Configuration</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Restore preferences from a saved SRouter settings JSON file.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsImportOpen(true)}
                            className="w-full font-semibold cursor-pointer"
                        >
                            <Upload className="size-3.5" />
                            Import Backup JSON
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col justify-between p-4 rounded-xl border border-border/70 bg-background space-y-3">
                        <div className="space-y-1">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <Trash2 className="size-3.5 text-rose-500" />
                                <span>Clear Playground History</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Delete all cached chat threads and conversations from browser
                                memory.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => setIsClearOpen(true)}
                            className="w-full font-semibold cursor-pointer"
                        >
                            <Trash2 className="size-3.5" />
                            Clear Sessions
                        </Button>
                    </div>
                    <div className="flex flex-col justify-between p-4 rounded-xl border border-border/70 bg-background space-y-3">
                        <div className="space-y-1">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <RotateCcw className="size-3.5 text-amber-500" />
                                <span>Factory Reset</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Restore all client gateway parameters and UI themes to factory
                                defaults.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsResetOpen(true)}
                            className="w-full text-amber-500 hover:text-amber-600 font-semibold cursor-pointer"
                        >
                            <RotateCcw className="size-3.5" />
                            Reset All to Defaults
                        </Button>
                    </div>
                </div>
            </SettingsSection>

            {/* Modals */}
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                            <FileJson className="size-4 text-emerald-500" />
                            Import Settings
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Select a JSON file or paste exported JSON settings content below.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <input
                            type="file"
                            accept=".json,application/json"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full font-semibold cursor-pointer"
                        >
                            <Upload className="size-3.5" />
                            Choose JSON File
                        </Button>
                        <div className="relative">
                            <textarea
                                rows={6}
                                value={importText}
                                onChange={(e) => setImportText(e.target.value)}
                                placeholder="Or paste JSON configuration here..."
                                className="w-full rounded-xl border border-border/70 bg-muted/20 p-3 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsImportOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleImportSubmit}
                            className="font-semibold"
                        >
                            <Check className="size-3.5" />
                            Apply Imported Settings
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isClearOpen} onOpenChange={setIsClearOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-bold text-rose-500">
                            <Trash2 className="size-4" />
                            Clear Playground History?
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            This will permanently delete all cached conversations from this browser.
                            This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsClearOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={handleConfirmClear}
                        >
                            Yes, Clear All History
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-bold text-amber-500">
                            <AlertTriangle className="size-4" />
                            Reset Settings to Defaults?
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            All custom timeout limits, retry backoffs, and playground parameters
                            will be reset to factory values.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 pt-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsResetOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleConfirmReset}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            Yes, Reset to Defaults
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
