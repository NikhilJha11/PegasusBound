import { useQuery } from "@tanstack/react-query";
import listContactCampaignStates from "@/lib/api/client/app/contacts/listContactCampaignStates";

// Per-campaign state for the contact drawer. Keyed under ["contacts", id] so
// the audit spine's contact invalidation (and the send/open/reply events'
// per-contact invalidation) refresh it live; no polling.
export default function useContactCampaignStates(contactId: string, enabled = true) {
    return useQuery({
        queryKey: ["contacts", contactId, "campaign-state"],
        queryFn: () => listContactCampaignStates(contactId),
        enabled: enabled && !!contactId,
        staleTime: 15_000,
    });
}
