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
            className="rounded-lg border border-border/80 bg-card p-4 sm:p-5 shadow-2xs transition-all scroll-mt-20 font-mono"
        >
            <div className="flex items-start justify-between gap-4 border-b border-border/80 pb-3.5 mb-2">
                <div className="flex items-start gap-3">
                    {Icon && (
                        <div className="flex size-7.5 shrink-0 items-center justify-center rounded border border-border/80 bg-secondary/60 text-foreground shadow-2xs mt-0.5">
                            <Icon className="size-3.5" />
                        </div>
                    )}
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-sm font-bold tracking-tight text-foreground">
                                {title}
                            </h2>
                            {tag && (
                                <span className="rounded border border-border/70 bg-secondary/50 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                    {tag}
                                </span>
                            )}
                        </div>
                        {description && (
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground max-w-2xl">
                                {description}
                            </p>
                        )}
                    </div>
                </div>
                {badge && <div className="shrink-0">{badge}</div>}
            </div>
            <div className="divide-y divide-border/50">{children}</div>
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
                "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between font-mono",
                className ?? ""
            ].join(" ")}
        >
            <div className="min-w-0 pr-4">
                <div className="text-xs font-semibold text-foreground leading-tight">{title}</div>
                {description && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            {control && <div className="shrink-0">{control}</div>}
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
                "inline-flex items-center gap-1 rounded border border-border/80 bg-card p-0.5 shadow-2xs font-mono",
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
                            "rounded px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer",
                            isActive
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                            disabled ? "opacity-50 cursor-not-allowed" : ""
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
        <span className="inline-flex items-center rounded border border-border/80 bg-secondary/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground tabular-nums">
            {children}
        </span>
    );
}
