import type TrackingDomain from "@/lib/api/models/app/emails/TrackingDomain";
import Request from "../../Request";

// The campaign-scoped override reports the same shape as the mailbox one.
export type TrackingDomainStatus = TrackingDomain;

// POST /campaigns/:id/tracking-domain/verify — resolves the record against
// this install's tracking host and flips verified on success. Side-effectful
// but naturally idempotent (re-resolving the same domain is safe) and covered
// by the global Idempotency-Key middleware.
export default async function verifyCampaignTrackingDomain(campaignId: string): Promise<TrackingDomainStatus> {
    return await Request<TrackingDomainStatus>({
        method: "POST",
        url: `/campaigns/${campaignId}/tracking-domain/verify`,
        authorization: true,
    });
}
