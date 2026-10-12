// /admin/mailboxes — cross-org mailbox triage.

import { Request } from "@/lib/api/client";
import { buildSearchQuery } from "@/lib/api/client/admin/query";
import type {
    AdminMailboxSearch,
    AdminMailboxesResult,
} from "@/lib/api/models/admin";

export function searchMailboxes(
    params: AdminMailboxSearch = {},
): Promise<AdminMailboxesResult> {
    return Request({
        method: "GET",
        url: `/admin/mailboxes${buildSearchQuery(params as Record<string, unknown>)}`,
        authorization: true,
    });
}
