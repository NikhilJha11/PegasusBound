import { useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { FileTextIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { Page, PageBody, PageTopbar } from "@/components/layout/Page";
import { Btn, Empty, Field, Pill, Section, StatusPill, errorText, inputCls, textareaCls } from "@/components/app/intelligence/parts";
import { cn } from "@/lib/utils";
import {
    useDeleteDocument,
    useIntelDocuments,
    useUploadDocument,
    type ContextProfile,
    type DocumentKind,
    type KnowledgeDocument,
} from "@/lib/api/intel";

const KINDS: { kind: DocumentKind; label: string; hint: string }[] = [
    { kind: "icp", label: "ICP & personas", hint: "Who you sell to, buyer roles, their pains" },
    { kind: "product", label: "Product", hint: "What it does, features, benefits, pricing notes" },
    { kind: "case_study", label: "Case study", hint: "Customer results and metrics you can cite" },
    { kind: "email_samples", label: "Email samples", hint: "Emails or threads that worked, to learn your voice" },
    { kind: "brand", label: "Brand & voice", hint: "Tone rules, words to use and avoid" },
    { kind: "competitors", label: "Competitors", hint: "Alternatives and how you differ" },
    { kind: "other", label: "Other", hint: "Anything else a copywriter should know" },
];

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,.eml,.csv";

function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function IntelKnowledgePage() {
    const docs = useIntelDocuments();
    const ctx = docs.data?.context ?? null;
    return (
        <Page>
            <PageTopbar
                eyebrow="Knowledge"
                subtitle="No Company Brain? Upload your ICP, product docs, case studies and a few emails that worked. The engine reads them, builds an understanding layer, and every experiment learns on top of it."
            />
            <PageBody>
                <LayerStrip ctx={ctx} documents={docs.data?.documents ?? []} />
                <Upload maxBytes={docs.data?.maxBytes ?? 7 * 1024 * 1024} />
                <Understanding ctx={ctx} loading={docs.isLoading} />
                <Documents documents={docs.data?.documents ?? []} kinds={docs.data?.kinds} />
            </PageBody>
        </Page>
    );
}

function LayerStrip({ ctx, documents }: { ctx: ContextProfile | null; documents: KnowledgeDocument[] }) {
    const ready = documents.filter((d) => d.status === "ready").length;
    const facts = ctx ? ctx.painPoints.length + ctx.valueProps.length + ctx.proofPoints.length + ctx.personas.length + ctx.icp.length : 0;
    const steps = [
        { n: ready, label: "Documents", detail: "Parsed and indexed for retrieval" },
        { n: facts, label: "Understanding", detail: "ICP, personas, pains, value, proof" },
        { n: (ctx?.voice?.rules.length ?? 0) + (ctx?.prohibitedClaims.length ?? 0), label: "Standing memory", detail: "Voice rules and claims to avoid, applied to every campaign" },
        { n: null, label: "Experiments", detail: "A/B tests refine what actually earns replies" },
    ];
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 border-b border-slate-200">
            {steps.map((s, i) => (
                <div key={s.label} className={cn("px-5 py-4", i > 0 && "md:border-l border-slate-200")}>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-medium text-slate-400">{i + 1}</span>
                        <span className="text-[13px] font-semibold text-slate-900">{s.label}</span>
                        {s.n !== null && <span className="ml-auto text-[18px] font-semibold tabular-nums text-slate-900">{s.n}</span>}
                    </div>
                    <p className="mt-1 text-[11.5px] text-slate-500">{s.detail}</p>
                </div>
            ))}
        </div>
    );
}

function Upload({ maxBytes }: { maxBytes: number }) {
    const upload = useUploadDocument();
    const [kind, setKind] = useState<DocumentKind>("icp");
    const [mode, setMode] = useState<"file" | "paste">("file");
    const [title, setTitle] = useState("");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [over, setOver] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    async function sendFiles(files: FileList | File[]) {
        for (const f of Array.from(files)) {
            if (f.size > maxBytes) {
                toast.error(`${f.name} is larger than ${size(maxBytes)}`);
                continue;
            }
            setBusy(f.name);
            try {
                const r = await upload.mutateAsync({ kind, filename: f.name, mimeType: f.type, data: await toBase64(f) });
                if (r.document.status === "ready") toast.success(`${f.name}: ${r.document.statusDetail ?? "ready"}`);
                else toast.error(`${f.name}: ${r.document.statusDetail ?? "couldn't be read"}`);
            } catch (err) {
                toast.error(`${f.name}: ${errorText(err)}`);
            }
        }
        setBusy(null);
        if (input.current) input.current.value = "";
    }

    async function sendText() {
        if (text.trim().length < 40) return toast.error("Paste at least a few sentences");
        setBusy(title || "pasted text");
        try {
            const r = await upload.mutateAsync({ kind, filename: title.trim() || `${KINDS.find((k) => k.kind === kind)!.label} (pasted)`, text });
            if (r.document.status === "ready") {
                toast.success("Added to knowledge");
                setText("");
                setTitle("");
            } else toast.error(r.document.statusDetail ?? "Couldn't read that text");
        } catch (err) {
            toast.error(errorText(err));
        }
        setBusy(null);
    }

    return (
        <Section title="Add knowledge" hint="PDF, Word (.docx), Markdown, text, HTML or .eml. Pick what the document is about so the engine reads it the right way.">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {KINDS.map((k) => (
                    <button
                        key={k.kind}
                        type="button"
                        onClick={() => setKind(k.kind)}
                        className={cn(
                            "text-left rounded-md border px-3 py-2 transition-colors",
                            kind === k.kind ? "border-sky-400 bg-sky-50/60 ring-2 ring-sky-500/20" : "border-slate-200 hover:border-slate-300 bg-white",
                        )}
                    >
                        <div className="text-[12.5px] font-medium text-slate-900">{k.label}</div>
                        <div className="text-[11.5px] text-slate-500">{k.hint}</div>
                    </button>
                ))}
            </div>
            <div className="mt-4 flex gap-1 text-[12px]">
                {(["file", "paste"] as const).map((m) => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={cn("h-7 px-2.5 rounded-md font-medium", mode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
                    >
                        {m === "file" ? "Upload files" : "Paste text"}
                    </button>
                ))}
            </div>
            {mode === "file" ? (
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        setOver(true);
                    }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setOver(false);
                        if (e.dataTransfer.files.length) void sendFiles(e.dataTransfer.files);
                    }}
                    onClick={() => input.current?.click()}
                    className={cn(
                        "mt-3 rounded-lg border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors",
                        over ? "border-sky-400 bg-sky-50/50" : "border-slate-200 hover:border-slate-300",
                    )}
                >
                    <UploadIcon className="mx-auto size-5 text-slate-400" />
                    <p className="mt-2 text-[13px] text-slate-700">
                        {busy ? `Reading ${busy}…` : <>Drop files here or <span className="text-sky-700 font-medium">browse</span></>}
                    </p>
                    <p className="text-[11.5px] text-slate-500 mt-0.5">Up to {size(maxBytes)} each. Scanned PDFs need to be exported as text first.</p>
                    <input
                        ref={input}
                        type="file"
                        multiple
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => e.target.files?.length && void sendFiles(e.target.files)}
                    />
                </div>
            ) : (
                <div className="mt-3 space-y-3">
                    <Field label="Title">
                        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Best-performing emails, Q3" />
                    </Field>
                    <Field
                        label="Text"
                        hint={kind === "email_samples" ? "Paste several emails. Start each with a Subject: line or separate them with ---." : undefined}
                    >
                        <textarea className={cn(textareaCls, "min-h-48 font-mono text-[12px]")} value={text} onChange={(e) => setText(e.target.value)} />
                    </Field>
                    <Btn variant="primary" onClick={sendText} disabled={!!busy}>
                        {busy ? "Reading…" : "Add to knowledge"}
                    </Btn>
                </div>
            )}
        </Section>
    );
}

