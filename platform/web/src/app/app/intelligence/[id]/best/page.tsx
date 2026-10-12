import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { CrownIcon, TrendingUpIcon } from "lucide-react";
import { DecisionPill, Empty, Pill, ProbBar, Section, StatusPill } from "@/components/app/intelligence/parts";
import { cn } from "@/lib/utils";
import { humanize, useIntelRanking, type IterationPoint, type RankedEmail } from "@/lib/api/intel";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function IntelBestEmailsPage() {
    const { id } = useParams({ from: "/app/intelligence/$id/best" });
    const q = useIntelRanking(id);
    if (q.isLoading) return <div className="p-6 text-[13px] text-slate-500">Loading…</div>;
    const data = q.data;
    if (!data || !data.ranked.length) return <div className="p-6"><Empty>No emails yet.</Empty></div>;
    const sent = data.ranked.filter((r) => r.delivered > 0);
    const top = sent[0];
    return (
        <>
            <Learning curve={data.curve} top={top} baseline={data.baselineRate} />
            <Section
                title="Best emails, ranked"
                hint="Every email this campaign has sent, best to worst by posterior positive-reply rate. P(best) is the probability each one is truly the strongest, from 20,000 Bayesian draws."
            >
                <div className="space-y-2.5">
                    {data.ranked.map((r) => (
                        <EmailRow key={r.variantId} r={r} best={r === top} />
                    ))}
                </div>
            </Section>
        </>
    );
}

function Learning({ curve, top, baseline }: { curve: IterationPoint[]; top?: RankedEmail; baseline: number | null }) {
    const done = curve.filter((p) => p.delivered > 0);
    const max = Math.max(0.05, ...done.map((p) => Math.max(p.rate, p.bestRate))) * 1.15;
    const W = 640;
    const H = 150;
    const x = (i: number) => (done.length <= 1 ? W / 2 : 24 + (i * (W - 48)) / (done.length - 1));
    const y = (v: number) => H - 18 - (v / max) * (H - 36);
    const line = (key: "rate" | "bestRate") => done.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    const first = done[0];
    const last = done[done.length - 1];
    return (
        <Section
            title={
                <span className="flex items-center gap-2">
                    <TrendingUpIcon className="size-4 text-sky-600" /> How the engine improved, iteration by iteration
                </span>
            }
            hint="Each experiment tests one variable on the current best email, keeps the winner and tries the next idea. Positive-reply rate per iteration."
        >
            <div className="grid lg:grid-cols-[1fr_280px] gap-4">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                    {done.length ? (
                        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
                            <defs>
                                <linearGradient id="pb-curve" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.28" />
                                    <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                                </linearGradient>
                            </defs>
                            {done.length > 1 && <path d={`${line("bestRate")} L${x(done.length - 1)},${H - 18} L${x(0)},${H - 18} Z`} fill="url(#pb-curve)" />}
                            <path d={line("rate")} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
                            <path d={line("bestRate")} fill="none" stroke="#7c3aed" strokeWidth="2.5" />
                            {done.map((p, i) => (
                                <g key={p.seq}>
                                    <circle cx={x(i)} cy={y(p.bestRate)} r="4" fill="#7c3aed" />
                                    <text x={x(i)} y={y(p.bestRate) - 9} textAnchor="middle" className="fill-slate-700 text-[10px] font-semibold">
                                        {pct(p.bestRate)}
                                    </text>
                                    <text x={x(i)} y={H - 3} textAnchor="middle" className="fill-slate-400 text-[9.5px]">
                                        #{p.seq} {humanize(p.variableTested).replace("messaging ", "")}
                                    </text>
                                </g>
                            ))}
                        </svg>
                    ) : (
                        <Empty>No results yet.</Empty>
                    )}
                    <div className="mt-1 flex gap-4 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-sky-600" /> best email in the iteration</span>
                        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-slate-400" /> all emails in the iteration</span>
                    </div>
                </div>
                <div className="space-y-2">
                    <Stat label="Iterations run" value={String(curve.length)} detail={`${curve.filter((c) => c.decision === "scale").length} produced a confident winner`} />
                    {first && last && (
                        <Stat
                            label="Best-email reply rate"
                            value={`${pct(first.bestRate)} → ${pct(last.bestRate)}`}
                            detail={last.bestRate > first.bestRate ? `+${((last.bestRate - first.bestRate) * 100).toFixed(1)} points since iteration 1` : "holding steady"}
                        />
                    )}
                    {top && (
                        <Stat
                            label="Current best"
                            value={`${top.label} · ${pct(top.rate)}`}
                            detail={baseline !== null ? `vs ${pct(baseline)} for the first iteration's best` : `${top.positive}/${top.delivered} positive`}
                        />
                    )}
                </div>
            </div>
            {curve.length > 0 && (
                <ol className="mt-3 flex flex-wrap gap-1.5">
                    {curve.map((p) => (
                        <li key={p.seq} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] text-slate-600">
                            <span className="font-semibold text-slate-900">#{p.seq}</span> {humanize(p.variableTested)}
                            {p.decision ? <DecisionPill action={p.decision} /> : <StatusPill status={p.status} />}
                        </li>
                    ))}
                </ol>
            )}
        </Section>
    );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-slate-400">{label}</div>
            <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-slate-900" style={{ fontFamily: "var(--font-display)" }}>
                {value}
            </div>
            {detail && <div className="text-[11.5px] text-slate-500">{detail}</div>}
        </div>
    );
}

