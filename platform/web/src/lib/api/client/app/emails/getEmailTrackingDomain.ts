import type TrackingDomain from "@/lib/api/models/app/emails/TrackingDomain";
import Request from "../../Request";

// Stored tracking-domain state plus the CNAME target this install expects.
// Read-only: it does no DNS work, so it is safe on drawer mount.
export default async function getEmailTrackingDomain(id: string): Promise<TrackingDomain> {
    return await Request<TrackingDomain>({
        method: "GET",
        url: `/emails/${id}/track`,
        authorization: true,
    });
}
