// /admin/outreach — platform mailer composer + audit log.

import { Request } from "@/lib/api/client";
import { buildSearchQuery } from "@/lib/api/client/admin/query";
import type {
    AdminOutreachMessage,
    AdminOutreachResult,
    AdminOutreachSearch,
    SendAdminOutreachRequest,
} from "@/lib/api/models/admin";

export function sendOutreach(
    body: SendAdminOutreachRequest,
): Promise<AdminOutreachMessage> {
    return Request({
        method: "POST",
        url: "/admin/outreach",
        authorization: true,
        data: body,
    });
}

function toQuery(params: AdminOutreachSearch): string {
    return buildSearchQuery(params as Record<string, unknown>);
}

export function listOutreach(
    params: AdminOutreachSearch = {},
): Promise<AdminOutreachResult> {
    return Request({
        method: "GET",
        url: `/admin/outreach${toQuery(params)}`,
        authorization: true,
    });
}
