import type { MeetingsPage, MeetingsSearch } from "@/lib/api/models/app/integrations/Integration";
import Request from "../../Request";

// Meetings page list. Offset pagination under the hood (so nullable scheduled_for
// sorts don't drop rows), but the page param is the same opaque next_cursor every
// other list uses.
export default async function searchMeetings(
    filters: MeetingsSearch,
    cursor?: string | null,
    limit = 50,
): Promise<MeetingsPage> {
    const qs = new URLSearchParams();
    if (filters.timeframe) qs.set("timeframe", filters.timeframe);
    if (filters.status) qs.set("status", filters.status);
    if (filters.q) qs.set("q", filters.q);
    if (cursor) qs.set("cursor", cursor);
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";

    return await Request<MeetingsPage>({
        method: "GET",
        url: `/meetings${suffix}`,
        authorization: true,
    });
}
