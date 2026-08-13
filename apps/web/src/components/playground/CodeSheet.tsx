import { Check, Code2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface CodeSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    generatedCurl: string;
    canCopy: boolean;
    copied: boolean;
    onCopy: () => void;
}

export function CodeSheet({
    open,
    onOpenChange,
    generatedCurl,
    canCopy,
    copied,
    onCopy,
}: CodeSheetProps) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full space-y-6 overflow-y-auto p-4 sm:max-w-lg sm:p-6"
            >
                <SheetHeader className="flex-row items-center justify-between border-b border-border/60 p-0 pb-4">
                    <SheetTitle className="flex items-center gap-2 text-base">
                        <Code2 /> Export request
                    </SheetTitle>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCopy}
                        disabled={!canCopy}
                        aria-label={copied ? "Request code copied" : "Copy request code"}
                    >
                        {copied ? <Check /> : <Copy />}
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </SheetHeader>
                <div>
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        cURL
                    </p>
                    <pre className="max-h-[70vh] overflow-auto border border-border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                        <code>{generatedCurl}</code>
                    </pre>
                </div>
            </SheetContent>
        </Sheet>
    );
}