function EmailRow({ r, best }: { r: RankedEmail; best: boolean }) {
    const [open, setOpen] = useState(best);
    return (
        <div className={cn("rounded-lg border bg-white", best ? "border-sky-300 ring-2 ring-sky-500/15" : "border-slate-200")}>
            <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-3 py-2.5 flex items-start gap-3">
                <span
                    className={cn(
                        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-[12px] font-bold",
                        best ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white" : "bg-slate-100 text-slate-600",
                    )}
                >
                    {best ? <CrownIcon className="size-3.5" /> : r.rank}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-900">{r.label}</span>
                        <span className="truncate text-[12.5px] text-slate-600">“{r.subject}”</span>
                        <StatusPill status={r.status} />
                        {r.introducedIn && <Pill>iteration {r.introducedIn}</Pill>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(r.traits).map(([k, v]) => (
                            <Pill key={k} tone={best ? "violet" : "neutral"}>
                                {humanize(k === "subjectStyle" ? "subject" : k)}: {humanize(String(v))}
                            </Pill>
                        ))}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">{r.why}</p>
                </div>
                <div className="hidden sm:grid grid-cols-4 gap-4 text-right shrink-0">
                    <Metric label="Delivered" value={String(r.delivered)} />
                    <Metric label="Positive" value={`${r.positive}`} sub={r.delivered ? pct(r.rate) : "–"} strong={best} />
                    <Metric label="Meetings" value={String(r.meetings)} />
                    <div className="w-28">
                        <div className="text-[10px] uppercase tracking-[0.08em] text-slate-400">P(best)</div>
                        <ProbBar value={r.pBest} tone={best ? "green" : "sky"} />
                        {r.delivered > 0 && <div className="text-[10.5px] text-slate-400 tabular-nums">90%: {pct(r.ci90[0])}–{pct(r.ci90[1])}</div>}
                    </div>
                </div>
            </button>
            {open && (
                <div className="border-t border-slate-100 px-3 py-3 ml-10">
                    <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-slate-700">{`Subject: ${r.subject}\n\n${r.body}`}</pre>
                </div>
            )}
        </div>
    );
}

function Metric({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
    return (
        <div className="w-16">
            <div className="text-[10px] uppercase tracking-[0.08em] text-slate-400">{label}</div>
            <div className={cn("text-[14px] tabular-nums", strong ? "font-bold text-sky-700" : "font-semibold text-slate-900")}>{value}</div>
            {sub && <div className="text-[11px] tabular-nums text-slate-500">{sub}</div>}
        </div>
    );
}
