import type TrackingDomain from "@/lib/api/models/app/emails/TrackingDomain";
import Request from "../../Request";

// Sets or clears the mailbox's custom tracking domain and resolves it once.
// The domain travels as a query parameter, so it has to be encoded: an
// unencoded value silently truncated at the first & or #.
export default async function updateEmailTrackingDomain(id: string, domain: string): Promise<TrackingDomain> {
    return await Request<TrackingDomain>({
        method: "PATCH",
        url: `/emails/${id}/track?domain=${encodeURIComponent(domain)}`,
        authorization: true,
    })
}
