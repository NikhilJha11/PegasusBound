import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import toast from "react-hot-toast/headless";
import { SearchIcon } from "lucide-react";
import { Btn, Empty, Pill, errorText } from "@/components/app/intelligence/parts";
import {
    LEAD_FILTERS,
    POSITIVE,
    REPLY_CATEGORIES,
    humanize,
    useIntelLeads,
    useIntelThread,
    useReviewReply,
    useUpdateMeeting,
    type LeadFilter,
    type Thread,
} from "@/lib/api/intel";
import { cn } from "@/lib/utils";

const FILTER_LABEL: Record<LeadFilter, string> = {
    all: "All",
    replied: "Replied",
    positive: "Positive",
    review: "Needs review",
    meetings: "Meetings",
    in_sequence: "In sequence",
    bounced: "Bounced",
    unsubscribed: "Unsubscribed",
    not_contacted: "Not contacted",
};

const STATE_TONE: Record<string, "green" | "sky" | "amber" | "red" | "neutral" | "violet"> = {
    positive: "green",
    replied: "sky",
    review: "amber",
    in_sequence: "violet",
    finished: "neutral",
    queued: "neutral",
    bounced: "red",
    unsubscribed: "red",
    failed: "red",
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

export default function IntelLeadsPage() {
    const { id } = useParams({ from: "/app/intelligence/$id/leads" });
    const [filter, setFilter] = useState<LeadFilter>("all");
    const [search, setSearch] = useState("");
    const [q, setQ] = useState("");
    useEffect(() => {
        const t = setTimeout(() => setQ(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);
    const leads = useIntelLeads(id, filter, q);
    const rows = leads.data?.rows ?? [];
    const [selected, setSelected] = useState<string | null>(null);
    const current = selected ?? rows.find((r) => r.assignment_id)?.assignment_id ?? null;
    const thread = useIntelThread(current);

    return (
        <div className="flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-1.5">
                {LEAD_FILTERS.map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => {
                            setFilter(f);
                            setSelected(null);
                        }}
                        className={cn(
                            "h-6 px-2.5 rounded-full border text-[11.5px] transition-colors",
                            filter === f ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600 hover:border-slate-300",
                        )}
                    >
                        {FILTER_LABEL[f]} <span className="tabular-nums">{leads.data?.counts[f] ?? 0}</span>
                    </button>
                ))}
                <div className="relative w-full sm:w-64 sm:ml-auto">
                    <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, email, company"
                        className="w-full h-7 rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                    />
                </div>
            </div>

            <div className="grid lg:grid-cols-[21rem_1fr] min-h-[32rem]">
                <ul className="divide-y divide-slate-100 border-b lg:border-b-0 lg:border-r border-slate-200 max-h-[40vh] lg:max-h-[calc(100vh-14rem)] overflow-y-auto">
                    {leads.isLoading && <li className="p-6 text-[12.5px] text-slate-500">Loading…</li>}
                    {!leads.isLoading && rows.length === 0 && <li className="p-6 text-center text-[12.5px] text-slate-500">No leads match.</li>}
                    {rows.map((r) => {
                        const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email;
                        const isSel = r.assignment_id !== null && r.assignment_id === current;
                        return (
                            <li key={r.email}>
                                <button
                                    type="button"
                                    disabled={!r.assignment_id}
                                    onClick={() => setSelected(r.assignment_id)}
                                    className={cn("w-full text-left px-4 py-2.5 transition-colors disabled:cursor-default", isSel ? "bg-sky-50" : r.assignment_id ? "hover:bg-slate-50" : "")}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-[12.5px] font-medium text-slate-900">{name}</span>
                                        <span className="shrink-0 text-[10.5px] text-slate-400">{r.last_activity ? new Date(r.last_activity).toLocaleDateString() : ""}</span>
                                    </div>
                                    <div className="truncate text-[11.5px] text-slate-500">
                                        {r.company ?? r.email}
                                        {r.title ? ` · ${r.title}` : ""}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1">
                                        <Pill tone={STATE_TONE[r.state] ?? "neutral"}>{humanize(r.state)}</Pill>
                                        {r.label && <Pill>{r.label}</Pill>}
                                        {r.steps_sent > 0 && <span className="text-[10.5px] text-slate-400">{r.steps_sent} sent</span>}
                                        {r.meeting_status && <Pill tone="green">meeting {humanize(r.meeting_status)}</Pill>}
                                    </div>
                                    {r.exclusion_reason && <div className="mt-1 text-[10.5px] text-slate-400">{r.exclusion_reason}</div>}
                                </button>
                            </li>
                        );
                    })}
                    {leads.data?.truncated && <li className="p-3 text-center text-[11px] text-slate-400">Showing the first 500. Search to narrow down.</li>}
                </ul>
                <section className="min-w-0">
                    {!current ? (
                        <div className="p-6">
                            <Empty>Select a contacted lead to see the whole conversation.</Empty>
                        </div>
                    ) : thread.data ? (
                        <ThreadView t={thread.data} assignmentId={current} />
                    ) : (
                        <div className="p-6 text-[12.5px] text-slate-500">Loading conversation…</div>
                    )}
                </section>
            </div>
        </div>
    );
}

function ThreadView({ t, assignmentId }: { t: Thread; assignmentId: string }) {
    const review = useReviewReply();
    const meeting = useUpdateMeeting();
    const p = t.prospect;
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;
    return (
        <div className="flex flex-col h-full">
            <header className="px-5 py-3 border-b border-slate-200">
                <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-[14px] font-semibold text-slate-900">{name}</h2>
                    <span className="text-[12px] text-slate-500 break-all">{p.email}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
                    {p.company && <span>{p.company}</span>}
                    {p.title && <span>· {p.title}</span>}
                    <Pill>
                        {t.variant.label} · {t.variant.angle}
                    </Pill>
                    {t.assignment.sequenceStoppedReason ? (
                        <Pill>sequence stopped: {humanize(t.assignment.sequenceStoppedReason)}</Pill>
                    ) : t.pendingSteps > 0 && t.assignment.status === "sent" ? (
                        <Pill tone="violet">{t.pendingSteps} follow-up(s) scheduled</Pill>
                    ) : null}
                </div>
            </header>

            <div className="flex-1 overflow-y-auto bg-slate-50/70 p-4 space-y-3">
                {t.items.length === 0 && <Empty>Queued: nothing sent yet.</Empty>}
                {t.items.map((it, i) =>
                    it.kind === "event" ? (
                        <div key={i} className="text-center text-[11px] text-slate-400">
                            {humanize(it.event ?? "")} · {when(it.at)}
                        </div>
                    ) : (
                        <article
                            key={i}
                            className={cn(
                                "max-w-[44rem] rounded-lg border p-3.5",
                                it.kind === "out" ? "ml-auto border-slate-200 bg-white" : "mr-auto border-sky-200 bg-sky-50",
                            )}
                        >
                            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                <span className="font-medium text-slate-800">{it.kind === "out" ? `You → ${it.to}` : `${it.from} → you`}</span>
                                {it.kind === "out" && <Pill>step {it.step}</Pill>}
                                {it.kind === "in" && it.category && (
                                    <Pill tone={POSITIVE.has(it.category) ? "green" : it.needsReview ? "amber" : "neutral"}>
                                        {humanize(it.category)}
                                        {it.confidence != null ? ` · ${Math.round(it.confidence * 100)}%` : ""}
                                    </Pill>
                                )}
                                <span className="ml-auto">{when(it.at)}</span>
                            </div>
                            {it.subject && <div className="mb-1 text-[12.5px] font-medium text-slate-900">{it.subject}</div>}
                            <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] text-slate-700">{it.body}</pre>
                            {it.kind === "in" && it.replyId && (
                                <ReviewControl
                                    initial={it.category ?? "negative"}
                                    unsure={Boolean(it.needsReview)}
                                    busy={review.isPending}
                                    onSave={(category) =>
                                        review.mutate(
                                            { replyId: it.replyId!, category },
                                            { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(errorText(e)) },
                                        )
                                    }
                                />
                            )}
                        </article>
                    ),
                )}
            </div>

            <footer className="px-5 py-2.5 border-t border-slate-200 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-medium text-slate-700">Meeting</span>
                <select
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
                    value={t.meeting?.status ?? ""}
                    onChange={(e) =>
                        e.target.value &&
                        meeting.mutate({ assignmentId, status: e.target.value }, { onError: (err) => toast.error(errorText(err)) })
                    }
                >
                    <option value="">none</option>
                    <option value="requested">requested</option>
                    <option value="booked">booked</option>
                    <option value="held">held</option>
                    <option value="no_show">no-show</option>
                </select>
                <span className="font-medium text-slate-700">Qualified</span>
                <select
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
                    value={t.meeting?.qualified == null ? "" : t.meeting.qualified ? "yes" : "no"}
                    onChange={(e) =>
                        meeting.mutate(
                            { assignmentId, qualified: e.target.value === "" ? null : e.target.value === "yes" },
                            { onError: (err) => toast.error(errorText(err)) },
                        )
                    }
                >
                    <option value="">unknown</option>
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                </select>
                {t.meeting && <span className="text-slate-400">from {t.meeting.source}</span>}
            </footer>
        </div>
    );
}

function ReviewControl({ initial, unsure, busy, onSave }: { initial: string; unsure: boolean; busy: boolean; onSave: (c: string) => void }) {
    const [value, setValue] = useState(initial);
    return (
        <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">{unsure ? "Classifier unsure, confirm:" : "Reclassify:"}</span>
            <select className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11.5px]" value={value} onChange={(e) => setValue(e.target.value)}>
                {REPLY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                        {humanize(c)}
                    </option>
                ))}
            </select>
            <Btn disabled={busy} onClick={() => onSave(value)} className="h-7">
                Save
            </Btn>
        </div>
    );
}
