export function SettingsSection({
    index,
    title,
    description,
    children
}: {
    index?: string;
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="py-8 first:pt-2 last:pb-2">
            <div className="mb-5">
                <div className="flex items-baseline gap-3">
                    {index && (
                        <span className="font-mono text-[10px] text-muted-foreground/50">
                            {index}
                        </span>
                    )}
                    <h2 className="text-sm font-bold tracking-tight text-foreground">{title}</h2>
                </div>
                {description && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            <div className="divide-y divide-border/60">{children}</div>
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
                "flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between",
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
                "inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/30 p-0.5",
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
                            "rounded px-2.5 py-1 text-[11px] font-medium transition-all",
                            "disabled:pointer-events-none disabled:opacity-50",
                            isActive
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground"
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
        <span className="inline-flex items-center rounded-md border border-border/70 bg-background px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-foreground">
            {children}
        </span>
    );
}
