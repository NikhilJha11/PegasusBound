// Task-type helpers. Types are user-managed (see TaskTypePicker), so this no
// longer holds a fixed list — just the colour palette used by the create/edit
// form and a resolver from a task's type name to its colour.

export const TASK_TYPE_COLORS = [
    "#8b5cf6",
    "#8b5cf6",
    "#f59e0b",
    "#10b981",
    "#f43f5e",
    "#6366f1",
    "#14b8a6",
    "#94a3b8",
];

export function taskTypeColor(
    name: string | undefined,
    types: { name: string; color: string }[],
): string {
    if (!name) return "#94a3b8";
    const key = name.trim().toLowerCase();
    const found = types.find((t) => t.name.trim().toLowerCase() === key)?.color;
    if (found) return found;
    // No matching type (renamed/removed, or a case/whitespace mismatch between the
    // task's stored type string and the type list): hash the name into the palette
    // so it still gets a stable, DISTINCT colour instead of one grey for everything.
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return TASK_TYPE_COLORS[h % TASK_TYPE_COLORS.length];
}
