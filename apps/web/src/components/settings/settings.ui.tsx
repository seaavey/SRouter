import React from "react";

interface SettingsSectionProps {
    id?: string;
    icon?: React.ComponentType<{ className?: string }>;
    tag?: string;
    title: string;
    description?: string;
    badge?: React.ReactNode;
    children: React.ReactNode;
}

export function SettingsSection({
    id,
    icon: Icon,
    tag,
    title,
    description,
    badge,
    children
}: SettingsSectionProps) {
    return (
        <section
            id={id}
            className="rounded-2xl sm:rounded-3xl border border-hairline-soft bg-canvas p-4 sm:p-6 md:p-8 shadow-none transition-colors scroll-mt-20 lg:scroll-mt-6 font-sans hover:border-hairline"
        >
            <div className="flex items-start justify-between gap-3 sm:gap-4 border-b border-hairline-soft pb-4 sm:pb-5 mb-2">
                <div className="flex items-start gap-3 sm:gap-3.5 min-w-0">
                    {Icon && (
                        <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-full border border-hairline-soft bg-canvas-soft text-ink mt-0.5">
                            <Icon className="size-3.5 sm:size-4" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-base sm:text-lg font-semibold tracking-tight text-ink font-sans">
                                {title}
                            </h2>
                            {tag && (
                                <span className="rounded-full border border-hairline-soft bg-canvas-soft px-2.5 py-0.5 font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                    {tag}
                                </span>
                            )}
                        </div>
                        {description && (
                            <p className="mt-1 text-xs leading-relaxed text-text-muted font-light max-w-2xl font-sans">
                                {description}
                            </p>
                        )}
                    </div>
                </div>
                {badge && <div className="shrink-0">{badge}</div>}
            </div>
            <div className="divide-y divide-hairline-soft">{children}</div>
        </section>
    );
}

export function SettingsRow({
    title,
    description,
    control,
    className
}: {
    title: string;
    description?: string;
    control?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "flex items-start justify-between gap-3 py-3.5 sm:py-4 font-sans sm:items-center",
                className ?? ""
            ].join(" ")}
        >
            <div className="min-w-0 flex-1 pr-2">
                <div className="text-sm font-medium text-ink leading-snug">{title}</div>
                {description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-text-muted font-light">
                        {description}
                    </p>
                )}
            </div>
            {control && <div className="shrink-0 self-center sm:self-auto">{control}</div>}
        </div>
    );
}

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
            className={[
                "inline-flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-full border border-hairline-soft bg-canvas-soft p-1 shadow-none font-sans",
                className ?? ""
            ].join(" ")}
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
                        className={[
                            "shrink-0 rounded-full px-3.5 py-1 text-xs font-sans transition-colors cursor-pointer",
                            isActive
                                ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                                : "text-text-muted hover:text-ink",
                            disabled ? "opacity-40 cursor-not-allowed" : ""
                        ].join(" ")}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export function ValueBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1 font-mono text-xs font-semibold text-ink tabular-nums">
            {children}
        </span>
    );
}