function List({ title, items, tone = "neutral", empty }: { title: string; items: string[]; tone?: "neutral" | "red"; empty?: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
                <h3 className="text-[12px] font-semibold text-slate-900">{title}</h3>
                <span className="ml-auto text-[11px] tabular-nums text-slate-400">{items.length}</span>
            </div>
            {items.length ? (
                <ul className="mt-2 space-y-1.5">
                    {items.slice(0, 8).map((t) => (
                        <li key={t} className={cn("text-[12px] leading-snug pl-3 relative", tone === "red" ? "text-rose-700" : "text-slate-700")}>
                            <span className="absolute left-0 top-[0.45em] size-1 rounded-full bg-current opacity-50" />
                            {t}
                        </li>
                    ))}
                    {items.length > 8 && <li className="text-[11.5px] text-slate-400">+{items.length - 8} more</li>}
                </ul>
            ) : (
                <p className="mt-2 text-[11.5px] text-slate-400">{empty ?? "Nothing found yet"}</p>
            )}
        </div>
    );
}

function Understanding({ ctx, loading }: { ctx: ContextProfile | null; loading: boolean }) {
    const [open, setOpen] = useState<number | null>(null);
    if (!ctx) {
        return (
            <Section title="Understanding layer" hint="What the engine knows about your business before any email is sent.">
                <Empty>{loading ? "Loading…" : "Upload a document to build the understanding layer."}</Empty>
            </Section>
        );
    }
    const v = ctx.voice;
    return (
        <Section title="Understanding layer" hint={`${ctx.summary} Every new campaign's brief starts from this; experiment results then refine it in Memory.`}>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                <List title="Ideal customer" items={ctx.icp} empty="Upload an ICP document" />
                <List title="Personas" items={ctx.personas} />
                <List title="Pain points" items={ctx.painPoints} />
                <List title="Value propositions" items={ctx.valueProps} />
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-[12px] font-semibold text-slate-900">Proof points</h3>
                        <span className="ml-auto text-[11px] tabular-nums text-slate-400">{ctx.proofPoints.length}</span>
                    </div>
                    {ctx.proofPoints.length ? (
                        <ul className="mt-2 space-y-1.5">
                            {ctx.proofPoints.slice(0, 8).map((p) => (
                                <li key={p.claim} className="text-[12px] text-slate-700 leading-snug">
                                    {p.claim}{" "}
                                    <span className="text-[10.5px] text-slate-400">
                                        {ctx.documents.find((d) => p.sourceRef.startsWith(`doc:${d.id}`))?.filename ?? "source"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-[11.5px] text-slate-400">Upload a case study so emails can cite real results</p>
                    )}
                </div>
                <List title="Never say" items={ctx.prohibitedClaims} tone="red" empty="No restrictions found" />
                <List title="Approved claims" items={ctx.approvedClaims} />
                <List title="Objections" items={ctx.objections} />
                <List title="Competitors" items={ctx.competitors} />
            </div>

            <div className="mt-4 grid lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <h3 className="text-[12px] font-semibold text-slate-900">Voice profile</h3>
                    {v ? (
                        <>
                            {v.avgWords > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Pill tone="sky">{v.tone}</Pill>
                                    <Pill>~{v.avgWords} words</Pill>
                                    {v.greeting && <Pill>opens “{v.greeting}”</Pill>}
                                    {v.signoff && <Pill>signs off “{v.signoff}”</Pill>}
                                    {v.usesQuestionsInCta && <Pill>question CTA</Pill>}
                                </div>
                            )}
                            <ul className="mt-2 space-y-1">
                                {v.rules.map((r) => (
                                    <li key={r} className="text-[12px] text-slate-700">
                                        · {r}
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <p className="mt-2 text-[11.5px] text-slate-400">Upload sample emails or a brand guide to learn your voice</p>
                    )}
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <h3 className="text-[12px] font-semibold text-slate-900">Reference emails</h3>
                    <p className="text-[11.5px] text-slate-500">The engine matches their voice; it never copies them.</p>
                    {ctx.examples.length ? (
                        <ul className="mt-2 divide-y divide-slate-100">
                            {ctx.examples.map((e, i) => (
                                <li key={e.sourceRef} className="py-1.5">
                                    <button type="button" onClick={() => setOpen(open === i ? null : i)} className="w-full text-left text-[12px] font-medium text-slate-800">
                                        {e.subject || "(no subject)"}
                                    </button>
                                    {open === i && <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] text-slate-600">{e.body}</pre>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-[11.5px] text-slate-400">None yet</p>
                    )}
                </div>
            </div>
        </Section>
    );
}

function Documents({ documents, kinds }: { documents: KnowledgeDocument[]; kinds?: Record<DocumentKind, string> }) {
    const del = useDeleteDocument();
    const [open, setOpen] = useState<string | null>(null);
    return (
        <Section title="Documents" hint="Removing a document rebuilds the understanding layer without it.">
            {!documents.length ? (
                <Empty>No documents yet.</Empty>
            ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {documents.map((d) => {
                        const a = d.analysis;
                        const counts = a
                            ? [
                                  ["pains", a.painPoints.length],
                                  ["value props", a.valueProps.length],
                                  ["proof", a.proofPoints.length],
                                  ["personas", a.personas.length],
                                  ["emails", a.examples.length],
                              ].filter(([, n]) => Number(n) > 0)
                            : [];
                        return (
                            <div key={d.id} className="px-3 py-2.5">
                                <div className="flex items-center gap-3">
                                    <FileTextIcon className="size-4 text-slate-400 shrink-0" />
                                    <button type="button" onClick={() => setOpen(open === d.id ? null : d.id)} className="min-w-0 text-left">
                                        <div className="text-[12.5px] font-medium text-slate-900 truncate">{d.filename}</div>
                                        <div className="text-[11.5px] text-slate-500 truncate">
                                            {size(d.sizeBytes)}
                                            {d.pageCount ? ` · ${d.pageCount} pages` : ""}
                                            {counts.length ? ` · ${counts.map(([k, n]) => `${n} ${k}`).join(", ")}` : d.statusDetail ? ` · ${d.statusDetail}` : ""}
                                        </div>
                                    </button>
                                    <Pill className="ml-auto">{kinds?.[d.kind] ?? d.kind}</Pill>
                                    <StatusPill status={d.status === "ready" ? "connected" : d.status === "failed" ? "error" : "pending"} />
                                    <button
                                        type="button"
                                        aria-label={`Remove ${d.filename}`}
                                        onClick={() => {
                                            if (confirm(`Remove ${d.filename}? The understanding layer will be rebuilt without it.`)) del.mutate(d.id);
                                        }}
                                        className="text-slate-400 hover:text-rose-600"
                                    >
                                        <Trash2Icon className="size-4" />
                                    </button>
                                </div>
                                {open === d.id && (
                                    <div className="mt-2 ml-7 text-[12px] text-slate-600">
                                        {d.status === "failed" ? <p className="text-rose-700">{d.statusDetail}</p> : <p>{a?.summary}</p>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Section>
    );
}
