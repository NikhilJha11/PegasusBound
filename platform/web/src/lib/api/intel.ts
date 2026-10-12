// Pegasusbound Intelligence: typed client for /v1/intel/* (proxied by the
// backend to the intelligence sidecar) and the react-query hooks the
// Intelligence pages use.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Call } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types (mirror the sidecar's JSON)
// ---------------------------------------------------------------------------

export type CampaignStatus = "draft" | "planning" | "awaiting_approval" | "running" | "paused" | "completed" | "stopped" | "failed";
export type DecisionAction = "scale" | "continue" | "revise" | "stop" | "pause_health";
export type TraitDimension = "tone" | "format" | "angle" | "cta" | "personalization" | "subjectStyle" | "length";
export type Traits = Partial<Record<TraitDimension, string>>;

export interface Brief {
    campaignType: string;
    objective: string;
    icp: string;
    persona: string;
    offer: string;
    style: string;
    context: string;
    senderName: string;
    senderCompany: string;
    senderAddress?: string;
}

export interface Limits {
    maxTotalProspects: number;
    batchStages: number[];
    dailySendCap: number;
    observationHours: number;
    followUpDelaysDays: number[];
    requireApprovalForNewCopy: boolean;
    timezone?: string;
    sendStart?: string;
    sendEnd?: string;
    sendDays?: number;
}

export interface IntelCampaign {
    id: string;
    name: string;
    status: CampaignStatus;
    statusDetail: string | null;
    brief: Brief;
    limits: Limits;
    senderProvider: string;
    knowledge: {
        productSummary: string;
        proofPoints: { claim: string; sourceRef: string }[];
        gaps: string[];
        sources: { ref: string; title: string; tool: string }[];
        voiceGuidelines?: string[];
        painPoints?: string[];
        approvedClaims?: string[];
        prohibitedClaims?: string[];
        personaInsights?: string[];
        styleExamples?: { subject: string; body: string; sourceRef: string }[];
        documentContext?: { icp: string[]; personas: string[]; valueProps: string[]; objections: string[]; competitors: string[]; documents: string[] };
    } | null;
    plan: { summary: string; learningAgenda: { variable: string; why: string }[]; risks: string[] } | null;
    stageIndex: number;
    approvedAt: string | null;
    createdAt: string;
}

export interface LearningRecord {
    id: string;
    campaignId: string;
    experimentId: string;
    observation: string;
    scope: string;
    evidence: { experimentSeq?: number; variableTested?: string; stats?: VariantStats[] };
    confidence: "preliminary" | "moderate" | "strong";
    limitations: string;
    nextAction: string;
    brainWriteStatus: "pending" | "written" | "unsupported" | "failed";
    createdAt: string;
}

export interface DashboardRow {
    campaign: IntelCampaign;
    sent: number;
    delivered: number;
    positive: number;
    meetings: number;
    experimentsDone: number;
    latestLearning: LearningRecord | null;
    needsReview: number;
}

export interface VariantStats {
    variantId: string;
    key: string;
    sent: number;
    delivered: number;
    positive: number;
    meetings: number;
    bounced: number;
    posteriorMean: number;
    ci90: [number, number];
    pBest: number;
}

export interface Experiment {
    id: string;
    seq: number;
    hypothesis: string;
    variableTested: string;
    status: "pending_approval" | "sending" | "observing" | "evaluated" | "cancelled";
    batchSize: number;
    observeUntil: string | null;
    evaluation: {
        stats: VariantStats[];
        decision: { action: DecisionAction; winnerVariantId: string | null; rationale: string[]; nextBatchSize: number };
        narrative?: string;
    } | null;
}

export interface Variant {
    id: string;
    campaignId: string;
    label: string;
    angle: string;
    cta: string;
    subject: string;
    body: string;
    followUps: { delayDays: number; body: string }[];
    traits: Traits;
    rationale: string;
    status: "draft" | "active" | "retired" | "champion";
}

export interface Counts {
    sent: number;
    delivered: number;
    bounced: number;
    replies: number;
    positive: number;
    negative: number;
    unsubscribed: number;
    meetings: number;
    pendingReview: number;
}

