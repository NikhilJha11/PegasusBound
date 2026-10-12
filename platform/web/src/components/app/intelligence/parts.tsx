// Shared building blocks for the Intelligence pages. Uses the dashboard's
// slate/sky palette so the global dark theme applies automatically.
import type React from "react";
import { cn } from "@/lib/utils";
import { humanize, type CampaignStatus, type DecisionAction } from "@/lib/api/intel";

type Tone = "neutral" | "sky" | "green" | "amber" | "red" | "violet";

const TONES: Record<Tone, string> = {
    neutral: "bg-slate-100 text-slate-600",
    sky: "bg-sky-50 text-sky-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>
            {children}
        </span>
    );
}

const STATUS_TONE: Record<string, Tone> = {
    draft: "neutral",
    planning: "violet",
    awaiting_approval: "amber",
    running: "green",
    paused: "amber",
    completed: "neutral",
    stopped: "neutral",
    failed: "red",
    pending_approval: "amber",
    sending: "sky",
    observing: "sky",
    evaluated: "neutral",
    champion: "green",
    active: "sky",
    retired: "neutral",
    connected: "green",
    needs_auth: "amber",
    error: "red",
    pending: "neutral",
};

export function StatusPill({ status }: { status: CampaignStatus | string }) {
    return (
        <Pill tone={STATUS_TONE[status] ?? "neutral"}>
            {(status === "running" || status === "planning") && <span className="size-1.5 rounded-full bg-current animate-pulse" />}
            {humanize(status)}
        </Pill>
    );
}

const ACTION_TONE: Record<DecisionAction, Tone> = { scale: "green", continue: "sky", revise: "amber", stop: "neutral", pause_health: "red" };
const ACTION_LABEL: Record<DecisionAction, string> = {
    scale: "Winner found: scaling",
    continue: "Collecting more evidence",
    revise: "Rewriting the messaging",
    stop: "Finished",
    pause_health: "Paused for safety",
};

export function DecisionPill({ action }: { action: DecisionAction }) {
    return <Pill tone={ACTION_TONE[action]}>{ACTION_LABEL[action]}</Pill>;
}

export function ConfidencePill({ confidence }: { confidence: "preliminary" | "moderate" | "strong" }) {
    return <Pill tone={confidence === "strong" ? "green" : confidence === "moderate" ? "sky" : "neutral"}>{confidence}</Pill>;
}

/** A titled block inside a page body. */
export function Section({
    title,
    hint,
    action,
    children,
    className,
}: {
    title: React.ReactNode;
    hint?: React.ReactNode;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("border-b border-slate-200", className)}>
            <header className="px-5 pt-4 pb-2 flex items-start gap-3">
                <div className="min-w-0">
                    <h2 className="text-[13px] font-semibold text-slate-900">{title}</h2>
                    {hint && <p className="text-[12px] text-slate-500 mt-0.5">{hint}</p>}
                </div>
                {action && <div className="ml-auto shrink-0">{action}</div>}
            </header>
            <div className="px-5 pb-5">{children}</div>
        </section>
    );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center">
            <p className="text-[13px] text-slate-500">{children}</p>
            {action && <div className="mt-3 flex justify-center">{action}</div>}
        </div>
    );
}

export function Btn({
    children,
    onClick,
    variant = "secondary",
    disabled,
    type = "button",
    className,
}: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: "primary" | "secondary" | "danger";
    disabled?: boolean;
    type?: "button" | "submit";
    className?: string;
}) {
    const styles = {
        primary: "bg-sky-600 hover:bg-sky-700 text-white",
        secondary: "border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 bg-white",
        danger: "border border-slate-200 hover:border-rose-300 text-rose-700 bg-white hover:bg-rose-50",
    }[variant];
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "h-8 px-3 rounded-md inline-flex items-center justify-center gap-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                styles,
                className,
            )}
        >
            {children}
        </button>
    );
}

export const inputCls =
    "w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400";
export const textareaCls =
    "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400";

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-slate-700">{label}</span>
            {children}
            {hint && <span className="block text-[11.5px] text-slate-500">{hint}</span>}
        </label>
    );
}

/** P(best) bar, used wherever variants or traits compete. */
export function ProbBar({ value, tone = "sky" }: { value: number; tone?: "sky" | "green" }) {
    return (
        <div className="flex items-center gap-2 min-w-[7rem]">
            <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                <div className={cn("h-full rounded-full", tone === "green" ? "bg-emerald-500" : "bg-sky-500")} style={{ width: `${Math.round(value * 100)}%` }} />
            </div>
            <span className="w-9 text-right text-[11px] tabular-nums text-slate-600">{Math.round(value * 100)}%</span>
        </div>
    );
}

export function errorText(err: unknown) {
    if (!err) return "";
    if (err instanceof Error) return err.message;
    return String(err);
}
