import { useParams } from "@tanstack/react-router";
import { Empty, Pill, Section, StatusPill } from "@/components/app/intelligence/parts";
import { humanize, useIntelCampaign, useIntelFormats, type TraitDimension, type TraitRow } from "@/lib/api/intel";

const DIMS: TraitDimension[] = ["tone", "format", "angle", "cta", "personalization", "subjectStyle", "length"];

export default function IntelFormatsPage() {
    const { id } = useParams({ from: "/app/intelligence/$id/formats" });
    const detail = useIntelCampaign(id);
    const formats = useIntelFormats(id);
    if (!detail.data || !formats.data) return <div className="p-5 text-[13px] text-slate-500">Loading…</div>;
    const { variants, counts } = detail.data;
    const labels = formats.data.dimensions;
    const ranked = variants
        .map((v) => {
            const k = counts[v.id];
            const delivered = k?.delivered ?? 0;
            const positive = k?.positive ?? 0;
            return { v, delivered, positive, smoothed: (positive + 1) / (delivered + 2) };
        })
        .sort((a, b) => b.smoothed - a.smoothed);
    const top = ranked.find((r) => r.delivered > 0);

    return (
        <>
            <Section title="Every email in this sequence" hint="Each version is frozen once sent, so its results stay comparable.">
                {ranked.length === 0 ? (
                    <Empty>No email versions yet.</Empty>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full min-w-[54rem] text-[12px]">
                            <thead className="bg-slate-50 text-left text-[11px] text-slate-500">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Version</th>
                                    {DIMS.map((d) => (
                                        <th key={d} className="px-3 py-2 font-medium">
                                            {labels[d]}
                                        </th>
                                    ))}
                                    <th className="px-3 py-2 font-medium">Steps</th>
                                    <th className="px-3 py-2 font-medium text-right">Delivered</th>
                                    <th className="px-3 py-2 font-medium text-right">Positive</th>
                                    <th className="px-3 py-2 font-medium text-right">Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranked.map(({ v, delivered, positive }) => (
                                    <tr key={v.id} className={top?.v.id === v.id ? "border-t border-slate-100 bg-emerald-50/50" : "border-t border-slate-100"}>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-1.5 font-medium text-slate-900">
                                                {v.label} <StatusPill status={v.status} />
                                                {top?.v.id === v.id && <Pill tone="green">top performer</Pill>}
                                            </div>
                                            <div className="max-w-[15rem] truncate text-[11px] text-slate-500" title={v.subject}>
                                                {v.subject}
                                            </div>
                                        </td>
                                        {DIMS.map((d) => (
                                            <td key={d} className="px-3 py-2.5 text-slate-700">
                                                {v.traits[d] ? humanize(v.traits[d]!) : <span className="text-slate-300">—</span>}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2.5 tabular-nums">{1 + v.followUps.length}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{delivered}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{positive}</td>
                                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">{delivered ? `${((positive / delivered) * 100).toFixed(1)}%` : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            <Section
                title="What's working, by characteristic"
                hint="Positive-reply rate for each style, pooled across the versions that use it. “All campaigns” is the workspace memory every sequence learns from. Controlled test results live in Memory."
            >
                <div className="grid gap-4 md:grid-cols-2">
                    {DIMS.map((d) => (
                        <div key={d} className="rounded-lg border border-slate-200 p-3">
                            <div className="mb-2 text-[12.5px] font-semibold text-slate-900">{labels[d]}</div>
                            <DimensionTable rows={formats.data.campaign[d] ?? []} global={formats.data.all[d] ?? []} />
                        </div>
                    ))}
                </div>
            </Section>
        </>
    );
}

function DimensionTable({ rows, global }: { rows: TraitRow[]; global: TraitRow[] }) {
    if (rows.length === 0) return <p className="text-[12px] text-slate-500">No sends yet.</p>;
    const g = new Map(global.map((r) => [r.value, r]));
    const max = Math.max(...rows.map((r) => r.ci90[1]), 0.0001);
    return (
        <table className="w-full text-[12px]">
            <thead className="text-left text-[10.5px] text-slate-500">
                <tr>
                    <th className="pb-1.5 font-medium">Style</th>
                    <th className="pb-1.5 font-medium">This campaign</th>
                    <th className="pb-1.5 font-medium text-right">All campaigns</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r, i) => {
                    const gr = g.get(r.value);
                    return (
                        <tr key={r.value} className="border-t border-slate-100">
                            <td className="py-1.5 pr-2">
                                <div className="flex items-center gap-1">
                                    <span className="text-slate-800">{humanize(r.value)}</span>
                                    {i === 0 && rows.length > 1 && <Pill tone={r.pBest >= 0.9 ? "green" : "sky"}>{r.pBest >= 0.9 ? "winner" : "leading"}</Pill>}
                                </div>
                                <div className="text-[10.5px] text-slate-400">
                                    {r.positive}/{r.delivered}
                                    {rows.length > 1 ? ` · ${Math.round(r.pBest * 100)}% chance best` : ""}
                                </div>
                            </td>
                            <td className="w-1/2 py-1.5 pr-2">
                                <div className="relative h-2 rounded-full bg-slate-100" title={`90% range ${(r.ci90[0] * 100).toFixed(1)}–${(r.ci90[1] * 100).toFixed(1)}%`}>
                                    <div className="absolute h-2 rounded-full bg-sky-200" style={{ left: `${(r.ci90[0] / max) * 100}%`, width: `${((r.ci90[1] - r.ci90[0]) / max) * 100}%` }} />
                                    <div className="absolute top-0 h-2 w-1 rounded-full bg-sky-600" style={{ left: `calc(${(r.rate / max) * 100}% - 2px)` }} />
                                </div>
                                <div className="mt-0.5 text-[10.5px] tabular-nums text-slate-600">{(r.rate * 100).toFixed(1)}%</div>
                            </td>
                            <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-500">{gr ? `${(gr.rate * 100).toFixed(1)}% (n=${gr.delivered})` : "—"}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