export interface ReplyRow {
    id: string;
    body: string;
    received_at: string;
    email: string;
    first_name: string | null;
    company: string | null;
    label: string;
    category: string | null;
    confidence: number | null;
    needs_review: boolean | null;
}

export interface CampaignDetail {
    campaign: IntelCampaign;
    experiments: Experiment[];
    arms: { id: string; experimentId: string; variantId: string; role: "champion" | "challenger" | "explore" }[];
    variants: Variant[];
    counts: Record<string, Counts>;
    learnings: LearningRecord[];
    audit: { id: string; actor: string; action: string; createdAt: string }[];
    enrollment: { status: "eligible" | "assigned" | "excluded"; n: number }[];
    replies: ReplyRow[];
}

export const LEAD_FILTERS = ["all", "replied", "positive", "review", "meetings", "in_sequence", "bounced", "unsubscribed", "not_contacted"] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];

export interface LeadRow {
    assignment_id: string | null;
    exclusion_reason: string | null;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    title: string | null;
    label: string | null;
    steps_sent: number;
    last_activity: string | null;
    state: string;
    category: string | null;
    meeting_status: string | null;
}

export interface ThreadItem {
    kind: "out" | "in" | "event";
    at: string;
    step?: number;
    from?: string;
    to?: string;
    subject?: string;
    body?: string;
    category?: string | null;
    confidence?: number | null;
    needsReview?: boolean | null;
    replyId?: string;
    event?: string;
}

export interface Thread {
    assignment: { id: string; status: string; sequenceStoppedReason: string | null };
    prospect: { email: string; firstName: string | null; lastName: string | null; company: string | null; title: string | null };
    variant: Variant;
    items: ThreadItem[];
    meeting: { status: "requested" | "booked" | "held" | "no_show"; qualified: boolean | null; source: string } | null;
    pendingSteps: number;
}

export interface TraitRow {
    value: string;
    variants: number;
    delivered: number;
    positive: number;
    rate: number;
    ci90: [number, number];
    pBest: number;
}

export interface MemoryEntry {
    id: string;
    kind: "principle" | "guideline" | "avoid";
    source: "experiment" | "brain" | "document" | "human";
    text: string;
    scope: string;
    confidence: "preliminary" | "moderate" | "strong";
    active: boolean;
    updatedAt: string;
}

export interface ConnectionSummary {
    id: string;
    name: string;
    url: string;
    status: "pending" | "connected" | "needs_auth" | "error";
    statusDetail: string | null;
    authType: "none" | "bearer" | "oauth";
    capabilities: Record<string, string | null> | null;
    tools: { name: string; readOnly: boolean }[] | null;
}

export type DocumentKind = "icp" | "product" | "case_study" | "email_samples" | "brand" | "competitors" | "other";

export interface VoiceProfile {
    tone: string;
    avgWords: number;
    greeting: string | null;
    signoff: string | null;
    usesQuestionsInCta: boolean;
    usesFirstName: boolean;
    rules: string[];
}

export interface DocumentAnalysis {
    summary: string;
    icp: string[];
    personas: string[];
    painPoints: string[];
    valueProps: string[];
    proofPoints: { claim: string; sourceRef: string }[];
    approvedClaims: string[];
    prohibitedClaims: string[];
    objections: string[];
    competitors: string[];
    voice: VoiceProfile | null;
    examples: { subject: string; body: string; sourceRef: string }[];
}

export interface KnowledgeDocument {
    id: string;
    kind: DocumentKind;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number | null;
    status: "processing" | "ready" | "failed";
    statusDetail: string | null;
    analysis: DocumentAnalysis | null;
    createdAt: string;
}

export type ContextProfile = Omit<DocumentAnalysis, "summary"> & { summary: string; documents: { id: string; filename: string; kind: DocumentKind }[] };

export const REPLY_CATEGORIES = [
    "positive_interest",
    "meeting_requested",
    "referral",
    "not_now",
    "objection_pricing",
    "objection_relevance",
    "objection_timing",
    "objection_existing_solution",
    "negative",
    "unsubscribe",
    "auto_reply",
] as const;
export const POSITIVE = new Set(["positive_interest", "meeting_requested", "referral"]);

