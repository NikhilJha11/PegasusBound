import type Campaign from "@/lib/api/models/app/campaigns/Campaign";
import Request from "../../Request";

// Creates a draft copy of the campaign's configuration. Without a name the
// backend derives "<source name> (copy)".
export default async function duplicateCampaign(id: string, name?: string): Promise<Campaign> {
    return await Request<Campaign>({
        method: "POST",
        url: `/campaigns/${id}/duplicate`,
        data: name ? { name } : {},
        authorization: true,
    });
}
