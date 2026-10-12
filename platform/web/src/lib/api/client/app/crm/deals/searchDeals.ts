import type SearchDeals from "@/lib/api/models/app/crm/SearchDeals";
import type DealsSearchResult from "@/lib/api/models/app/crm/DealsSearchResult";
import Request from "../../../Request";

export default async function searchDeals(
    filters: SearchDeals,
    cursor?: string | null,
    limit = 50,
): Promise<DealsSearchResult> {
    const qs = new URLSearchParams();
    if (cursor) qs.set("cursor", cursor);
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";

    return await Request<DealsSearchResult>({
        method: "POST",
        url: `/crm/deals/search${suffix}`,
        data: filters,
        authorization: true,
    });
}
