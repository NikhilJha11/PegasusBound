import { Link, Outlet, useLocation, useParams } from "@tanstack/react-router";
import toast from "react-hot-toast/headless";
import { PauseIcon, PlayIcon } from "lucide-react";
import { Page, PageTopbar, TopbarAction } from "@/components/layout/Page";
import { StatusPill, errorText } from "@/components/app/intelligence/parts";
import { useIntelCampaign, usePauseIntelCampaign, useResumeIntelCampaign } from "@/lib/api/intel";
import { cn } from "@/lib/utils";

export default function IntelCampaignLayout() {
    const { id } = useParams({ from: "/app/intelligence/$id" });
    const { pathname } = useLocation();
    const q = useIntelCampaign(id);
    const pause = usePauseIntelCampaign();
    const resume = useResumeIntelCampaign();
    const c = q.data?.campaign;
    const tabs = [
        { to: "/app/intelligence/$id", label: "Overview", active: !/\/(leads|formats|best)$/.test(pathname) },
        { to: "/app/intelligence/$id/best", label: "Best emails", active: pathname.endsWith("/best") },
        { to: "/app/intelligence/$id/leads", label: "Leads & inbox", active: pathname.endsWith("/leads") },
        { to: "/app/intelligence/$id/formats", label: "Email formats", active: pathname.endsWith("/formats") },
    ] as const;

    if (q.isError) {
        return (
            <Page>
                <PageTopbar eyebrow="AI campaign" subtitle="Not found" />
                <div className="p-8 text-[13px] text-slate-500">This campaign doesn't exist or belongs to another workspace.</div>
            </Page>
        );
    }

    return (
        <Page>
            <PageTopbar eyebrow="AI campaign" subtitle={c ? c.name : "Loading…"}>
                {c && <StatusPill status={c.status} />}
                {c?.status === "running" && (
                    <TopbarAction
                        variant="ghost"
                        icon={<PauseIcon className="w-3 h-3" />}
                        onClick={() => pause.mutate(id, { onSuccess: () => toast.success("Paused"), onError: (e) => toast.error(errorText(e)) })}
                    >
                        Pause
                    </TopbarAction>
                )}
                {c?.status === "paused" && (
                    <TopbarAction
                        icon={<PlayIcon className="w-3 h-3" />}
                        onClick={() => resume.mutate(id, { onSuccess: () => toast.success("Resumed"), onError: (e) => toast.error(errorText(e)) })}
                    >
                        Resume
                    </TopbarAction>
                )}
            </PageTopbar>
            <nav className="px-5 border-b border-slate-200 flex gap-1 overflow-x-auto shrink-0">
                {tabs.map((t) => (
                    <Link
                        key={t.to}
                        to={t.to}
                        params={{ id }}
                        className={cn(
                            "-mb-px h-10 inline-flex items-center px-3 border-b-2 text-[12.5px] whitespace-nowrap transition-colors",
                            t.active ? "border-sky-600 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-800",
                        )}
                    >
                        {t.label}
                    </Link>
                ))}
            </nav>
            {c?.statusDetail && <div className="px-5 py-2 text-[12px] text-slate-600 border-b border-slate-200 bg-slate-50/60">{c.statusDetail}</div>}
            <div className="flex-1 min-h-0 overflow-auto">
                <Outlet />
            </div>
        </Page>
    );
}
