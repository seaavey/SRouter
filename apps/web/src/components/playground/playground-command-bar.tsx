import { Link } from "@tanstack/react-router";
import { Code2, Eraser, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlaygroundModel } from "./types";

interface PlaygroundCommandBarProps {
    models: PlaygroundModel[];
    model: string;
    selectedModel?: PlaygroundModel;
    modelsPending: boolean;
    modelsError: boolean;
    modelsQueryError: unknown;
    onModelChange: (model: string) => void;
    onRetryModels: () => void;
    onOpenParams: () => void;
    onOpenCode: () => void;
    onClear: () => void;
    hasMessages: boolean;
}

export function PlaygroundCommandBar({
    models,
    model,
    selectedModel,
    modelsPending,
    modelsError,
    modelsQueryError,
    onModelChange,
    onRetryModels,
    onOpenParams,
    onOpenCode,
    onClear,
    hasMessages,
}: PlaygroundCommandBarProps) {
    return (
        <section className="border-b border-border/70 pb-4" aria-label="Playground controls">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 lg:max-w-xl">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        <span>Route model</span>
                        <span className="h-px w-5 bg-border" aria-hidden="true" />
                        <span className="text-foreground/70">streaming</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                        <label htmlFor="playground-model" className="sr-only">Model</label>
                        <select
                            id="playground-model"
                            value={model}
                            disabled={modelsPending || models.length === 0}
                            onChange={(event) => onModelChange(event.target.value)}
                            aria-describedby="playground-model-status"
                            className="h-10 min-w-0 flex-1 appearance-none rounded-none border border-border bg-background px-3 pr-8 text-sm font-mono text-foreground outline-none transition-colors hover:border-foreground/40 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {modelsPending ? <option value="">Loading models...</option> : null}
                            {modelsError ? <option value="">Models unavailable</option> : null}
                            {!modelsPending && !modelsError && models.length === 0 ? <option value="">No models available</option> : null}
                            {models.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.id}
                                </option>
                            ))}
                        </select>
                        <div className="flex h-10 shrink-0 items-center border border-border/70 bg-muted/20 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                            {selectedModel?.owned_by ?? "No route"}
                        </div>
                    </div>
                    <p id="playground-model-status" className="mt-2 min-h-4 text-[11px] leading-relaxed text-muted-foreground" role="status" aria-live="polite">
                        {modelsError ? (
                            <>
                                {modelsQueryError instanceof Error ? modelsQueryError.message : "Could not load models."}{" "}
                                <button type="button" onClick={onRetryModels} className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground">
                                    Retry
                                </button>
                            </>
                        ) : models.length === 0 && !modelsPending ? (
                            <>Add a provider or model in <Link to="/providers" className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground">Providers</Link>.</>
                        ) : selectedModel ? (
                            `Requests use the ${selectedModel.owned_by ?? "SRouter"} route.`
                        ) : (
                            "Choose a model to start a request."
                        )}
                    </p>
                </div>

                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={onOpenParams}>
                        <SlidersHorizontal />
                        Parameters
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenCode} disabled={!selectedModel}>
                        <Code2 />
                        Export request
                    </Button>
                    {hasMessages ? (
                        <Button type="button" variant="ghost" size="sm" onClick={onClear} aria-label="Clear conversation">
                            <Eraser />
                            Clear
                        </Button>
                    ) : null}
                </div>
            </div>
        </section>
    );
}
