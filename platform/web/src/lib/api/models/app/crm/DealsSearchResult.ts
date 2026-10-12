import type Deal from "@/lib/api/models/app/crm/Deal";

export interface DealsSearchPagination {
    total: number;
    // Opaque cursor for the next page (offset-encoded under the hood), or null on
    // the last page. Same shape as every other list.
    next_cursor?: string | null;
    has_more: boolean;
}

export default interface DealsSearchResult {
    data: Deal[];
    pagination: DealsSearchPagination;
}
