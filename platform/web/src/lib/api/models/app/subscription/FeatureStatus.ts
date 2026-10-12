// Shape of GET /subscription/features. The backend returns explicit
// capability booleans (not a generic map) alongside the subscription status.
export default interface FeatureStatus {
    subscription?: unknown;
    can_send_campaigns: boolean;
    can_use_warmup: boolean;
    can_use_unibox: boolean;
}
