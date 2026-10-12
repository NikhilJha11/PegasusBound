import { Link } from "@tanstack/react-router";
import { BrainIcon, CheckIcon, PlusIcon, SparklesIcon } from "lucide-react";
import toast from "react-hot-toast/headless";
import { Page, PageBody, PageTopbar, Stat, StatStrip, TopbarAction } from "@/components/layout/Page";
import { Btn, ConfidencePill, Empty, Pill, Section, StatusPill, errorText } from "@/components/app/intelligence/parts";
import { useQuery } from "@tanstack/react-query";
import { Call } from "@/lib/api";
import { pct, useIntelCampaigns, useIntelSetup, useProvisionIntel } from "@/lib/api/intel";
import { cn } from "@/lib/utils";

export default function IntelligencePage() {
    const setup = useIntelSetup();
    const campaigns = useIntelCampaigns();
    const provision = useProvisionIntel();
    // Any connected sending mailbox is enough to start.
    const mailboxes = useQuery({ queryKey: ["intel", "mailbox-check"], queryFn: () => Call("/emails?limit=1") as Promise<{ data?: unknown[] }> });
    const rows = campaigns.data?.campaigns ?? [];
    const mailboxCount = mailboxes.data?.data?.length ?? 0;
    const totals = rows.reduce(
        (a, r) => ({ delivered: a.delivered + r.delivered, positive: a.positive + r.positive, meetings: a.meetings + r.meetings, experiments: a.experiments + r.experimentsDone }),
        { delivered: 0, positive: 0, meetings: 0, experiments: 0 },
    );

    const steps = [
        { done: Boolean(setup.data?.provisioned), label: "Turn on Intelligence for this workspace", detail: "Creates a scoped key so experiments keep running while you're away." },
        { done: mailboxCount > 0, label: "Connect a sending mailbox", detail: "AI campaigns send through your own mailboxes, with warm-up and caps.", to: "/app/emails" },
        {
            done: setup.data?.brain?.status === "connected" || (setup.data?.documents ?? 0) > 0,
            label: "Give the engine your knowledge",
            detail: "Upload your ICP, product docs, case studies and sample emails, or connect a Company Brain over MCP.",
            to: "/app/intelligence/knowledge",
        },
        { done: setup.data?.crm?.status === "connected", label: "Connect your CRM (optional)", detail: "Pick audiences from Attio lists and hand hot replies to your team.", to: "/app/intelligence/connections" },
    ];
    const ready = steps[0]!.done && steps[1]!.done;

    return (
        <Page>
            <PageTopbar eyebrow="Intelligence" subtitle="Experiments that learn what works, then do more of it">
                <TopbarAction href="/app/intelligence/memory" variant="ghost" icon={<BrainIcon className="w-3 h-3" />}>
                    Memory
                </TopbarAction>
                <TopbarAction href="/app/intelligence/new" icon={<PlusIcon className="w-3 h-3" />} disabled={!ready}>
                    New AI campaign
                </TopbarAction>
            </PageTopbar>

            <StatStrip cols={4}>
                <Stat label="Delivered" value={totals.delivered} sub="across AI campaigns" />
                <Stat label="Positive replies" value={totals.positive} sub={pct(totals.positive, totals.delivered)} />
                <Stat label="Meetings" value={totals.meetings} sub="requested or booked" />
                <Stat label="Experiments" value={totals.experiments} sub="evaluated" last />
            </StatStrip>

            <PageBody>
                {steps.some((s) => !s.done) && (
                    <Section title="Get set up" hint="A few one-time steps. After that you approve a plan once and the engine runs it.">
                        <ol className="space-y-3">
                            {steps.map((s, i) => (
                                <li key={s.label} className="flex items-start gap-3">
                                    <span
                                        className={cn(
                                            "mt-0.5 size-5 shrink-0 rounded-full grid place-items-center text-[11px]",
                                            s.done ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-500",
                                        )}
                                    >
                                        {s.done ? <CheckIcon className="size-3" /> : i + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[13px] font-medium text-slate-900">{s.label}</div>
                                        <div className="text-[12px] text-slate-500">{s.detail}</div>
                                    </div>
                                    {!s.done && i === 0 && (
                                        <Btn
                                            variant="primary"
                                            disabled={provision.isPending}
                                            onClick={() =>
                                                provision.mutate(undefined, {
                                                    onSuccess: () => toast.success("Intelligence is on"),
                                                    onError: (e) => toast.error(errorText(e)),
                                                })
                                            }
                                        >
                                            Turn on
                                        </Btn>
                                    )}
                                    {!s.done && s.to && (
                                        <Link to={s.to} className="text-[12px] font-medium text-sky-700 hover:text-sky-900">
                                            Open →
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ol>
                    </Section>
                )}

                <Section title="AI campaigns" hint="What ran, what it learned, and what it will try next.">
                    {campaigns.isLoading ? (
                        <div className="text-[13px] text-slate-500">Loading…</div>
                    ) : rows.length === 0 ? (
                        <Empty
                            action={
                                ready ? (
                                    <Link to="/app/intelligence/new" className="text-[12.5px] font-medium text-sky-700 hover:text-sky-900">
                                        Create your first AI campaign →
                                    </Link>
                                ) : undefined
                            }
                        >
                            No AI campaigns yet. Pick an audience and a goal; the engine researches, writes, tests and adapts.
                        </Empty>
                    ) : (
                        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                            {rows.map((r) => (
                                <li key={r.campaign.id}>
                                    <Link
                                        to="/app/intelligence/$id"
                                        params={{ id: r.campaign.id }}
                                        className="block px-4 py-3 hover:bg-slate-50 transition-colors"
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <SparklesIcon className="size-3.5 text-violet-500" />
                                            <span className="text-[13.5px] font-medium text-slate-900">{r.campaign.name}</span>
                                            <StatusPill status={r.campaign.status} />
                                            {r.needsReview > 0 && <Pill tone="amber">{r.needsReview} replies to review</Pill>}
                                            <span className="ml-auto text-[11.5px] text-slate-500">
                                                {r.delivered} delivered · {r.positive} positive ({pct(r.positive, r.delivered)}) · {r.meetings} meetings
                                            </span>
                                        </div>
                                        {r.campaign.statusDetail && <p className="mt-1 text-[12px] text-slate-500 truncate">{r.campaign.statusDetail}</p>}
                                        {r.latestLearning && (
                                            <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
                                                <span className="mr-2">
                                                    <ConfidencePill confidence={r.latestLearning.confidence} />
                                                </span>
                                                {r.latestLearning.observation}
                                                <div className="mt-1 text-[12px] text-slate-500">Next: {r.latestLearning.nextAction}</div>
                                            </div>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            </PageBody>
        </Page>
    );
}
