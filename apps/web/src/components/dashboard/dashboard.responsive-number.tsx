import { formatCompactNumber, formatNumber } from "@/lib/utils";

type ResponsiveNumberProps = {
    value: number;
    className?: string;
    title?: string;
};

export function ResponsiveNumber({ value, className, title }: ResponsiveNumberProps) {
    const fullValue = formatNumber(value);
    const compactValue = formatCompactNumber(value);

    return (
        <span
            className={`responsive-number block min-w-0 flex-1 overflow-hidden whitespace-nowrap ${className ?? ""}`}
            title={title ?? fullValue}
            aria-label={fullValue}
        >
            <span className="responsive-number-full">{fullValue}</span>
            <span className="responsive-number-compact">{compactValue}</span>
        </span>
    );
}
