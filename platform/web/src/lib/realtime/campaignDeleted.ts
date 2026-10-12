// Bridges a realtime CAMPAIGN_DELETED frame to whichever detail page has the
// campaign open. useRealtimeEvents has no router access, so it announces on
// window and the campaign layout listens and navigates away.

export const CAMPAIGN_DELETED_EVENT = "pegasusbound:campaign-deleted";

export interface CampaignDeletedDetail {
    id: string;
    name: string;
}

export function announceCampaignDeleted(detail: CampaignDeletedDetail) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<CampaignDeletedDetail>(CAMPAIGN_DELETED_EVENT, { detail }));
}
