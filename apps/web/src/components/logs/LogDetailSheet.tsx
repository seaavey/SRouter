import { ScrollText } from "lucide-react";
import type { RequestLogEntry } from "@/lib/types";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";

interface LogDetailSheetProps {
    log: RequestLogEntry | null;
    onClose: () => void;
}

export function LogDetailSheet({ log, onClose }: LogDetailSheetProps) {
    const isOk = (log?.statusCode ?? 0) >= 200 && (log?.statusCode ?? 0) < 300;

    return (
        <Sheet open={!!log} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="sm:max-w-md w-full p-6 space-y-6 overflow-y-auto">
                {log && (
                    <>
                        <SheetHeader className="p-0 border-b border-border/50 pb-4">
                            <SheetTitle className="text-base font-bold text-foreground flex items-center gap-2">
                                <ScrollText className="size-4 text-indigo-500" />
                                Request Log Detail
                            </SheetTitle>
                            <SheetDescription className="font-mono text-xs text-muted-foreground truncate">
                                ID: {log.id}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="space-y-4 text-xs">
                            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-secondary/20 p-3">
                                <div>
                                    <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                                        Status
                                    </span>
                                    <span
                                        className={`font-mono font-bold ${isOk ? "text-emerald-500" : "text-rose-500"}`}
                                    >
                                        {log.statusCode} OK
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                                        Latency
                                    </span>
                                    <span className="font-mono font-bold text-foreground">
                                        {log.latencyMs} ms
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                                        Provider
                                    </span>
                                    <span className="font-mono text-foreground">
                                        {log.providerId}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                                        Model
                                    </span>
                                    <span className="font-mono text-foreground">{log.model}</span>
                                </div>
                            </div>

                            <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                                <span className="font-semibold text-foreground block">
                                    Token Usage Breakdown
                                </span>
                                <div className="flex justify-between border-b border-border/40 pb-1">
                                    <span className="text-muted-foreground">
                                        Prompt (Input) Tokens:
                                    </span>
                                    <span className="font-mono text-foreground font-medium">
                                        {log.promptTokens}
                                    </span>
                                </div>
                                <div className="flex justify-between border-b border-border/40 pb-1">
                                    <span className="text-muted-foreground">
                                        Completion (Output) Tokens:
                                    </span>
                                    <span className="font-mono text-foreground font-medium">
                                        {log.completionTokens}
                                    </span>
                                </div>
                                <div className="flex justify-between font-semibold pt-1">
                                    <span className="text-foreground">Total Tokens:</span>
                                    <span className="font-mono text-indigo-500">
                                        {log.totalTokens}
                                    </span>
                                </div>
                            </div>

                            <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                                <span className="font-semibold text-foreground block">
                                    Payload JSON Preview
                                </span>
                                <pre className="p-3 rounded-md bg-secondary/40 font-mono text-[11px] text-foreground overflow-x-auto">
                                    <code>{JSON.stringify(log, null, 2)}</code>
                                </pre>
                            </div>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
