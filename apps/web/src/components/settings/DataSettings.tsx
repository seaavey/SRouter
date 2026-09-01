import { useState, useRef, useEffect } from "react";
import { Download, Upload, Trash2, RotateCcw, HardDrive } from "lucide-react";
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
import { SettingsSection, SettingsRow, ValueBadge } from "./settings-ui";
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

export function DataSettings(props: DataSettingsProps) {
    const {
        exportSettings,
        importSettings,
        clearPlaygroundHistory,
        resetToDefaults,
        getStorageStats
    } = props;
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

    return (
        <SettingsSection index="06" title="Data" description="Storage backup, import, and cleanup.">
            <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                    <HardDrive className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">LocalStorage</span>
                </div>
                <span className="font-mono text-[11px] font-bold tabular-nums text-foreground">
                    {formatBytes(stats.totalBytes)} ({stats.itemsCount} keys)
                </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex mb-2">
                <div
                    className="h-full bg-blue-500"
                    style={{
                        width: `${stats.totalBytes > 0 ? (stats.playgroundBytes / stats.totalBytes) * 100 : 0}%`
                    }}
                />
                <div
                    className="h-full bg-amber-500"
                    style={{
                        width: `${stats.totalBytes > 0 ? (stats.settingsBytes / stats.totalBytes) * 100 : 0}%`
                    }}
                />
            </div>
            <div className="flex gap-3 text-[10px] font-mono text-muted-foreground pb-2">
                <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-blue-500" /> Playground:{" "}
                    {formatBytes(stats.playgroundBytes)}
                </span>
                <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-amber-500" /> Settings:{" "}
                    {formatBytes(stats.settingsBytes)}
                </span>
            </div>

            <div className="flex flex-wrap gap-2 py-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={exportSettings}
                    className="text-[11px] cursor-pointer"
                >
                    <Download className="size-3" /> Export
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsImportOpen(true)}
                    className="text-[11px] cursor-pointer"
                >
                    <Upload className="size-3" /> Import
                </Button>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsClearOpen(true)}
                    className="text-[11px] cursor-pointer"
                >
                    <Trash2 className="size-3" /> Clear
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsResetOpen(true)}
                    className="text-[11px] text-amber-500 cursor-pointer"
                >
                    <RotateCcw className="size-3" /> Reset
                </Button>
            </div>

            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-sm font-bold">Import Settings</DialogTitle>
                        <DialogDescription className="text-xs">
                            Paste exported JSON or select a file.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
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
                            className="w-full cursor-pointer"
                        >
                            <Upload className="size-3" /> Choose File
                        </Button>
                        <textarea
                            rows={5}
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder="Or paste JSON here..."
                            className="w-full rounded-md border border-border/70 bg-muted/20 p-2.5 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                    </div>
                    <DialogFooter>
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
                            onClick={handleImport}
                            className="font-semibold"
                        >
                            Apply Import
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isClearOpen} onOpenChange={setIsClearOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-sm font-bold text-rose-500">
                            Clear Playground History?
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            This deletes all cached conversations from this browser. Cannot be
                            undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
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
                            onClick={() => {
                                clearPlaygroundHistory();
                                setIsClearOpen(false);
                                refresh();
                            }}
                        >
                            Clear All
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-sm font-bold text-amber-500">
                            Reset to Defaults?
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Timeouts, retries, and playground parameters will be restored to factory
                            values.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
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
                            onClick={() => {
                                resetToDefaults();
                                setIsResetOpen(false);
                                refresh();
                            }}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                            Reset
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </SettingsSection>
    );
}
