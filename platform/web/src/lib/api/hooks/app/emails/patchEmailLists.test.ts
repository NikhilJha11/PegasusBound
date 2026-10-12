import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import patchEmailLists from "./patchEmailLists";
import type Inbox from "@/lib/api/models/app/emails/Inbox";

const row = (id: string, name = id) => ({ id, name, email: `${id}@x.test` }) as unknown as Inbox;

describe("patchEmailLists", () => {
    it("patches the paginated list and the flat directory without crashing on either shape", () => {
        const qc = new QueryClient();
        qc.setQueryData(["emails", "list", "", "", 20], {
            pages: [{ data: [row("a"), row("b")], pagination: { has_more: false } }],
            pageParams: [null],
        });
        qc.setQueryData(["emails", "list", "directory"], [row("a"), row("b")]);

        patchEmailLists(qc, (rows) => rows.map((c) => (c.id === "a" ? row("a", "renamed") : c)));

        const list = qc.getQueryData<{ pages: { data: Inbox[] }[] }>(["emails", "list", "", "", 20]);
        expect(list?.pages[0].data.map((c) => c.name)).toEqual(["renamed", "b"]);
        const dir = qc.getQueryData<Inbox[]>(["emails", "list", "directory"]);
        expect(dir?.map((c) => c.name)).toEqual(["renamed", "b"]);
    });
});
