// Shared querystring builder for the admin search clients. Uniform rules so
// every explorer serializes filters the same way:
//   - undefined / null        -> omitted
//   - boolean                 -> "true" only when true (false is omitted)
//   - number                  -> serialized, including 0 (so a max=0 filter works)
//   - string                  -> omitted when empty, else verbatim
// Date facets pass YYYY-MM-DD strings; the backend parses them via gin's
// time_format tag.

export function buildSearchQuery(params: Record<string, unknown>): string {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (typeof value === "boolean") {
            if (value) usp.set(key, "true");
        } else if (typeof value === "number") {
            if (Number.isFinite(value)) usp.set(key, String(value));
        } else if (typeof value === "string") {
            if (value !== "") usp.set(key, value);
        } else {
            usp.set(key, String(value));
        }
    }
    const s = usp.toString();
    return s ? `?${s}` : "";
}