// ---------------------------------------------------------------------------
// Fetchers and hooks
// ---------------------------------------------------------------------------

const intel = <T,>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: object) =>
    Call(`/intel${path}`, method, body) as Promise<T>;

const KEY = ["intel"] as const;

export function useIntelSetup() {
    return useQuery({
        queryKey: [...KEY, "setup"],
        queryFn: () => intel<{ provisioned: boolean; brain: ConnectionSummary | null; crm: ConnectionSummary | null; documents: number; llm: string }>("/setup"),
    });
}

export function useProvisionIntel() {
    const qc = useQueryClient();
    return useMutation({ mutationFn: () => intel("/setup", "POST"), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export function useSaveConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: { kind: "brain" | "crm"; url: string; authType: "none" | "bearer" | "oauth"; token?: string; name?: string }) =>
            intel<{ status: string; authUrl?: string; error?: string; missing?: string[] }>("/connections", "POST", body),
        onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    });
}

export function useCheckConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => intel<{ status: string; authUrl?: string; error?: string }>(`/connections/${id}/check`, "POST"),
        onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    });
}

export function useRemoveConnection() {
    const qc = useQueryClient();
    return useMutation({ mutationFn: (id: string) => intel(`/connections/${id}`, "DELETE"), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export function useCrmLists(enabled: boolean) {
    return useQuery({
        queryKey: [...KEY, "crm-lists"],
        queryFn: () => intel<{ lists: { id: string; name: string }[]; error?: string }>("/crm/lists"),
        enabled,
    });
}

const ACTIVE: CampaignStatus[] = ["planning", "running"];

export function useIntelCampaigns() {
    return useQuery({
        queryKey: [...KEY, "campaigns"],
        queryFn: () => intel<{ campaigns: DashboardRow[] }>("/campaigns"),
        refetchInterval: (q) => (q.state.data?.campaigns.some((r) => ACTIVE.includes(r.campaign.status)) ? 8000 : false),
    });
}

export function useCreateIntelCampaign() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: {
            name?: string;
            brief: Brief;
            audience: { source: "csv"; csv: string } | { source: "crm"; listId: string };
            limits: Partial<Omit<Limits, "batchStages">>;
        }) => intel<{ id: string; enrolled: { enrolled: number; excluded: number } }>("/campaigns", "POST", body),
        onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "campaigns"] }),
    });
}

export function useIntelCampaign(id: string) {
    return useQuery({
        queryKey: [...KEY, "campaign", id],
        queryFn: () => intel<CampaignDetail>(`/campaigns/${id}`),
        refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.campaign.status) ? 6000 : false),
    });
}

