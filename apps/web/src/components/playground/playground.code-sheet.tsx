import React from "react";
import { Check, Code2, Copy, FileCode, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ExportLanguage, PlaygroundModel } from "./playground.types";

interface CodeSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    exportLanguage: ExportLanguage;
    onExportLanguageChange: (lang: ExportLanguage) => void;
    generateCode: (lang: ExportLanguage) => string;
    canCopy: boolean;
    copied: boolean;
    onCopy: () => void;
    selectedModel?: PlaygroundModel;
}

const LANGUAGES: Array<{ id: ExportLanguage; label: string; icon: typeof Terminal }> = [
    { id: "curl", label: "cURL", icon: Terminal },
    { id: "typescript", label: "TypeScript (SDK)", icon: FileCode },
    { id: "python", label: "Python (SDK)", icon: FileCode },
    { id: "fetch", label: "JavaScript (Fetch)", icon: Code2 }
];

export function CodeSheet({
    open,
    onOpenChange,
    exportLanguage,
    onExportLanguageChange,
    generateCode,
    canCopy,
    copied,
    onCopy,
    selectedModel
}: CodeSheetProps) {
    const code = generateCode(exportLanguage);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full space-y-5 overflow-y-auto p-4 sm:max-w-xl sm:p-6"
            >
                <SheetHeader className="flex flex-row items-center justify-between border-b border-border/60 p-0 pb-4">
                    <SheetTitle className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-wider">
                        <Code2 className="size-4" /> Export Request Code
                    </SheetTitle>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCopy}
                        disabled={!canCopy}
                        className="h-8 gap-1.5 font-mono text-xs"
                    >
                        {copied ? (
                            <>
                                <Check className="size-3.5 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                            </>
                        ) : (
                            <>
                                <Copy className="size-3.5" />
                                <span>Copy Code</span>
                            </>
                        )}
                    </Button>
                </SheetHeader>

                {/* Language Tabs */}
                <div className="flex flex-wrap gap-1.5 border-b border-border/40 pb-3">
                    {LANGUAGES.map((lang) => {
                        const Icon = lang.icon;
                        const isActive = exportLanguage === lang.id;
                        return (
                            <button
                                key={lang.id}
                                type="button"
                                onClick={() => onExportLanguageChange(lang.id)}
                                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-all ${
                                    isActive
                                        ? "bg-foreground text-background font-bold shadow-xs"
                                        : "bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                }`}
                            >
                                <Icon className="size-3.5" />
                                <span>{lang.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Code Container */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        <span>Target: {selectedModel?.id || "model-id"}</span>
                        <span>API Base: /v1/chat/completions</span>
                    </div>
                    <pre className="max-h-[60vh] overflow-x-auto rounded-lg border border-border/80 bg-secondary/30 p-4 font-mono text-[11px] leading-relaxed text-foreground">
                        <code>{code}</code>
                    </pre>
                </div>

                <div className="rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] text-muted-foreground">
                    💡 SRouter provides native drop-in compatibility with OpenAI SDKs and clients.
                    Replace <code className="text-foreground">YOUR_API_KEY</code> with a valid key
                    generated from the API Keys tab.
                </div>
            </SheetContent>
        </Sheet>
    );
}
