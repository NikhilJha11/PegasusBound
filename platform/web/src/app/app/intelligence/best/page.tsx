import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { CrownIcon } from "lucide-react";
import { Call } from "@/lib/api";
import { Page, PageBody, PageTopbar } from "@/components/layout/Page";
import { Empty, Pill, ProbBar, Section, StatusPill } from "@/components/app/intelligence/parts";
import { humanize, useIntelCampaigns, type IterationPoint, type RankedEmail } from "@/lib/api/intel";
import { cn } from "@/lib/utils";

type Ranking = { ranked: RankedEmail[]; curve: IterationPoint[]; baselineRate: number | null };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Workspace view: each campaign's emails, best first, with how far iteration moved it. */
export default function IntelBestAcrossPage() {
    const list = useIntelCampaigns();
    const rows = list.data?.campaigns ?? [];
    const rankings = useQueries({
        queries: rows.map((r) => ({
            queryKey: ["intel", "ranking", r.campaign.id],
            queryFn: () => Call(`/intel/campaigns/${r.campaign.id}/ranking`, "GET") as Promise<Ranking>,
        })),
    });
    const all = rows
        .map((r, i) => ({ row: r, data: rankings[i]?.data }))
        .filter((x) => x.data?.ranked.some((e) => e.delivered > 0));
    const leaders = all
        .flatMap((x) => x.data!.ranked.filter((e) => e.delivered > 0).map((e) => ({ e, campaign: x.row.campaign })))
        .sort((a, b) => b.e.posteriorMean - a.e.posteriorMean);
    return (
        <Page>
            <PageTopbar eyebrow="Best emails" subtitle="Which emails performed best in every campaign, and how much each campaign improved as the engine iterated." />
            <PageBody>
                {!all.length ? (
                    <div className="p-6">
                        <Empty>{list.isLoading ? "Loading…" : "No results yet. Once a campaign sends, its best emails appear here."}</Empty>
                    </div>
                ) : (
                    <>
                        <Section title="Top emails across the workspace" hint="Ranked by posterior positive-reply rate. The best of each campaign carries a crown.">
                            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <table className="w-full text-[12.5px]">
                                    <thead className="bg-slate-50 text-[10.5px] uppercase tracking-[0.08em] text-slate-500">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium">#</th>
                                            <th className="px-3 py-2 text-left font-medium">Email</th>
                                            <th className="px-3 py-2 text-left font-medium">Campaign</th>
                                            <th className="px-3 py-2 text-right font-medium">Delivered</th>
                                            <th className="px-3 py-2 text-right font-medium">Positive</th>
                                            <th className="px-3 py-2 text-right font-medium">Meetings</th>
                                            <th className="px-3 py-2 text-left font-medium w-36">P(best in campaign)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {leaders.slice(0, 12).map(({ e, campaign }, i) => (
                                            <tr key={e.variantId} className={e.rank === 1 ? "bg-sky-50/40" : ""}>
                                                <td className="px-3 py-2 tabular-nums text-slate-500">{i + 1}</td>
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-1.5 font-medium text-slate-900">
                                                        {e.rank === 1 && <CrownIcon className="size-3.5 text-sky-600" />}
                                                        {e.label} <span className="font-normal text-slate-500 truncate max-w-[22rem]">“{e.subject}”</span>
                                                    </div>
                                                    <div className="text-[11px] text-slate-500">
                                                        {humanize(String(e.traits.angle ?? ""))} angle · {humanize(String(e.traits.cta ?? ""))} CTA · {humanize(String(e.traits.subjectStyle ?? ""))} subject
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Link to="/app/intelligence/$id/best" params={{ id: campaign.id }} className="text-sky-700 hover:text-sky-900">
                                                        {campaign.name}
                                                    </Link>
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">{e.delivered}</td>
                                                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                                                    {e.positive} <span className="font-normal text-slate-500">({pct(e.rate)})</span>
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">{e.meetings}</td>
                                                <td className="px-3 py-2">
                                                    <ProbBar value={e.pBest} tone={e.rank === 1 ? "green" : "sky"} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>
                        <div className="grid lg:grid-cols-2">
                            {all.map(({ row, data }, i) => {
                                const done = data!.curve.filter((c) => c.delivered > 0);
                                const first = done[0];
                                const last = done[done.length - 1];
                                const top = data!.ranked[0]!;
                                return (
                                    <Section
                                        key={row.campaign.id}
                                        className={cn(i % 2 === 0 && "lg:border-r")}
                                        title={
                                            <span className="flex items-center gap-2">
                                                {row.campaign.name} <StatusPill status={row.campaign.status} />
                                            </span>
                                        }
                                        hint={
                                            first && last
                                                ? `Best-email reply rate ${pct(first.bestRate)} in iteration 1 → ${pct(last.bestRate)} in iteration ${last.seq}.`
                                                : undefined
                                        }
                                        action={
                                            <Link to="/app/intelligence/$id/best" params={{ id: row.campaign.id }} className="text-[12px] font-medium text-sky-700 hover:text-sky-900">
                                                All emails →
                                            </Link>
                                        }
                                    >
                                        <ol className="space-y-1.5">
                                            {data!.ranked.filter((e) => e.delivered > 0).slice(0, 4).map((e) => (
                                                <li key={e.variantId} className="flex items-center gap-2 text-[12.5px]">
                                                    <span className={cn("grid size-5 place-items-center rounded text-[10.5px] font-bold", e === top ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white" : "bg-slate-100 text-slate-600")}>
                                                        {e.rank}
                                                    </span>
                                                    <span className="font-medium text-slate-900">{e.label}</span>
                                                    <span className="truncate text-slate-500">“{e.subject}”</span>
                                                    <Pill className="ml-auto">{pct(e.rate)}</Pill>
                                                    <span className="w-24"><ProbBar value={e.pBest} tone={e === top ? "green" : "sky"} /></span>
                                                </li>
                                            ))}
                                        </ol>
                                        <p className="mt-2 text-[11.5px] text-slate-500">{top.why}</p>
                                    </Section>
                                );
                            })}
                        </div>
                    </>
                )}
            </PageBody>
        </Page>
    );
}
