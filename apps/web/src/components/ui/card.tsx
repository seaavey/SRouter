import * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="card"
            className={cn(
                "flex flex-col rounded-3xl border border-hairline-soft bg-canvas text-card-foreground shadow-none transition-all",
                className
            )}
            {...props}
        />
    );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="card-header"
            className={cn("flex flex-col gap-1.5 p-6", className)}
            {...props}
        />
    );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="card-title"
            className={cn(
                "font-heading text-base font-semibold tracking-tight text-ink",
                className
            )}
            {...props}
        />
    );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="card-description"
            className={cn("text-xs text-text-muted", className)}
            {...props}
        />
    );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="card-content"
            className={cn("flex-1 p-6 [&:not(:first-child)]:pt-0", className)}
            {...props}
        />
    );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="card-footer"
            className={cn(
                "flex items-center p-6 border-t border-hairline-soft [&:not(:first-child)]:pt-4",
                className
            )}
            {...props}
        />
    );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
