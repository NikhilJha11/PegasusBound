import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import toast from "react-hot-toast/headless";
import { UploadIcon } from "lucide-react";
import { Page, PageBody, PageTopbar } from "@/components/layout/Page";
import { Btn, Field, Section, errorText, inputCls, textareaCls } from "@/components/app/intelligence/parts";
import { useCreateIntelCampaign, useCrmLists, useIntelSetup, type Brief } from "@/lib/api/intel";
import { cn } from "@/lib/utils";

const TYPES = ["Pain-point-led outreach", "Offer or incentive-led outreach", "Event-triggered outreach", "CRM lead reactivation", "Explore and compare several approaches"];
const STYLES = ["Short, direct and conversational", "Highly personalized, researched", "Insight-led, with a specific business observation", "Challenger-style, questioning the status quo"];
const MAX_CSV_BYTES = 10 * 1024 * 1024;

export default function NewIntelCampaignPage() {
    const navigate = useNavigate();
    const setup = useIntelSetup();
    const crmConnected = setup.data?.crm?.status === "connected";
    const lists = useCrmLists(crmConnected);
    const create = useCreateIntelCampaign();

    const [source, setSource] = useState<"csv" | "crm">("csv");
    const [csv, setCsv] = useState<{ name: string; text: string; rows: number } | null>(null);
    const [listId, setListId] = useState("");
    const [name, setName] = useState("");
    const [brief, setBrief] = useState<Brief>({
        campaignType: TYPES[0]!,
        objective: "Qualified meetings booked",
        icp: "",
        persona: "",
        offer: "No offer; focus on the pain point",
        style: STYLES[0]!,
        context: "",
        senderName: "",
        senderCompany: "",
        senderAddress: "",
    });
    const [limits, setLimits] = useState({
        maxTotalProspects: 850,
        dailySendCap: 100,
        observationHours: 72,
        followUps: "3, 4",
        requireApprovalForNewCopy: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        sendStart: "08:00",
        sendEnd: "18:00",
        weekdaysOnly: true,
    });
    const set = (k: keyof Brief) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setBrief((b) => ({ ...b, [k]: e.target.value }));

    async function onFile(file: File | undefined) {
        if (!file) return;
        if (file.size > MAX_CSV_BYTES) return toast.error("That file is over 10 MB. Split it into smaller lists.");
        const text = await file.text();
        const rows = Math.max(0, text.split(/\r?\n/).filter((l) => l.trim()).length - 1);
        if (!/email/i.test(text.split(/\r?\n/)[0] ?? "")) return toast.error("The first row needs an email column.");
        setCsv({ name: file.name, text, rows });
    }

    const audienceReady = source === "csv" ? Boolean(csv) : Boolean(listId);
    const canSubmit = audienceReady && brief.icp && brief.persona && brief.objective && brief.senderName && brief.senderCompany && !create.isPending;

    function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        const followUpDelaysDays = limits.followUps
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= 14)
            .slice(0, 4);
        create.mutate(
            {
                name: name || undefined,
                brief,
                audience: source === "csv" ? { source: "csv", csv: csv!.text } : { source: "crm", listId },
                limits: {
                    maxTotalProspects: limits.maxTotalProspects,
                    dailySendCap: limits.dailySendCap,
                    observationHours: limits.observationHours,
                    followUpDelaysDays,
                    requireApprovalForNewCopy: limits.requireApprovalForNewCopy,
                    timezone: limits.timezone || undefined,
                    sendStart: limits.sendStart,
                    sendEnd: limits.sendEnd,
                    // Weekday bitmask: Mon=1 … Fri=16, Sat=32, Sun=64.
                    sendDays: limits.weekdaysOnly ? 31 : 127,
                },
            },
            {
                onSuccess: (res) => {
                    toast.success(`${res.enrolled.enrolled} prospects enrolled. Building your plan…`);
                    navigate({ to: "/app/intelligence/$id", params: { id: res.id } });
                },
                onError: (err) => toast.error(errorText(err)),
            },
        );
    }

    return (
        <Page>
            <PageTopbar eyebrow="New AI campaign" subtitle="Tell the engine who and why. You approve the plan once before anything is sent." />
            <PageBody>
                <form onSubmit={submit} className="max-w-3xl">
                    <Section title="1 · Audience" hint="Contacts are deduplicated, and anyone on your suppression list or contacted in the last 90 days is excluded.">
                        <div className="flex gap-2 mb-4">
                            {(["csv", "crm"] as const).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    disabled={s === "crm" && !crmConnected}
                                    onClick={() => setSource(s)}
                                    className={cn(
                                        "h-8 px-3 rounded-md text-[12.5px] font-medium border transition-colors disabled:opacity-50",
                                        source === s ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600 hover:border-slate-300",
                                    )}
                                >
                                    {s === "csv" ? "Upload CSV" : `CRM list${crmConnected ? "" : " (connect a CRM first)"}`}
                                </button>
                            ))}
                        </div>
                        {source === "csv" ? (
                            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-8 cursor-pointer hover:border-sky-400 hover:bg-sky-50/40 transition-colors">
                                <UploadIcon className="size-5 text-slate-400" />
                                <span className="text-[13px] text-slate-700">{csv ? `${csv.name} · ${csv.rows.toLocaleString()} rows` : "Choose a CSV file"}</span>
                                <span className="text-[11.5px] text-slate-500">Needs an email column. Name, company and title are detected automatically.</span>
                                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
                            </label>
                        ) : (
                            <Field label="CRM list" hint={lists.data?.error}>
                                <select className={inputCls} value={listId} onChange={(e) => setListId(e.target.value)}>
                                    <option value="">{lists.isLoading ? "Loading lists…" : "Choose a list…"}</option>
                                    {lists.data?.lists.map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.name}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                        )}
                    </Section>

                    <Section title="2 · Goal" hint="The engine researches your Company Brain and plans experiments around this.">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Campaign name (optional)">
                                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Heads of events · UK" />
                            </Field>
                            <Field label="Campaign type">
                                <select className={inputCls} value={brief.campaignType} onChange={set("campaignType")}>
                                    {TYPES.map((t) => (
                                        <option key={t}>{t}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Ideal customer profile">
                                <input className={inputCls} required value={brief.icp} onChange={set("icp")} placeholder="UK B2B event organisers, 20–500 employees" />
                            </Field>
                            <Field label="Persona">
                                <input className={inputCls} required value={brief.persona} onChange={set("persona")} placeholder="Heads of events and marketing directors" />
                            </Field>
                            <Field label="Primary objective">
                                <input className={inputCls} required value={brief.objective} onChange={set("objective")} />
                            </Field>
                            <Field label="Offer">
                                <input className={inputCls} value={brief.offer} onChange={set("offer")} />
                            </Field>
                            <Field label="Email style">
                                <select className={inputCls} value={brief.style} onChange={set("style")}>
                                    {STYLES.map((t) => (
                                        <option key={t}>{t}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Sender name">
                                <input className={inputCls} required value={brief.senderName} onChange={set("senderName")} />
                            </Field>
                            <Field label="Sender company">
                                <input className={inputCls} required value={brief.senderCompany} onChange={set("senderCompany")} />
                            </Field>
                            <Field label="Postal address" hint="Some laws require it in commercial email.">
                                <input className={inputCls} value={brief.senderAddress} onChange={set("senderAddress")} />
                            </Field>
                        </div>
                        <div className="mt-4">
                            <Field label="Anything else the engine should know?" hint="Product focus, events, competitors to avoid, tone.">
                                <textarea className={textareaCls} rows={3} value={brief.context} onChange={set("context")} />
                            </Field>
                        </div>
                    </Section>

                    <Section title="3 · Guardrails" hint="Batches grow 50 → 100 → 200 → 500 only when the evidence supports it. The engine pauses itself on high bounce or unsubscribe rates.">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Max prospects in total">
                                <input className={inputCls} type="number" min={10} value={limits.maxTotalProspects} onChange={(e) => setLimits((l) => ({ ...l, maxTotalProspects: Number(e.target.value) }))} />
                            </Field>
                            <Field label="Daily send cap">
                                <input className={inputCls} type="number" min={1} value={limits.dailySendCap} onChange={(e) => setLimits((l) => ({ ...l, dailySendCap: Number(e.target.value) }))} />
                            </Field>
                            <Field label="Observation window (hours)" hint="Wait after the last step before judging a batch.">
                                <input className={inputCls} type="number" min={1} value={limits.observationHours} onChange={(e) => setLimits((l) => ({ ...l, observationHours: Number(e.target.value) }))} />
                            </Field>
                            <Field label="Follow-ups (days apart)" hint="e.g. 3, 4 = two follow-ups. Empty = single email. Stops on reply.">
                                <input className={inputCls} value={limits.followUps} onChange={(e) => setLimits((l) => ({ ...l, followUps: e.target.value }))} />
                            </Field>
                            <Field label="Timezone" hint="The sending window below is in this timezone.">
                                <input className={inputCls} value={limits.timezone} onChange={(e) => setLimits((l) => ({ ...l, timezone: e.target.value.trim() }))} placeholder="Europe/London" />
                            </Field>
                            <Field label="Sending window" hint="Emails go out only between these times.">
                                <div className="flex items-center gap-2">
                                    <input className={inputCls} type="time" value={limits.sendStart} onChange={(e) => setLimits((l) => ({ ...l, sendStart: e.target.value }))} aria-label="Start time" />
                                    <span className="text-[12px] text-slate-500">to</span>
                                    <input className={inputCls} type="time" value={limits.sendEnd} onChange={(e) => setLimits((l) => ({ ...l, sendEnd: e.target.value }))} aria-label="End time" />
                                </div>
                            </Field>
                        </div>
                        <label className="mt-4 flex items-start gap-2 text-[12.5px] text-slate-700">
                            <input type="checkbox" className="mt-0.5" checked={limits.weekdaysOnly} onChange={(e) => setLimits((l) => ({ ...l, weekdaysOnly: e.target.checked }))} />
                            <span>Weekdays only (recommended for B2B)</span>
                        </label>
                        <label className="mt-4 flex items-start gap-2 text-[12.5px] text-slate-700">
                            <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={limits.requireApprovalForNewCopy}
                                onChange={(e) => setLimits((l) => ({ ...l, requireApprovalForNewCopy: e.target.checked }))}
                            />
                            <span>
                                Ask me before sending any new copy the engine writes
                                <span className="block text-slate-500">Off = approve once and let it run. Copy that fails safety checks always waits for you.</span>
                            </span>
                        </label>
                    </Section>

                    <div className="px-5 py-4 flex justify-end">
                        <Btn type="submit" variant="primary" disabled={!canSubmit}>
                            {create.isPending ? "Creating…" : "Build my campaign plan"}
                        </Btn>
                    </div>
                </form>
            </PageBody>
        </Page>
    );
}
