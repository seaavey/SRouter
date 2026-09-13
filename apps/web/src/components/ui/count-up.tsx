import { animate } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type CountUpProps = {
    to: number;
    from?: number;
    direction?: "up" | "down";
    delay?: number;
    duration?: number;
    className?: string;
    start_when?: boolean;
    separator?: string;
    format?: (value: number) => string;
    title?: string;
    on_start?: () => void;
    on_end?: () => void;
};

function GetDecimalPlaces(value: number): number {
    const decimals = value.toString().split(".")[1];
    return decimals && Number.parseInt(decimals, 10) !== 0 ? decimals.length : 0;
}

export function CountUp({
    to,
    from = 0,
    direction = "up",
    delay = 0,
    duration = 0.55,
    className,
    start_when = true,
    separator = ",",
    format,
    title,
    on_start,
    on_end
}: CountUpProps) {
    const ref = useRef<HTMLSpanElement>(null);
    const previous_value = useRef<number | undefined>(undefined);
    const animation = useRef<{ stop: () => void } | null>(null);
    const decimal_places = Math.max(GetDecimalPlaces(from), GetDecimalPlaces(to));

    const format_value = useCallback(
        (value: number) => {
            if (format) return format(value);
            return new Intl.NumberFormat("en-US", {
                useGrouping: Boolean(separator),
                minimumFractionDigits: decimal_places,
                maximumFractionDigits: decimal_places
            })
                .format(value)
                .replace(/,/g, separator);
        },
        [decimal_places, format, separator]
    );

    useEffect(() => {
        if (!ref.current) return;

        const next_value = direction === "down" ? from : to;
        const previous = previous_value.current;
        previous_value.current = next_value;

        if (previous === undefined) {
            ref.current.textContent = format_value(next_value);
            return;
        }

        if (previous === next_value || !start_when) {
            ref.current.textContent = format_value(next_value);
            return;
        }

        animation.current?.stop();
        let start_timer: number | undefined;
        const run_animation = () => {
            on_start?.();
            animation.current = animate(previous, next_value, {
                duration,
                ease: [0.22, 1, 0.36, 1],
                onUpdate: (value) => {
                    if (ref.current) ref.current.textContent = format_value(value);
                },
                onComplete: () => {
                    animation.current = null;
                    on_end?.();
                }
            });
        };

        if (delay > 0) {
            start_timer = window.setTimeout(run_animation, delay * 1000);
        } else {
            run_animation();
        }

        return () => {
            if (start_timer !== undefined) window.clearTimeout(start_timer);
            animation.current?.stop();
        };
    }, [delay, direction, duration, format_value, from, on_end, on_start, start_when, to]);

    useEffect(() => () => animation.current?.stop(), []);

    return (
        <span
            ref={ref}
            className={cn("tabular-nums", className)}
            title={title}
            aria-live="polite"
        />
    );
}
