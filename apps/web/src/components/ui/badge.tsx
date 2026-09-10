import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center gap-1 shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2 shadow-none",
    {
        variants: {
            variant: {
                default:
                    "bg-canvas-soft text-ink rounded-full px-3 py-1 text-xs font-semibold border-0 shadow-none",
                secondary:
                    "bg-canvas-soft text-ink rounded-full px-3 py-1 text-xs font-medium border-0 shadow-none",
                outline:
                    "bg-transparent border border-hairline text-ink rounded-full px-3 py-1 text-xs font-medium shadow-none",
                accent: "bg-accent text-white rounded-full px-3 py-1 text-xs font-semibold shadow-none",
                destructive:
                    "bg-red-500/10 text-red-600 dark:text-red-400 rounded-full px-3 py-1 text-xs font-semibold shadow-none",
                emerald:
                    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full px-3 py-1 text-xs font-semibold border-0 shadow-none",
                sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-full px-3 py-1 text-xs font-semibold border-0 shadow-none",
                indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full px-3 py-1 text-xs font-semibold border-0 shadow-none",
                amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full px-3 py-1 text-xs font-semibold border-0 shadow-none"
            }
        },
        defaultVariants: {
            variant: "default"
        }
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
    );
}

export { Badge, badgeVariants };
