import { useEffect, useState } from "react";
import toast from "react-hot-toast/headless";
import { Page, PageBody, PageTopbar } from "@/components/layout/Page";
import { Btn, Field, Pill, Section, StatusPill, errorText, inputCls } from "@/components/app/intelligence/parts";
import { useCheckConnection, useIntelSetup, useRemoveConnection, useSaveConnection, type ConnectionSummary } from "@/lib/api/intel";

const KINDS = [
    {
        kind: "brain" as const,
        title: "Company Brain",
        blurb: "Your knowledge base over MCP: product facts, ICPs, case studies, approved and prohibited claims, brand voice. Read before any email is written; learnings are written back when the server allows it.",
        defaultUrl: "",
        defaultAuth: "bearer" as const,
        required: ["search"],
    },
    {
        kind: "crm" as const,
        title: "CRM (Attio)",
        blurb: "Pick audiences from your Attio lists, and get a task plus a note in Attio for every positive reply. Attio's hosted MCP signs in with OAuth.",
        defaultUrl: "https://mcp.attio.com/mcp",
        defaultAuth: "oauth" as const,
        required: ["listLists", "listEntries"],
    },
];

export default function IntelConnectionsPage() {
    const setup = useIntelSetup();
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("connected")) toast.success("Signed in. Connection verified.");
        if (params.get("error")) toast.error(`Sign-in failed: ${params.get("error")}`);
    }, []);
    return (
        <Page>
            <PageTopbar eyebrow="Brain & CRM" subtitle="Connect once over MCP. The engine checks each server's tools and tells you if anything is missing." />
            <PageBody>
                <div className="grid lg:grid-cols-2">
                    {KINDS.map((k, i) => (
                        <ConnectionCard key={k.kind} spec={k} conn={setup.data?.[k.kind] ?? null} border={i === 0} />
                    ))}
                </div>
                <Section title="Sending" hint="AI campaigns send through this workspace's mailboxes with their warm-up, daily caps, unsubscribe handling and suppression list.">
                    <a href="/app/emails" className="text-[12.5px] font-medium text-sky-700 hover:text-sky-900">
                        Manage mailboxes →
                    </a>
                </Section>
            </PageBody>
        </Page>
    );
}

function ConnectionCard({ spec, conn, border }: { spec: (typeof KINDS)[number]; conn: ConnectionSummary | null; border: boolean }) {
    const save = useSaveConnection();
    const check = useCheckConnection();
    const remove = useRemoveConnection();
    const [url, setUrl] = useState(conn?.url ?? spec.defaultUrl);
    const [authType, setAuthType] = useState<"none" | "bearer" | "oauth">(conn?.authType ?? spec.defaultAuth);
    const [token, setToken] = useState("");
    useEffect(() => {
        if (conn) {
            setUrl(conn.url);
            setAuthType(conn.authType);
        }
    }, [conn]);

    const after = (r: { status: string; authUrl?: string; error?: string; missing?: string[] }) => {
        if (r.status === "needs_auth" && r.authUrl) window.location.href = r.authUrl;
        else if (r.status === "connected") toast.success("Connected");
        else toast.error(r.error ?? (r.missing?.length ? `Missing: ${r.missing.join(", ")}` : "Couldn't connect"));
    };

    return (
        <Section
            title={
                <span className="flex items-center gap-2">
                    {spec.title} {conn && <StatusPill status={conn.status} />}
                </span>
            }
            hint={spec.blurb}
            className={border ? "lg:border-r" : ""}
        >
            {conn && (
                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-[12px]">
                    <div className="break-all font-mono text-[11px] text-slate-600">{conn.url}</div>
                    {conn.statusDetail && <div className="text-slate-600">{conn.statusDetail}</div>}
                    {conn.capabilities && (
                        <div className="flex flex-wrap gap-1">
                            {Object.entries(conn.capabilities).map(([cap, tool]) => (
                                <Pill key={cap} tone={tool ? "green" : spec.required.includes(cap) ? "red" : "neutral"}>
                                    {cap}
                                    {tool ? ` → ${tool}` : " · missing"}
                                </Pill>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2 pt-1">
                        <Btn disabled={check.isPending} onClick={() => check.mutate(conn.id, { onSuccess: after, onError: (e) => toast.error(errorText(e)) })}>
                            {conn.status === "needs_auth" ? "Sign in" : "Re-check"}
                        </Btn>
                        <Btn variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(conn.id, { onError: (e) => toast.error(errorText(e)) })}>
                            Disconnect
                        </Btn>
                    </div>
                </div>
            )}
            <form
                className="space-y-3"
                onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate(
                        { kind: spec.kind, url, authType, token: authType === "bearer" ? token : undefined },
                        { onSuccess: after, onError: (err) => toast.error(errorText(err)) },
                    );
                }}
            >
                <Field label="MCP server URL">
                    <input className={inputCls} required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
                </Field>
                <Field label="Authentication">
                    <select className={inputCls} value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)}>
                        <option value="oauth">OAuth sign-in</option>
                        <option value="bearer">API token</option>
                        <option value="none">None</option>
                    </select>
                </Field>
                {authType === "bearer" && (
                    <Field label="API token" hint="Stored encrypted, used only by the engine.">
                        <input className={inputCls} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
                    </Field>
                )}
                <Btn type="submit" variant="primary" disabled={save.isPending}>
                    {conn ? "Replace connection" : "Connect"}
                </Btn>
            </form>
        </Section>
    );
}