function useCampaignAction<TArg>(fn: (arg: TArg) => Promise<unknown>) {
    const qc = useQueryClient();
    return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useApproveIntelCampaign = () => useCampaignAction((id: string) => intel(`/campaigns/${id}/approve`, "POST"));
export const usePauseIntelCampaign = () => useCampaignAction((id: string) => intel(`/campaigns/${id}/pause`, "POST"));
export const useResumeIntelCampaign = () => useCampaignAction((id: string) => intel(`/campaigns/${id}/resume`, "POST"));
export const useApproveExperiment = () => useCampaignAction((id: string) => intel(`/experiments/${id}/approve`, "POST"));
export const useEditVariant = () =>
    useCampaignAction((a: { id: string; subject: string; body: string; followUps: { delayDays: number; body: string }[] }) =>
        intel<{ problems: string[] }>(`/variants/${a.id}`, "PATCH", { subject: a.subject, body: a.body, followUps: a.followUps }),
    );
export const useReviewReply = () =>
    useCampaignAction((a: { replyId: string; category: string }) => intel(`/replies/${a.replyId}/review`, "POST", { category: a.category }));
export const useUpdateMeeting = () =>
    useCampaignAction((a: { assignmentId: string; status?: string; qualified?: boolean | null }) =>
        intel(`/leads/${a.assignmentId}/meeting`, "POST", { status: a.status, qualified: a.qualified }),
    );

export function useIntelLeads(id: string, filter: LeadFilter, q: string) {
    const qs = new URLSearchParams({ filter, q }).toString();
    return useQuery({
        queryKey: [...KEY, "leads", id, filter, q],
        queryFn: () => intel<{ rows: LeadRow[]; counts: Record<string, number>; truncated: boolean }>(`/campaigns/${id}/leads?${qs}`),
        refetchInterval: 15000,
    });
}

export function useIntelThread(assignmentId: string | null) {
    return useQuery({
        queryKey: [...KEY, "thread", assignmentId],
        queryFn: () => intel<Thread>(`/leads/${assignmentId}/thread`),
        enabled: Boolean(assignmentId),
        refetchInterval: 15000,
    });
}

export function useIntelFormats(id: string) {
    return useQuery({
        queryKey: [...KEY, "formats", id],
        queryFn: () => intel<{ dimensions: Record<TraitDimension, string>; campaign: Record<TraitDimension, TraitRow[]>; all: Record<TraitDimension, TraitRow[]> }>(`/campaigns/${id}/formats`),
    });
}

export function useIntelMemory(persona: string) {
    return useQuery({
        queryKey: [...KEY, "memory", persona],
        queryFn: () =>
            intel<{ entries: MemoryEntry[]; leaderboard: Record<TraitDimension, TraitRow[]>; dimensions: Record<TraitDimension, string>; preview: string | null }>(
                `/memory${persona ? `?persona=${encodeURIComponent(persona)}` : ""}`,
            ),
    });
}

export const useAddMemory = () =>
    useCampaignAction((a: { kind: MemoryEntry["kind"]; text: string; scope?: string }) => intel("/memory", "POST", a));
export const useToggleMemory = () => useCampaignAction((a: { id: string; active: boolean }) => intel(`/memory/${a.id}`, "PATCH", { active: a.active }));

export function useIntelDocuments() {
    return useQuery({
        queryKey: [...KEY, "documents"],
        queryFn: () =>
            intel<{ documents: KnowledgeDocument[]; context: ContextProfile | null; kinds: Record<DocumentKind, string>; maxBytes: number }>("/documents"),
    });
}

export function useUploadDocument() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: { kind: DocumentKind; filename: string; mimeType?: string; data?: string; text?: string }) =>
            intel<{ document: KnowledgeDocument }>("/documents", "POST", body),
        onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
    });
}

export function useDeleteDocument() {
    const qc = useQueryClient();
    return useMutation({ mutationFn: (id: string) => intel(`/documents/${id}`, "DELETE"), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export function useIntelLearnings() {
    return useQuery({
        queryKey: [...KEY, "learnings"],
        queryFn: () => intel<{ learnings: { l: LearningRecord; campaignName: string }[] }>("/learnings"),
    });
}

export const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
export const humanize = (s: string) => s.replaceAll("_", " ");

export interface RankedEmail {
    rank: number;
    variantId: string;
    label: string;
    status: string;
    subject: string;
    body: string;
    traits: Traits;
    introducedIn: number | null;
    experiments: number[];
    sent: number;
    delivered: number;
    replies: number;
    positive: number;
    meetings: number;
    unsubscribed: number;
    rate: number;
    posteriorMean: number;
    ci90: [number, number];
    pBest: number;
    liftVsBaseline: number | null;
    why: string;
}

export interface IterationPoint {
    seq: number;
    variableTested: string;
    status: string;
    decision: DecisionAction | null;
    delivered: number;
    positive: number;
    rate: number;
    bestRate: number;
    bestLabel: string | null;
    startedAt: string | null;
}

export function useIntelRanking(id: string) {
    return useQuery({
        queryKey: [...KEY, "ranking", id],
        queryFn: () =>
            intel<{ campaign: { id: string; name: string; status: CampaignStatus; persona: string }; ranked: RankedEmail[]; curve: IterationPoint[]; baselineRate: number | null }>(
                `/campaigns/${id}/ranking`,
            ),
    });
}
