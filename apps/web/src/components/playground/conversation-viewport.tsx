import type { PlaygroundMessage, PlaygroundModel } from "./types";

interface ConversationViewportProps {
    messages: PlaygroundMessage[];
    selectedModel?: PlaygroundModel;
    streaming: boolean;
}

export function ConversationViewport({ messages, selectedModel, streaming }: ConversationViewportProps) {
    return (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-background" aria-labelledby="playground-canvas-title">
            <h2 id="playground-canvas-title" className="sr-only">Conversation</h2>
            <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label="Chat messages" aria-busy={streaming}>
                {messages.length === 0 ? (
                    <div className="flex min-h-[22rem] h-full flex-col justify-between px-5 py-6 sm:px-8 sm:py-8">
                        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            <span>Conversation</span>
                            <span>Ready</span>
                        </div>
                        <div className="max-w-lg pb-6">
                            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Test surface</p>
                            <p className="max-w-md text-xl font-semibold tracking-[-0.035em] text-foreground sm:text-2xl">
                                Send a prompt through your selected route.
                            </p>
                            <p className="mt-3 max-w-md text-xs leading-relaxed text-muted-foreground">
                                The response will stream here as it arrives. Use Parameters when you need to tune the request.
                            </p>
                            <p className="mt-6 font-mono text-[11px] text-muted-foreground">
                                target <span className="text-foreground">{selectedModel?.id ?? "no model selected"}</span>
                            </p>
                        </div>
                    </div>
                ) : (
                    <ol className="divide-y divide-border/60">
                        {messages.map((message, index) => {
                            const isActiveAssistant = streaming && index === messages.length - 1 && message.role === "assistant";
                            const isError = message.role === "assistant" && message.content.startsWith("Error:");
                            return (
                                <li key={`${message.role}-${index}`} className="grid gap-2 px-5 py-5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-5 sm:px-8">
                                    <div className="flex items-start justify-between gap-3 sm:block">
                                        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                            {message.role}
                                        </span>
                                        <span className="font-mono text-[10px] text-muted-foreground/60 sm:mt-2 sm:block">{String(index + 1).padStart(2, "0")}</span>
                                    </div>
                                    <p className={`max-w-3xl whitespace-pre-wrap text-xs leading-[1.8] ${isError ? "text-destructive" : "text-foreground"}`}>
                                        {message.content || <span className="text-muted-foreground">Generating response<span className="animate-pulse">...</span></span>}
                                        {isActiveAssistant && message.content ? <span className="ml-1 inline-block h-3 w-px translate-y-[2px] bg-foreground align-baseline" aria-hidden="true" /> : null}
                                    </p>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </section>
    );
}
