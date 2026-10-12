import { useState } from "react";
import { Link } from "@tanstack/react-router";
import toast from "react-hot-toast/headless";
import { Page, PageBody, PageTopbar } from "@/components/layout/Page";
import { Btn, ConfidencePill, Empty, Field, Pill, Section, errorText, inputCls, textareaCls } from "@/components/app/intelligence/parts";
import { humanize, useAddMemory, useIntelLearnings, useIntelMemory, useToggleMemory, type MemoryEntry, type TraitDimension } from "@/lib/api/intel";
import { cn } from "@/lib/utils";

const GROUPS: { kind: MemoryEntry["kind"]; title: string; hint: string; tone: "sky" | "green" | "red" }[] = [
    { kind: "guideline", title: "Guidelines", hint: "Always followed: brand voice, tone and format rules from your documents, Company Brain and team.", tone: "sky" },
    { kind: "principle", title: "Proven principles", hint: "What won in controlled tests. Applied by default; strong ones aren't re-tested.", tone: "green" },
    { kind: "avoid", title: "Avoid", hint: "Styles that keep underperforming.", tone: "red" },
];
const SOURCE: Record<MemoryEntry["source"], string> = { experiment: "learned from tests", brain: "from Company Brain", document: "from your documents", human: "added by your team" };
const DIMS: TraitDimension[] = ["tone", "format", "angle", "cta", "personalization", "subjectStyle", "length"];

