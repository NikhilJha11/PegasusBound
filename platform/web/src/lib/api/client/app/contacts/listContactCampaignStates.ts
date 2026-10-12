import type { ContactCampaignStatesResult } from "@/lib/api/models/app/contacts/ContactCampaignState";
import Request from "../../Request";

export default async function listContactCampaignStates(
    contactId: string,
): Promise<ContactCampaignStatesResult> {
    return await Request<ContactCampaignStatesResult>({
        method: "GET",
        url: `/contacts/${contactId}/campaigns`,
        authorization: true,
    });
}
