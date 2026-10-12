import type SearchDeals from "@/lib/api/models/app/crm/SearchDeals";
import type DealsSummary from "@/lib/api/models/app/crm/DealsSummary";
import Request from "../../../Request";

export default async function dealsSummary(filters: SearchDeals): Promise<DealsSummary> {
    return await Request<DealsSummary>({
        method: "POST",
        url: "/crm/deals/summary",
        data: filters,
        authorization: true,
    });
}
