import type WarmupAnalytics from "@/lib/api/models/app/analytics/WarmupAnalytics";
import Request from "../../Request";

// Pass emailId to scope to a single mailbox (GET /analytics/warmup?email_id=).
// from/to are YYYY-MM-DD; omit for the backend default window.
export default async function getWarmup(emailId?: string, from?: string, to?: string): Promise<WarmupAnalytics> {
    const params = new URLSearchParams();
    if (emailId) params.set("email_id", emailId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return await Request<WarmupAnalytics>({
        method: "GET",
        url: `/analytics/warmup${qs ? `?${qs}` : ""}`,
        authorization: true,
    })
}
