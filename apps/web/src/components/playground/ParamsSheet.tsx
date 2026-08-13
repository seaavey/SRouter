import { SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface ParamsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    systemPrompt: string;
    temperature: number;
    topP: number;
    maxTokens?: number;
    onSystemPromptChange: (value: string) => void;
    onTemperatureChange: (value: number) => void;
    onTopPChange: (value: number) => void;
    onMaxTokensChange: (value: number | undefined) => void;
}

export function ParamsSheet({
    open,
    onOpenChange,
    systemPrompt,
    temperature,
    topP,
    maxTokens,
    onSystemPromptChange,
    onTemperatureChange,
    onTopPChange,
    onMaxTokensChange,
}: ParamsSheetProps) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full space-y-6 overflow-y-auto p-4 sm:max-w-md sm:p-6"
            >
                <SheetHeader className="border-b border-border/60 p-0 pb-4">
                    <SheetTitle className="flex items-center gap-2 text-base">
                        <SlidersHorizontal /> Request parameters
                    </SheetTitle>
                </SheetHeader>
                <div className="space-y-6 text-xs">
                    <div className="space-y-2">
                        <label htmlFor="system-prompt" className="font-medium text-foreground">
                            System prompt
                        </label>
                        <textarea
                            id="system-prompt"
                            value={systemPrompt}
                            onChange={(event) => onSystemPromptChange(event.target.value)}
                            rows={6}
                            className="w-full resize-y rounded-none border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between gap-3">
                            <label htmlFor="temperature" className="font-medium text-foreground">
                                Temperature
                            </label>
                            <output
                                htmlFor="temperature"
                                className="font-mono text-muted-foreground"
                            >
                                {temperature.toFixed(2)}
                            </output>
                        </div>
                        <input
                            id="temperature"
                            type="range"
                            min="0"
                            max="2"
                            step="0.05"
                            value={temperature}
                            onChange={(event) => onTemperatureChange(Number(event.target.value))}
                            className="w-full accent-foreground"
                        />
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Higher values produce more variation.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between gap-3">
                            <label htmlFor="top-p" className="font-medium text-foreground">
                                Top P
                            </label>
                            <output htmlFor="top-p" className="font-mono text-muted-foreground">
                                {topP.toFixed(2)}
                            </output>
                        </div>
                        <input
                            id="top-p"
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={topP}
                            onChange={(event) => onTopPChange(Number(event.target.value))}
                            className="w-full accent-foreground"
                        />
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Limits the token pool used for sampling.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="max-tokens" className="font-medium text-foreground">
                            Max tokens
                        </label>
                        <input
                            id="max-tokens"
                            type="number"
                            min="1"
                            step="1"
                            value={maxTokens ?? ""}
                            onChange={(event) =>
                                onMaxTokensChange(
                                    event.target.value ? Number(event.target.value) : undefined,
                                )
                            }
                            placeholder="No limit"
                            className="h-9 w-full rounded-none border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Leave empty to use the provider default.
                        </p>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
