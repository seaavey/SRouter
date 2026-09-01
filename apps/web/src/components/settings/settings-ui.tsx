import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card wrapper for a settings section with a title + description header. */
export function SettingsSection({
    title,
    description,
    icon,
    className,
    children
}: {
    title: string;
    description?: string;
    icon?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section
            className={cn(
                "rounded-2xl border border-border/70 bg-card p-5 shadow-2xs transition-colors",
                className
            )}
        >
            <div className="mb-5 flex items-start gap-3">
                {icon && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-foreground">
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <h2 className="text-sm font-bold tracking-tight text-foreground">{title}</h2>
                    {description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>
            </div>
            <div className="space-y-5">{children}</div>
        </section>
    );
}

/** A label + optional description + control row. */
export function SettingsRow({
    title,
    description,
    control,
    className
}: {
    title: string;
    description?: string;
    control?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                className
            )}
        >
            <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-semibold text-foreground">{title}</div>
                {description && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            {control && <div className="shrink-0">{control}</div>}
        </div>
    );
}

/** Pill-style segmented control for mutually exclusive options. */
export function SegmentedControl<T extends string | number | boolean>({
    options,
    value,
    onChange,
    disabled,
    className
}: {
    options: Array<{ value: T; label: string }>;
    value: T;
    onChange: (value: T) => void;
    disabled?: boolean;
    className?: string;
}) {
    return (
        <div
            role="tablist"
            className={cn(
                "inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-1",
                className
            )}
        >
            {options.map((option) => {
                const isActive = option.value === value;
                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        disabled={disabled}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50",
                            isActive
                                ? "bg-foreground text-background shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Value badge shown next to a numeric/derived setting. */
export function ValueBadge({ children }: { children: ReactNode }) {
    return (
        <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-foreground">
            {children}
        </span>
    );
}

export type { ComponentProps };