export default function IntelMemoryPage() {
    const [persona, setPersona] = useState("");
    const [previewFor, setPreviewFor] = useState("");
    const mem = useIntelMemory(previewFor);
    const learnings = useIntelLearnings();
    const add = useAddMemory();
    const toggle = useToggleMemory();
    const [form, setForm] = useState({ kind: "guideline" as MemoryEntry["kind"], text: "", scope: "" });
    const entries = mem.data?.entries ?? [];

    return (
        <Page>
            <PageTopbar eyebrow="Memory" subtitle="One playbook for every sequence: what works, what to avoid, and your rules" />
            <PageBody>
                <div className="grid lg:grid-cols-3 border-b border-slate-200">
                    {GROUPS.map((g, i) => {
                        const rows = entries.filter((e) => e.kind === g.kind);
                        return (
                            <div key={g.kind} className={cn("p-5", i < 2 && "lg:border-r border-slate-200", "border-b lg:border-b-0 border-slate-200")}>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-[13px] font-semibold text-slate-900">{g.title}</h2>
                                    <Pill tone={g.tone}>{rows.filter((r) => r.active).length}</Pill>
                                </div>
                                <p className="mt-0.5 mb-3 text-[12px] text-slate-500">{g.hint}</p>
                                {rows.length === 0 ? (
                                    <Empty>Nothing yet.</Empty>
                                ) : (
                                    <ul className="space-y-2">
                                        {rows.map((e) => (
                                            <li key={e.id} className={cn("rounded-lg border border-slate-200 p-3 text-[12.5px] text-slate-700", !e.active && "opacity-50")}>
                                                <p>{e.text}</p>
                                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                                    <ConfidencePill confidence={e.confidence} />
                                                    <Pill>{SOURCE[e.source]}</Pill>
                                                    {e.scope !== "*" && <Pill tone="violet">{e.scope}</Pill>}
                                                    <button
                                                        type="button"
                                                        className="ml-auto text-[11px] text-slate-500 hover:text-slate-900"
                                                        onClick={() => toggle.mutate({ id: e.id, active: !e.active }, { onError: (err) => toast.error(errorText(err)) })}
                                                    >
                                                        {e.active ? "Disable" : "Enable"}
                                                    </button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="grid lg:grid-cols-2">
                    <Section title="Add to memory" className="lg:border-r">
                        <form
                            className="space-y-3"
                            onSubmit={(e) => {
                                e.preventDefault();
                                add.mutate(form, {
                                    onSuccess: () => {
                                        setForm((f) => ({ ...f, text: "" }));
                                        toast.success("Remembered");
                                    },
                                    onError: (err) => toast.error(errorText(err)),
                                });
                            }}
                        >
                            <Field label="Type">
                                <select className={inputCls} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as MemoryEntry["kind"] }))}>
                                    <option value="guideline">Guideline (always follow)</option>
                                    <option value="principle">Principle (known to work)</option>
                                    <option value="avoid">Avoid</option>
                                </select>
                            </Field>
                            <Field label="What should the engine remember?">
                                <textarea
                                    className={textareaCls}
                                    rows={3}
                                    required
                                    minLength={3}
                                    value={form.text}
                                    onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                                    placeholder="Never mention competitors by name. Sign off with first name only."
                                />
                            </Field>
                            <Field label="Applies to persona" hint="Leave empty for every campaign.">
                                <input className={inputCls} value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} placeholder="heads of events" />
                            </Field>
                            <Btn type="submit" variant="primary" disabled={add.isPending}>
                                Save
                            </Btn>
                        </form>
                    </Section>
                    <Section title="Preview what a campaign receives" hint="Exactly what the strategist is given when it writes for this persona.">
                        <form
                            className="mb-3 flex gap-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                setPreviewFor(persona.trim());
                            }}
                        >
                            <input className={inputCls} value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Persona, e.g. Heads of events" />
                            <Btn type="submit">Preview</Btn>
                        </form>
                        {mem.data?.preview ? (
                            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-[12px] text-slate-700">{mem.data.preview}</pre>
                        ) : (
                            <p className="text-[12px] text-slate-500">Enter a persona to preview.</p>
                        )}
                    </Section>
                </div>

                <Section title="Style leaderboard across all campaigns" hint="Observational: pooled across every version that used each style.">
                    <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
                        {DIMS.map((d) => {
                            const rows = mem.data?.leaderboard[d] ?? [];
                            const best = Math.max(...rows.map((r) => r.rate), 0.0001);
                            return (
                                <div key={d}>
                                    <div className="mb-1.5 text-[12.5px] font-medium text-slate-900">{mem.data?.dimensions[d] ?? d}</div>
                                    {rows.length === 0 ? (
                                        <p className="text-[11.5px] text-slate-400">No data yet.</p>
                                    ) : (
                                        <ul className="space-y-1">
                                            {rows.map((r, i) => (
                                                <li key={r.value} className="flex items-center gap-2 text-[11.5px]">
                                                    <span className="w-28 truncate text-slate-700">{humanize(r.value)}</span>
                                                    <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                                                        <div className={cn("h-1.5 rounded-full", i === 0 ? "bg-emerald-500" : "bg-sky-400")} style={{ width: `${(r.rate / best) * 100}%` }} />
                                                    </div>
                                                    <span className="w-24 text-right tabular-nums text-slate-500">
                                                        {(r.rate * 100).toFixed(1)}% · n={r.delivered}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Section>

                <Section title="Learning log" hint="Every evaluated experiment, with its evidence.">
                    {(learnings.data?.learnings ?? []).length === 0 ? (
                        <Empty>Nothing learned yet.</Empty>
                    ) : (
                        <ul className="space-y-2">
                            {learnings.data!.learnings.map(({ l, campaignName }) => (
                                <li key={l.id} className="rounded-lg border border-slate-200 px-3 py-2.5 text-[12.5px]">
                                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                        <ConfidencePill confidence={l.confidence} />
                                        <Link to="/app/intelligence/$id" params={{ id: l.campaignId }} className="font-medium text-slate-900 hover:underline">
                                            {campaignName}
                                        </Link>
                                        <span className="text-[11px] text-slate-500">
                                            #{l.evidence.experimentSeq} · {l.evidence.variableTested}
                                        </span>
                                        <span className="ml-auto text-[11px] text-slate-400">{new Date(l.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <p className="text-slate-700">{l.observation}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            </PageBody>
        </Page>
    );
}
