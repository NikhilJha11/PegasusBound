// Server-aggregated totals over a SearchDeals filter. Every number here is a
// SUM/COUNT over the whole matching set — never a client reduce over a loaded
// page — so the header stats and per-stage board headers stop lying at scale.

export interface DealStageSummary {
    stage_id: string;
    count: number;
    value: number;
}

export default interface DealsSummary {
    total: number;
    open_count: number;
    open_value: number;
    won_count: number;
    won_value: number;
    lost_count: number;
    lost_value: number;
    currency: string;
    // True when the matched set spans more than one currency, in which case a
    // single blended value total is not meaningful and the UI should say so.
    mixed_currency: boolean;
    stages: DealStageSummary[];
}
