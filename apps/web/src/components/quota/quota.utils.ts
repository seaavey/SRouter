export function formatResetTime(iso_str?: string): string {
    if (!iso_str) return "";
    try {
        const d = new Date(iso_str);
        if (isNaN(d.getTime())) return iso_str;
        const time_str = d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        const date_str = d.toLocaleDateString([], {
            month: "short",
            day: "numeric"
        });
        return `${time_str} (${date_str})`;
    } catch {
        return iso_str;
    }
}

export function formatLastUsed(date_str?: string | null): string {
    if (!date_str) return "—";
    try {
        const d = new Date(date_str);
        if (isNaN(d.getTime())) return date_str;
        return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${d.toLocaleDateString([], { month: "short", day: "numeric" })})`;
    } catch {
        return date_str;
    }
}
