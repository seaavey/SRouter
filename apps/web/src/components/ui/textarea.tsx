import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
    return (
        <textarea
            data-slot="textarea"
            className={cn(
                "w-full min-w-0 bg-field text-ink placeholder:text-text-faint border-0 rounded-2xl px-4 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-0 focus-visible:outline-none shadow-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 resize-y",
                className
            )}
            {...props}
        />
    );
}

export { Textarea };
