import { Coins } from "lucide-react";

export function TokenSaverHeader() {
    return (
        <header className="rounded-xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs font-mono">
            <div className="space-y-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="flex size-7 items-center justify-center rounded-md border border-border/70 bg-secondary/60 text-foreground">
                        <Coins className="size-3.5" />
                    </div>
                    <h1 className="text-base font-bold tracking-tight text-foreground">
                        Token Saver Engine
                    </h1>
                </div>

                <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">
                    Autonomous proxy layer for multi-stage token reduction. Minifies heavy terminal
                    tool outputs (<code>git/grep/ls/logs</code>), injects lean YAGNI stdlib
                    principles, and eliminates repetitive LLM pleasantries.
                </p>
            </div>
        </header>
    );
}
