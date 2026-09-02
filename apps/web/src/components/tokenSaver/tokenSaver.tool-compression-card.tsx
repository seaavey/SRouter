import {
    ExternalLink,
    FileText,
    FolderTree,
    GitBranch,
    Search,
    Sliders,
    TerminalSquare
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import type { CompressToolOutputSettings } from "@srouter/types";

interface ToolCompressionCardProps {
    settings: CompressToolOutputSettings;
    saving: boolean;
    onChange: (settings: Partial<CompressToolOutputSettings>) => void;
}

export function ToolCompressionCard({ settings, saving, onChange }: ToolCompressionCardProps) {
    const isEffectivelyEnabled = settings.enabled;

    return (
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-5 shadow-2xs font-mono transition-all">
            <div>
                {/* Module Header */}
                <div className="flex items-center justify-between pb-3.5 border-b border-border/60">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-md border border-border/70 bg-secondary/50 text-foreground">
                            <TerminalSquare className="size-3.5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                <a
                                    href="https://github.com/rtk-ai/rtk"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                                    title="Visit rtk-ai/rtk on GitHub"
                                >
                                    <h2>Tool Output Compression</h2>
                                    <ExternalLink className="size-2.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                                </a>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Minifies verbose terminal and command outputs before LLM dispatch.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Switch
                            checked={settings.enabled}
                            onCheckedChange={(enabled) => onChange({ enabled })}
                            disabled={saving}
                        />
                    </div>
                </div>

                {/* Technical Options List */}
                <div className="mt-4 space-y-2.5">
                    {/* Git Diff & Status */}
                    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/60 bg-secondary/20">
                        <div className="flex items-start gap-2.5">
                            <GitBranch className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <div className="text-xs font-semibold text-foreground">
                                    Git Diffs, Status &amp; Logs
                                </div>
                                <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                                    Strips index hashes, mode changes, and compacts unified diff
                                    headers and commit lists.
                                </div>
                            </div>
                        </div>
                        <Switch
                            checked={settings.compressGit}
                            onCheckedChange={(compressGit) => onChange({ compressGit })}
                            disabled={saving || !isEffectivelyEnabled}
                            className="shrink-0"
                        />
                    </div>

                    {/* Grep Results */}
                    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/60 bg-secondary/20">
                        <div className="flex items-start gap-2.5">
                            <Search className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <div className="text-xs font-semibold text-foreground">
                                    Grep &amp; Ripgrep Results
                                </div>
                                <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                                    Groups match lines by file and removes redundant workspace path
                                    prefixes.
                                </div>
                            </div>
                        </div>
                        <Switch
                            checked={settings.compressGrep}
                            onCheckedChange={(compressGrep) => onChange({ compressGrep })}
                            disabled={saving || !isEffectivelyEnabled}
                            className="shrink-0"
                        />
                    </div>

                    {/* Directory Listings */}
                    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/60 bg-secondary/20">
                        <div className="flex items-start gap-2.5">
                            <FolderTree className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <div className="text-xs font-semibold text-foreground">
                                    Directory &amp; Tree Listings
                                </div>
                                <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                                    Removes permission columns and compacts <code>tree</code> /{" "}
                                    <code>ls -la</code> outputs.
                                </div>
                            </div>
                        </div>
                        <Switch
                            checked={settings.compressFileLists}
                            onCheckedChange={(compressFileLists) => onChange({ compressFileLists })}
                            disabled={saving || !isEffectivelyEnabled}
                            className="shrink-0"
                        />
                    </div>

                    {/* Build & Runtime Logs */}
                    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/60 bg-secondary/20">
                        <div className="flex items-start gap-2.5">
                            <FileText className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                                <div className="text-xs font-semibold text-foreground">
                                    Build &amp; Runtime Logs
                                </div>
                                <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                                    Deduplicates progress bars, collapses identical error lines, and
                                    cleans noisy timestamps.
                                </div>
                            </div>
                        </div>
                        <Switch
                            checked={settings.compressLogs}
                            onCheckedChange={(compressLogs) => onChange({ compressLogs })}
                            disabled={saving || !isEffectivelyEnabled}
                            className="shrink-0"
                        />
                    </div>

                    {/* Clean Whitespace & Min Char Threshold */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border/60 bg-secondary/30 text-xs">
                        <div className="flex items-center gap-2">
                            <Sliders className="size-3.5 text-muted-foreground shrink-0" />
                            <span className="text-foreground font-semibold text-[11px]">
                                Strip Terminal ANSI &amp; Whitespace
                            </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span>Min Size:</span>
                                <Input
                                    type="number"
                                    min={0}
                                    max={2000}
                                    value={settings.minCharacterThreshold}
                                    onChange={(e) =>
                                        onChange({
                                            minCharacterThreshold: Math.max(
                                                0,
                                                parseInt(e.target.value, 10) || 0
                                            )
                                        })
                                    }
                                    disabled={saving || !isEffectivelyEnabled}
                                    className="h-6.5 w-16 text-xs font-mono text-center bg-background px-1"
                                />
                                <span>chars</span>
                            </div>

                            <Switch
                                checked={settings.stripAnsiAndWhitespace}
                                onCheckedChange={(stripAnsiAndWhitespace) =>
                                    onChange({ stripAnsiAndWhitespace })
                                }
                                disabled={saving || !isEffectivelyEnabled}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
