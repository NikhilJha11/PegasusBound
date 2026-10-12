import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import toast from "react-hot-toast/headless";
import { Stat, StatStrip } from "@/components/layout/Page";
import { Btn, ConfidencePill, DecisionPill, Empty, Pill, ProbBar, Section, StatusPill, errorText, inputCls, textareaCls } from "@/components/app/intelligence/parts";
import {
    humanize,
    pct,
    useApproveExperiment,
    useApproveIntelCampaign,
    useEditVariant,
    useIntelCampaign,
    type Variant,
} from "@/lib/api/intel";

export default function IntelCampaignOverview() {
    const { id } = useParams({ from: "/app/intelligence/$id" });
    const q = useIntelCampaign(id);
    const approve = useApproveIntelCampaign();
    const approveExp = useApproveExperiment();
    if (!q.data) return <div className="p-5 text-[13px] text-slate-500">Loading…</div>;
    const { campaign: c, experiments, arms, variants, counts, learnings, enrollment } = q.data;
    const byId = new Map(variants.map((v) => [v.id, v]));
    const totals = Object.values(counts).reduce(
        (a, x) => ({ sent: a.sent + x.sent, delivered: a.delivered + x.delivered, positive: a.positive + x.positive, meetings: a.meetings + x.meetings, bounced: a.bounced + x.bounced }),
        { sent: 0, delivered: 0, positive: 0, meetings: 0, bounced: 0 },
    );
    const n = (s: string) => Number(enrollment.find((e) => e.status === s)?.n ?? 0);
    const pending = experiments.find((e) => e.status === "pending_approval");
    const champion = variants.find((v) => v.status === "champion");

    return (
        <>
            <StatStrip cols={5}>
                <Stat label="Contacted" value={totals.sent} sub={`${n("eligible")} still eligible`} />
                <Stat label="Delivered" value={totals.delivered} sub={`${pct(totals.bounced, totals.sent)} bounced`} />
                <Stat label="Positive replies" value={totals.positive} sub={pct(totals.positive, totals.delivered)} />
                <Stat label="Meetings" value={totals.meetings} sub="requested or booked" />
                <Stat label="Champion" value={champion?.label ?? "—"} sub={champion?.angle ?? "no winner yet"} last />
            </StatStrip>

            {c.status === "planning" && (
                <Section title="Planning" hint="Researching your Company Brain and designing the first experiment. This usually takes a minute.">
                    <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full w-1/3 bg-violet-500 animate-pulse" />
                    </div>
                </Section>
            )}

            {pending && (c.status === "awaiting_approval" || c.status === "running") && (
                <Section
                    title={c.status === "awaiting_approval" ? "Review & launch" : `Experiment #${pending.seq} needs your approval`}
                    hint={`${n("eligible")} eligible prospects${n("excluded") ? `, ${n("excluded")} excluded (suppressed or recently contacted)` : ""}. First batch ${pending.batchSize}, at most ${c.limits.maxTotalProspects} total, ${c.limits.dailySendCap}/day.`}
                    action={
                        <Btn
                            variant="primary"
                            disabled={approve.isPending || approveExp.isPending}
                            onClick={() =>
                                (c.status === "awaiting_approval" ? approve : approveExp).mutate(c.status === "awaiting_approval" ? c.id : pending.id, {
                                    onSuccess: () => toast.success("Approved. The engine takes it from here."),
                                    onError: (e) => toast.error(errorText(e)),
                                })
                            }
                        >
                            {c.status === "awaiting_approval" ? "Approve & launch" : "Approve experiment"}
                        </Btn>
                    }
                    className="bg-amber-50/40"
                >
                    {c.plan && c.status === "awaiting_approval" && (
                        <div className="mb-4 space-y-3 text-[13px] text-slate-700">
                            <p>{c.plan.summary}</p>
                            <div>
                                <div className="text-[12px] font-medium text-slate-900 mb-1">Learning agenda</div>
                                <ol className="list-decimal pl-5 space-y-0.5 text-slate-600">
                                    {c.plan.learningAgenda.map((a) => (
                                        <li key={a.variable}>
                                            <span className="text-slate-900">{a.variable}</span>: {a.why}
                                        </li>
                                    ))}
                                </ol>
                            </div>
                            {c.plan.risks.length > 0 && (
                                <ul className="list-disc pl-5 text-[12.5px] text-amber-800">
                                    {c.plan.risks.map((r) => (
                                        <li key={r}>{r}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                    <p className="mb-3 text-[12.5px] text-slate-700">
                        <span className="font-medium">Hypothesis:</span> {pending.hypothesis} <Pill tone="sky">tests {pending.variableTested}</Pill>
                    </p>
                    <div className="grid gap-3 lg:grid-cols-2">
                        {arms
                            .filter((a) => a.experimentId === pending.id)
                            .map((a) => byId.get(a.variantId))
                            .filter(Boolean)
                            .map((v) => (
                                <VariantCard key={v!.id} v={v!} />
                            ))}
                    </div>
                </Section>
            )}

            <Section title="Experiments" hint="Each batch tests one change. Results are pooled per frozen email version.">
                {experiments.length === 0 ? (
                    <Empty>No experiments yet.</Empty>
                ) : (
                    <div className="space-y-4">
                        {experiments.map((e) => {
                            const stats = new Map((e.evaluation?.stats ?? []).map((s) => [s.variantId, s]));
                            return (
                                <div key={e.id} className="rounded-lg border border-slate-200">
                                    <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2">
                                        <span className="text-[12.5px] font-semibold text-slate-900">#{e.seq}</span>
                                        <span className="text-[12.5px] text-slate-700">Testing {e.variableTested}</span>
                                        <StatusPill status={e.status} />
                                        {e.evaluation && <DecisionPill action={e.evaluation.decision.action} />}
                                        <span className="ml-auto text-[11px] text-slate-500">batch {e.batchSize}</span>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <p className="text-[12.5px] text-slate-600">{e.hypothesis}</p>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-[12.5px]">
                                                <thead className="text-left text-[11px] text-slate-500">
                                                    <tr>
                                                        <th className="py-1 pr-3 font-medium">Variant</th>
                                                        <th className="py-1 pr-3 font-medium text-right">Delivered</th>
                                                        <th className="py-1 pr-3 font-medium text-right">Positive</th>
                                                        <th className="py-1 pr-3 font-medium">Rate (90% range)</th>
                                                        <th className="py-1 font-medium">Chance it's best</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {arms
                                                        .filter((a) => a.experimentId === e.id)
                                                        .map((a) => {
                                                            const v = byId.get(a.variantId);
                                                            const st = stats.get(a.variantId);
                                                            const live = counts[a.variantId];
                                                            if (!v) return null;
                                                            return (
                                                                <tr key={a.id} className="border-t border-slate-100">
                                                                    <td className="py-2 pr-3">
                                                                        <div className="flex items-center gap-1.5 font-medium text-slate-900">
                                                                            {v.label} <Pill>{a.role}</Pill>
                                                                        </div>
                                                                        <div className="text-[11.5px] text-slate-500">
                                                                            {v.angle} · {v.cta}
                                                                        </div>
                                                                    </td>
                                                                    <td className="py-2 pr-3 text-right tabular-nums">{st?.delivered ?? live?.delivered ?? 0}</td>
                                                                    <td className="py-2 pr-3 text-right tabular-nums">{st?.positive ?? live?.positive ?? 0}</td>
                                                                    <td className="py-2 pr-3 tabular-nums text-slate-700">
                                                                        {st ? `${(st.posteriorMean * 100).toFixed(1)}% (${(st.ci90[0] * 100).toFixed(1)}–${(st.ci90[1] * 100).toFixed(1)})` : "—"}
                                                                    </td>
                                                                    <td className="py-2">{st ? <ProbBar value={st.pBest} tone={st.pBest >= 0.9 ? "green" : "sky"} /> : <span className="text-[11px] text-slate-400">pending</span>}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                </tbody>
                                            </table>
                                        </div>
                                        {e.evaluation && (
                                            <div className="rounded-md bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
                                                <ul className="list-disc pl-5 space-y-0.5">
                                                    {e.evaluation.decision.rationale.map((r) => (
                                                        <li key={r}>{r}</li>
                                                    ))}
                                                </ul>
                                                {e.evaluation.narrative && <p className="mt-1.5 text-slate-500">{e.evaluation.narrative}</p>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

            <Section title="What it learned" hint="Saved to your workspace memory and applied to every future campaign.">
                {learnings.length === 0 ? (
                    <Empty>Learnings appear after each batch is evaluated.</Empty>
                ) : (
                    <ul className="space-y-2">
                        {learnings.map((l) => (
                            <li key={l.id} className="rounded-lg border border-slate-200 px-3 py-2.5 text-[12.5px] text-slate-700">
                                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                    <ConfidencePill confidence={l.confidence} />
                                    <Pill tone={l.brainWriteStatus === "written" ? "green" : "neutral"}>Company Brain: {humanize(l.brainWriteStatus)}</Pill>
                                    <span className="text-[11px] text-slate-500">{l.scope}</span>
                                </div>
                                <p className="text-slate-900">{l.observation}</p>
                                <p className="mt-1 text-slate-500">Limits: {l.limitations}</p>
                                <p className="mt-0.5">Next: {l.nextAction}</p>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            {c.knowledge && (
                <Section
                    title="Knowledge used"
                    hint={
                        c.knowledge.documentContext
                            ? `What the engine read before writing: ${c.knowledge.documentContext.documents.join(", ")}${c.knowledge.sources.some((s) => s.tool !== "document") ? " and your Company Brain" : ""}.`
                            : "What the engine read from your Company Brain before writing."
                    }
                    action={
                        c.knowledge.documentContext && (
                            <a href="/app/intelligence/knowledge" className="text-[12px] font-medium text-sky-700 hover:text-sky-900">
                                Knowledge →
                            </a>
                        )
                    }
                >
                    <div className="space-y-2 text-[12.5px] text-slate-700">
                        <p>{c.knowledge.productSummary}</p>
                        {(c.knowledge.painPoints?.length || c.knowledge.voiceGuidelines?.length) && (
                            <div className="grid md:grid-cols-2 gap-3">
                                {!!c.knowledge.painPoints?.length && (
                                    <div>
                                        <div className="text-[11.5px] font-medium text-slate-500">Pain points targeted</div>
                                        <ul className="list-disc pl-5 text-slate-600">
                                            {c.knowledge.painPoints.slice(0, 5).map((p) => (
                                                <li key={p}>{p}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {!!c.knowledge.voiceGuidelines?.length && (
                                    <div>
                                        <div className="text-[11.5px] font-medium text-slate-500">Voice rules applied</div>
                                        <ul className="list-disc pl-5 text-slate-600">
                                            {c.knowledge.voiceGuidelines.slice(0, 5).map((p) => (
                                                <li key={p}>{p}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                        {!!c.knowledge.styleExamples?.length && (
                            <p className="text-[11.5px] text-slate-500">{c.knowledge.styleExamples.length} reference emails used to match your voice.</p>
                        )}
                        {c.knowledge.gaps.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">Gaps: {c.knowledge.gaps.join(" · ")}</p>}
                        {c.knowledge.proofPoints.length > 0 && (
                            <ul className="list-disc pl-5 text-slate-600">
                                {c.knowledge.proofPoints.map((p) => (
                                    <li key={p.claim}>
                                        {p.claim} <span className="font-mono text-[11px] text-slate-400">[{p.sourceRef}]</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="text-[11.5px] text-slate-500">{c.knowledge.sources.length} sources consulted</p>
                    </div>
                </Section>
            )}
        </>
    );
}

function VariantCard({ v }: { v: Variant }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState({ subject: v.subject, body: v.body, followUps: v.followUps });
    const edit = useEditVariant();
    const warned = v.rationale.includes("⚠");
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-900">{v.label}</span>
                <span className="text-[12px] text-slate-500 truncate">{v.angle}</span>
                {v.status === "draft" && !editing && (
                    <button type="button" onClick={() => setEditing(true)} className="ml-auto text-[12px] font-medium text-sky-700 hover:text-sky-900">
                        Edit
                    </button>
                )}
            </div>
            {editing ? (
                <div className="space-y-2">
                    <input className={inputCls} value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} aria-label="Subject" />
                    <textarea className={textareaCls} rows={7} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} aria-label="Body" />
                    {draft.followUps.map((f, i) => (
                        <div key={i} className="flex gap-2">
                            <input
                                className={inputCls + " !w-16"}
                                type="number"
                                min={1}
                                max={14}
                                value={f.delayDays}
                                aria-label={`Follow-up ${i + 1} delay in days`}
                                onChange={(e) => setDraft((d) => ({ ...d, followUps: d.followUps.map((x, j) => (j === i ? { ...x, delayDays: Number(e.target.value) } : x)) }))}
                            />
                            <textarea
                                className={textareaCls}
                                rows={3}
                                value={f.body}
                                aria-label={`Follow-up ${i + 1}`}
                                onChange={(e) => setDraft((d) => ({ ...d, followUps: d.followUps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) }))}
                            />
                        </div>
                    ))}
                    <p className="text-[11.5px] text-slate-500">Merge fields: {"{{first_name}} {{company}}"}. Unsubscribe handling is added automatically.</p>
                    <div className="flex gap-2">
                        <Btn
                            variant="primary"
                            disabled={edit.isPending}
                            onClick={() =>
                                edit.mutate(
                                    { id: v.id, ...draft, followUps: draft.followUps.filter((f) => f.body.trim()) },
                                    {
                                        onSuccess: (r) => {
                                            setEditing(false);
                                            const problems = (r as { problems?: string[] }).problems ?? [];
                                            if (problems.length) toast.error(`Saved with warnings: ${problems.join("; ")}`);
                                            else toast.success("Copy saved");
                                        },
                                        onError: (e) => toast.error(errorText(e)),
                                    },
                                )
                            }
                        >
                            Save
                        </Btn>
                        <Btn onClick={() => setEditing(false)}>Cancel</Btn>
                    </div>
                </div>
            ) : (
                <>
                    <div className="text-[12.5px] font-medium text-slate-900">Subject: {v.subject}</div>
                    <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[12.5px] text-slate-600">{v.body}</pre>
                    {v.followUps.map((f, i) => (
                        <div key={i} className="mt-3 border-l-2 border-slate-200 pl-3">
                            <div className="text-[11.5px] font-medium text-slate-700">
                                Follow-up {i + 1} · after {f.delayDays} day{f.delayDays > 1 ? "s" : ""} without a reply
                            </div>
                            <pre className="mt-1 whitespace-pre-wrap font-sans text-[12.5px] text-slate-600">{f.body}</pre>
                        </div>
                    ))}
                    <div className="mt-3 flex flex-wrap gap-1">
                        {Object.entries(v.traits).map(([k, val]) => (
                            <Pill key={k}>
                                {humanize(k)}: {humanize(String(val))}
                            </Pill>
                        ))}
                    </div>
                    <p className={`mt-2 whitespace-pre-wrap text-[11.5px] ${warned ? "text-amber-700" : "text-slate-500"}`}>{v.rationale}</p>
                </>
            )}
        </div>
    );
}
