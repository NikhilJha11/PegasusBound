// /admin/campaigns/* — platform-wide campaign admin.

import { Request } from "@/lib/api/client";
import { buildSearchQuery } from "@/lib/api/client/admin/query";
import type {
    AdminCampaignDetail,
    AdminCampaignSearch,
    AdminCampaignsResult,
} from "@/lib/api/models/admin";

function toQuery(params: AdminCampaignSearch): string {
    return buildSearchQuery(params as Record<string, unknown>);
}

export function searchCampaigns(
    params: AdminCampaignSearch = {},
): Promise<AdminCampaignsResult> {
    return Request({
        method: "GET",
        url: `/admin/campaigns${toQuery(params)}`,
        authorization: true,
    });
}

export function getCampaign(id: string): Promise<AdminCampaignDetail> {
    return Request({
        method: "GET",
        url: `/admin/campaigns/${id}`,
        authorization: true,
    });
}

export function stopCampaign(id: string, reason: string): Promise<void> {
    return Request({
        method: "POST",
        url: `/admin/campaigns/${id}/stop`,
        authorization: true,
        data: { reason },
    });
}
