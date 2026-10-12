// /admin/limit-requests — review queue for customer-submitted limit
// increase requests.

import { Request } from "@/lib/api/client";
import { buildSearchQuery } from "@/lib/api/client/admin/query";
import type {
    AdminLimitRequestSearch,
    AdminLimitRequestsResult,
    LimitIncreaseRequest,
} from "@/lib/api/models/admin";

function toQuery(params: AdminLimitRequestSearch): string {
    return buildSearchQuery(params as Record<string, unknown>);
}

export function listLimitRequests(
    params: AdminLimitRequestSearch = {},
): Promise<AdminLimitRequestsResult> {
    return Request({
        method: "GET",
        url: `/admin/limit-requests${toQuery(params)}`,
        authorization: true,
    });
}

export function approveLimitRequest(
    id: string,
    notes: string,
): Promise<LimitIncreaseRequest> {
    return Request({
        method: "POST",
        url: `/admin/limit-requests/${id}/approve`,
        authorization: true,
        data: { notes },
    });
}

export function rejectLimitRequest(
    id: string,
    notes: string,
): Promise<LimitIncreaseRequest> {
    return Request({
        method: "POST",
        url: `/admin/limit-requests/${id}/reject`,
        authorization: true,
        data: { notes },
    });
}
