// Shared value + helpers for the explorer timeline / date-range facets.
//
// A DateRange carries a preset selection plus an optional custom from→to.
// Presets ("1"/"7"/"30"/"90") mean "in the last N days" and map to the
// server's `<col>_within` integer param; "custom" reveals two <input type=date>
// fields that map to `<col>_after` / `<col>_before` (YYYY-MM-DD, parsed by gin
// via a time_format tag). Secondary timestamp facets use mode="custom" so only
// the from/to range applies (a "within" preset is meaningless for, say, a
// trial-end date).

export interface DateRange {
    preset: string; // "" (any) | "1" | "7" | "30" | "90" | "custom"
    after: string; // YYYY-MM-DD
    before: string; // YYYY-MM-DD
}

export const emptyRange: DateRange = { preset: "", after: "", before: "" };

/** True when the facet contributes a filter (counts toward activeCount). */
export function rangeActive(r: DateRange): boolean {
    if (!r.preset) return false;
    if (r.preset === "custom") return !!r.after || !!r.before;
    return true;
}

/** Days for a preset selection, or undefined when not a day-preset. */
export function rangeWithin(r: DateRange): number | undefined {
    if (!r.preset || r.preset === "custom") return undefined;
    return Number(r.preset);
}

/** Custom-range lower bound (YYYY-MM-DD), or undefined. */
export function rangeAfter(r: DateRange): string | undefined {
    return r.preset === "custom" && r.after ? r.after : undefined;
}

/** Custom-range upper bound (YYYY-MM-DD), or undefined. */
export function rangeBefore(r: DateRange): string | undefined {
    return r.preset === "custom" && r.before ? r.before : undefined;
}
