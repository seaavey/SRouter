"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange"
> {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
}

export function Switch({ checked, onCheckedChange, disabled, className, ...props }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onCheckedChange?.(!checked)}
            className={cn(
                "group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 shadow-none",
                checked ? "bg-ink border-ink" : "bg-canvas-soft border-hairline hover:bg-field",
                className
            )}
            {...props}
        >
            <span
                className={cn(
                    "pointer-events-none block size-3.5 rounded-full transition-transform shadow-none",
                    checked ? "translate-x-4 bg-canvas" : "translate-x-0.5 bg-text-muted"
                )}
            />
        </button>
    );
}
