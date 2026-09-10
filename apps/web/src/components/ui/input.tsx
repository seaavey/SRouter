import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            className={cn(
                "w-full min-w-0 bg-field text-ink placeholder:text-text-faint border-0 rounded-2xl px-4 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-0 focus-visible:outline-none shadow-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                className
            )}
            {...props}
        />
    );
}

export { Input };
