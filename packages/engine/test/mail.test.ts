import { describe, expect, it } from "vitest";
import { isBounce, referencedIds, stripQuoted } from "../src/senders/smtp";
import { capacityFor } from "../src/senders/mailboxes";
import { createSessionToken, readSessionToken } from "../src/auth";
import { derivedTraits, dimensionForVariable } from "../src/memory";

const ID = "<iole.0b6f3a1e-1111-4222-8333-944455556666.1@acme.example>";

describe("inbound mail parsing", () => {
  it("finds our message ids in headers and bounce bodies", () => {
    expect(referencedIds({ inReplyTo: ID, references: undefined }, "")).toEqual([ID.toLowerCase()]);
    const raw = `Delivery failed.\n\nMessage-ID: ${ID}\n`;
    expect(referencedIds({ inReplyTo: undefined, references: undefined }, raw)).toEqual([ID.toLowerCase()]);
    expect(referencedIds({ inReplyTo: "<other@x.com>", references: ["<foo@bar>"] }, "")).toEqual([]);
  });

  it("strips quoted history from replies", () => {
    const text = "Sounds good, Tuesday works.\n\nOn Mon, 3 Mar 2026 at 10:00, Nikhil <n@x.com> wrote:\n> Hi Ava,\n> ...";
    expect(stripQuoted(text)).toBe("Sounds good, Tuesday works.");
  });

  it("detects bounces", () => {
    const headers = new Map<string, unknown>();
    expect(isBounce({ from: { value: [{ address: "MAILER-DAEMON@google.com", name: "" }], html: "", text: "" }, subject: "Delivery Status Notification (Failure)", headers } as never)).toBe(true);
    expect(isBounce({ from: { value: [{ address: "ava@org.example", name: "" }], html: "", text: "" }, subject: "Re: hello", headers } as never)).toBe(false);
  });
});

describe("mailbox warm-up", () => {
  it("ramps from 5/day up to the limit", () => {
    const mb = { warmup: true, dailyLimit: 40, warmupStartedAt: new Date("2026-01-01T00:00:00Z") } as never;
    expect(capacityFor(mb, new Date("2026-01-01T12:00:00Z"))).toBe(5);
    expect(capacityFor(mb, new Date("2026-01-06T12:00:00Z"))).toBe(15);
    expect(capacityFor(mb, new Date("2026-03-01T00:00:00Z"))).toBe(40);
  });
});

describe("sessions", () => {
  it("round-trips and rejects tampering", () => {
    const t = createSessionToken("owner@example.com");
    expect(readSessionToken(t)).toEqual({ email: "owner@example.com" });
    expect(readSessionToken(t.slice(0, -2) + "xx")).toBeNull();
  });
});

describe("traits", () => {
  it("measures length and subject style", () => {
    expect(derivedTraits("Quick question?", "one two three")).toEqual({ length: "short", subjectStyle: "question" });
    expect(dimensionForVariable("subject line")).toBe("subjectStyle");
    expect(dimensionForVariable("messaging angle")).toBe("angle");
    expect(dimensionForVariable("call to action")).toBe("cta");
  });
});
