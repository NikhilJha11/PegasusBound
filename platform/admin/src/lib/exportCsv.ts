// Tiny client-side CSV export for the current page of a data browser.
// Quotes fields, escapes embedded quotes, and triggers a download.

function cell(v: string | number | null | undefined): string {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
    const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
