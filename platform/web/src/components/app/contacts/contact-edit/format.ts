// Tiny date helpers used across the contact slide-over tabs.
// Centralized so the format stays consistent — every "last opened
// 5 minutes ago" row, every timeline timestamp, every meta row.

export function fmtAbsolute(d: Date | string | null | undefined): string {
    if (!d) return "—";
    try {
        const dt = typeof d === "string" ? new Date(d) : d;
        return dt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "—";
    }
}

export function fmtRelative(d: Date | string | null | undefined): string {
    if (!d) return "never";
    try {
        const dt = typeof d === "string" ? new Date(d) : d;
        const diff = Date.now() - dt.getTime();
        const sec = Math.round(diff / 1000);
        if (sec < 60) return "just now";
        const min = Math.round(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.round(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const day = Math.round(hr / 24);
        if (day < 30) return `${day}d ago`;
        const mo = Math.round(day / 30);
        if (mo < 12) return `${mo}mo ago`;
        const yr = Math.round(mo / 12);
        return `${yr}y ago`;
    } catch {
        return "never";
    }
}
