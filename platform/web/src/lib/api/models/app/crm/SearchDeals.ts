// Filter body for POST /crm/deals/search and /crm/deals/summary. Every field
// is optional; an empty body matches every deal in the org (the cross-pipeline
// "All deals" default). The same body drives the rows and the summary totals,
// so a header number always reflects the exact filter shown below it.

export type DealSortBy =
    | "created_at"
    | "updated_at"
    | "value"
    | "expected_close_date"
    | "name";

export default interface SearchDeals {
    query: string;
    statuses: ("open" | "won" | "lost")[];
    pipeline_ids: string[];
    stage_ids: string[];
    assigned_to: string[];
    campaign_ids: string[];
    min_value?: number;
    max_value?: number;
    close_after?: string;
    close_before?: string;
    created_after?: string;
    created_before?: string;
    sort_by: DealSortBy;
    reverse: boolean;
}

export const EMPTY_DEAL_SEARCH: SearchDeals = {
    query: "",
    statuses: [],
    pipeline_ids: [],
    stage_ids: [],
    assigned_to: [],
    campaign_ids: [],
    sort_by: "created_at",
    reverse: false,
};
