import type TrackingDomain from "@/lib/api/models/app/emails/TrackingDomain";
import Request from "../../Request";

// Re-resolves the saved tracking domain and RECORDS the verdict. Separate from
// getEmailTrackingDomain because recording it is what routes real links through
// the custom host, and it is the way out of "pending" once DNS propagates.
export default async function verifyEmailTrackingDomain(id: string): Promise<TrackingDomain> {
    return await Request<TrackingDomain>({
        method: "POST",
        url: `/emails/${id}/track/verify`,
        authorization: true,
    });
}
