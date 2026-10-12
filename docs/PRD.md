# Pegasusbound: Product Requirements Document

**Product:** Pegasusbound, the self-learning cold outbound engine
**Owner:** Nikhil (Bridged)
**Status:** MVP built and verified locally; pre-launch
**Last updated:** 2026-10-12

---

## 1. Summary

Pegasusbound is a cold outbound platform that runs its own experiments. A user gives it context (a Company Brain over MCP, or uploaded documents), an audience (a CRM list over MCP, or a CSV) and hard limits, then approves a plan once. From then on the engine writes controlled email variants, sends them through the user's warmed mailboxes, reads every reply, decides with Bayesian statistics what is working, and writes each next email with what it learned. Learnings are kept in a unified memory layer that every future campaign starts from.

The promise: **approve once; it learns the rest.**

## 2. Problem

- Outbound teams guess. Copy is written once, sent to the whole list, and judged by gut feel or by noisy open rates.
- A/B testing by hand is slow, under-powered and rarely controlled (two variants differ in five things at once), so teams "learn" the wrong lessons.
- What one campaign learns is lost to the next. Knowledge lives in people's heads, not in the system.
- AI writing tools produce more email, not better email. They don't measure, don't remember and don't respect brand or claim rules.
- Many small teams don't have a structured knowledge base ("Company Brain"), so tools that depend on one can't start.

## 3. Goals and non-goals

**Goals**

1. Raise the rate of *qualified* positive replies and meetings, not opens or raw reply volume.
2. Make every experiment controlled (one variable at a time) and every decision explainable and reproducible.
3. Keep a durable, inspectable memory of what works (tone, format, angle, CTA, subject style, length, personalization) and apply it everywhere.
4. Start from whatever context the customer has: a Company Brain, uploaded documents, or both.
5. Run safely inside hard limits the user sets once: total prospects, batch sizes, daily caps, sending window, health thresholds.

**Non-goals (MVP)**

- Lead sourcing or data enrichment.
- Fully autonomous claim writing without sources: the engine only uses facts it can cite.
- Model fine-tuning or reinforcement learning on reply data (see Roadmap).

## 4. Users

| Persona | Need | What they do in Pegasusbound |
|---|---|---|
| Founder / solo seller | Pipeline without a sales team | Uploads docs, imports a CSV, approves once, reads the leads inbox |
| Head of Sales / RevOps | Repeatable, measurable outbound | Connects CRM and Company Brain, sets limits, reviews learnings and memory |
| SDR / AE | Fast follow-up on interest | Works the leads inbox; positive replies arrive as CRM tasks |
| Marketing / brand | Brand-safe messaging | Owns guidelines and "never say" rules in Memory |

## 5. User journey

1. **Sign up** and create a workspace (public self-serve sign-up).
2. **Connect a mailbox.** Warm-up, daily caps, working hours and deliverability checks apply automatically.
3. **Turn on Intelligence.** The workspace gets a scoped engine key.
4. **Give it context**, either way:
   - Connect a **Company Brain** over MCP, or
   - Upload **documents** (Knowledge page): ICP and personas, product docs, case studies, brand voice, competitor notes and a few sample emails or threads that worked. PDF, DOCX, Markdown, text, HTML and .eml are supported, or paste text directly.
5. **Connect a CRM** (Attio over MCP, OAuth) to pick audiences from lists and receive tasks and notes for positive replies. A CSV upload works without a CRM.
6. **Create an AI campaign:** objective, ICP, persona, offer, style, sender, timezone and sending window, plus hard limits.
7. **Review the plan once:** learning agenda, the first experiment and editable drafts. Approve.
8. **The engine runs:** it sends, observes, evaluates, scales or retires variants, writes challengers and updates memory. It notifies, but does not wait for approval, unless the user asked to approve new copy.
9. **Work the results:** leads inbox with full threads and reply classifications; email formats leaderboard; learnings; memory.

## 6. Functional requirements

### 6.1 Knowledge and context

**Company Brain (MCP).** The engine discovers the server's read-only tools, runs a bounded research loop (Claude with tool use, at most 14 turns) and distils a *knowledge brief*: product summary, approved and prohibited claims, pain points, proof points with source refs, persona insights, voice guidelines and gaps. Tool output is treated as untrusted data.

**Document upload (for teams without a Company Brain, or alongside one).**

| Requirement | Detail |
|---|---|
| Types | ICP & personas, Product, Case study, Email samples, Brand & voice, Competitors, Other |
| Formats | PDF (text layer), DOCX, MD/TXT, HTML, EML; or pasted text. Up to 7 MB per file through the dashboard |
| Parsing | Text extraction (PDF unwrapping of hard-wrapped lines), normalisation, paragraph chunking (~1,200 chars) for retrieval |
| Analysis | Per document: summary, ICP traits, personas, pain points, value props, proof points (each tied to a source chunk), approved and prohibited claims, objections, competitors, voice rules. Claude structured extraction in production; a deterministic heuristic analyser as fallback and in simulation |
| Email samples | Split into individual emails; a **voice profile** is learned (tone, average length, greeting, sign-off, question-style CTA, first-name use) and up to six examples are kept as style references ("match the voice, never copy") |
| Understanding layer | All ready documents are merged into one workspace context profile, de-duplicated, and rebuilt on every upload or delete |
| Standing memory | Voice rules become *guidelines* and prohibited claims become *avoid* entries (source: document), applied to every campaign; deleting a document removes them |
| Retrieval | Campaign-relevant sections are ranked (IDF-weighted keyword overlap with the campaign brief) and passed to research and writing with refs `doc:<id>#<chunk>` |
| Merge with Brain | When both exist, the Brain research is asked to confirm, extend or correct the document understanding; the final brief contains both |

**CRM (Attio over MCP).** OAuth connection; capability detection by tool name and shape; audiences from lists; on a positive reply, a task and note are written back.

### 6.2 Campaign planning

- The strategist proposes a **learning agenda** (angle → CTA → subject line → tone → format → length → personalization, reordered by value) and the first experiment: 2–3 variants that differ **only** in the variable under test.
- Every variant is tagged with traits on seven dimensions: tone, format, angle, CTA, personalization, subject style, length. Length and subject style are measured from the text, not self-reported.
- **Memory first:** proven principles become the baseline instead of being re-tested; principles proven in another segment transfer as the starting hypothesis and are verified for this persona.
- **Copy guard:** before any copy is frozen it is checked for prohibited claims, links, fake "Re:" subjects, length, and citations that don't exist in the knowledge brief.
- Variants are immutable (content-hashed); an edit creates a new version.

### 6.3 Sending

- Each experiment arm becomes a native platform campaign: steps (first email plus threaded follow-ups), stop-on-reply, text-only, the campaign's timezone and sending window, sender rotation by tags.
- Leads are enrolled idempotently; all calls carry idempotency keys derived from the request body.
- The platform enforces mailbox warm-up, daily caps, working hours, address verification (no-MX refusal), TLS-only SMTP, unsubscribe links and the suppression list.

### 6.4 Processing replies and events

- The platform writes campaign events (sent, reply, bounce, unsubscribe, complaint, meeting) to a durable Postgres outbox; the engine drains it with `FOR UPDATE SKIP LOCKED`.
- Every reply is classified into 11 categories (positive interest, meeting requested, referral, not now, four objection types, negative, unsubscribe, auto-reply) with a confidence; low-confidence or sensitive replies go to human review and don't count until reviewed.
- Out-of-office replies never stop a sequence; a human reply does.
- Unsubscribes and bounces are suppressed workspace-wide immediately.

### 6.5 Learning and decisions (deterministic, explainable)

The LLM never makes the decision; it only explains it.

| Technique | Use |
|---|---|
| **Beta-Binomial posterior** per variant (uniform Beta(1,1) prior) on positive replies / delivered | Rate estimate with uncertainty |
| **Monte Carlo P(best)** (20,000 seeded draws) | Probability each variant is truly the best; reproducible for the same counts |
| **90% credible intervals** | Shown on every variant and trait |
| **Staged batch sizes** (e.g. 90 → 100 → 120 → 150) | Sequential testing: only scale when evidence justifies it |
| **Scale rule** | P(best) ≥ 90% with ≥ minimum delivered per variant → declare winner (champion) and move up a stage |
| **Retire rule** | P(best) < 5% → retire the variant |
| **Practical equivalence** | After enough evidence with no winner, keep the leader as the baseline and test the next variable instead of burning budget |
| **Revise** | Zero positives across variants → fresh angles from reply evidence |
| **Health guardrails** | Bounce or unsubscribe/complaint rate above limits pauses the campaign for human review |
| **Champion / challenger** | The winner is frozen; one challenger changes exactly one untested variable |
| **Controlled vs observational evidence** | Only controlled wins (one differing trait) become principles; pooled cross-campaign trait stats are labelled observational |

### 6.6 Unified memory

- **Kinds:** principles (what works), guidelines (always follow), avoid (never do).
- **Sources:** experiment, Company Brain, uploaded documents, human.
- **Confidence:** preliminary → moderate (P(best) ≥ 95% and ≥ 40 delivered per arm) → strong (≥ 2 controlled tests, ≥ 60 per arm).
- **Scope:** global or per persona; stale observational entries retire automatically.
- Every plan and challenger receives the workspace playbook for its persona. Humans can add, edit and switch entries off.

### 6.7 Dashboard surfaces (Intelligence section)

| Screen | Contents |
|---|---|
| AI campaigns | Setup checklist (Intelligence on, mailbox, knowledge or Brain, CRM) and the campaign list |
| Best emails (workspace) | Every campaign's emails ranked by posterior positive-reply rate, the best of each crowned, plus each campaign's improvement from iteration 1 |
| Campaign · Best emails | Improvement curve per iteration (best email and whole batch), the iteration timeline with decisions, and every email ranked best to worst: delivered, positive, meetings, 90% credible range, P(best), traits, and a plain-language reason for its rank |
| New AI campaign | Brief, audience (CSV or CRM list), limits, timezone and sending window |
| Campaign overview | Plan and agenda, approval, editable drafts, experiments with P(best) bars and decisions, learnings, knowledge used |
| Leads & inbox | Every lead in the sequence with an inbox-style full thread (sent, follow-ups, replies, classification, meeting) |
| Email formats | Per-campaign and workspace leaderboards for each trait dimension |
| Knowledge | Upload, understanding layer, voice profile, reference emails, document list |
| Memory | Principles, guidelines, avoid; leaderboard; playbook preview per persona |
| Brain & CRM | MCP connections, capability checks, OAuth |

### 6.8 Brand and interface

- Pegasusbound identity: a violet-to-magenta wing mark, used for the logo, favicon and app icons, with a "Pegasus**bound**" gradient wordmark.
- Display type in Plus Jakarta Sans; interface type in Inter.
- One accent ramp (Pegasus violet) across the product; light and dark themes, following the OS by default.
- Sidebar grouped by job: **Intelligence** (AI campaigns, Best emails, Knowledge, Memory, Brain & CRM) first, then Outreach, Sending, Pipeline and Workspace, each with its own coloured section mark.

## 7. Architecture

```
Browser ─► Platform backend (Go) ─► Postgres (platform schema)
              │ /v1/intel/* proxy, HMAC-signed org/user identity (300 s skew)
              ▼
           Intelligence sidecar (Node/TypeScript, Hono) ─► Postgres (intel schema)
              │ jobs: plan, send, follow-up, evaluate, memory refresh, outbox drain
              │ Claude (research, writing, classification, document analysis)
              │ MCP clients: Company Brain, CRM
              ▼
           Platform campaigns + workers ─► user mailboxes
           Platform events ─► intelligence_event_outbox ─► sidecar
```

- **Tenancy:** every engine row is scoped to the platform organization; the sidecar trusts only backend-signed identities and checks permissions per route.
- **Secrets:** MCP and CRM credentials and per-workspace engine keys are encrypted at rest.
- **Reliability:** Postgres job queue with retries, at-most-once send claims, idempotent event ingestion.
- **Simulation mode:** a mock LLM and a mock sender with time scaling run the full loop for tests and demos.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Safety | Hard limits enforced by code; health pauses; suppression; unsubscribe in every email |
| Truthfulness | Claims only from cited sources; prohibited claims blocked by the copy guard |
| Privacy & compliance | GDPR/UK GDPR: DPA, sub-processor list, deletion on request; acceptable-use policy against purchased lists |
| Explainability | Every decision stores counts, posteriors and a rationale; every learning stores its evidence and limitations |
| Reproducibility | Seeded statistics; same counts always yield the same decision |
| Performance | Upload analysis under ~30 s for typical documents; evaluation within minutes of an observation window closing |

## 9. Success metrics

- **North star:** qualified meetings per 1,000 prospects contacted.
- Positive-reply rate lift from first experiment to current champion.
- Time to first confident winner (P(best) ≥ 90%).
- Share of new campaigns that start from memory (not from scratch).
- Health: bounce < 3%, unsubscribe + complaint < 1% of delivered.
- Activation: share of sign-ups that reach "approved" within one session; share starting from documents vs Brain.

## 10. Demo validation (simulation)

To measure the engine end to end, a demo workspace ("Nikhil · Bridged") ran on **dummy data**: 1,000 synthetic prospects at fictional publishers, a simulated sender and a hidden ground-truth reply model the engine never sees. Context came only from five uploaded documents (ICP, product PDF, case studies, brand voice, three sample emails). Six simulated weeks were run and laid out on a real timeline.

| Metric | Result |
|---|---|
| Prospects | 1,000 (synthetic) across 4 campaigns |
| Emails sent | 2,288 (incl. 1,408 threaded follow-ups) |
| Replies / positive / meetings | 315 / 123 positive / 35 meetings (19 qualified) |
| Iterations (experiments) | 11 evaluated, plus 1 planned from memory |
| Understanding layer from 5 documents | 7 ICP traits, 4 personas, 6 pain points, 12 value props, 8 cited proof points, 4 prohibited claims, voice profile from 3 sample emails |

**Improvement by iteration (best email's positive-reply rate):**

| Campaign | Iteration 1 | Best later iteration | Controlled winner |
|---|---|---|---|
| Audience leaders (360 prospects) | 16.7% | 25.0% (iteration 3) | Proof-led angle, P(best) 96.2% |
| Revenue leaders (320) | 17.2% | 21.1% (iteration 4) | Proof-led angle, P(best) 95.1% |
| Founders (200) | 10.3% | 15.9% (iteration 3) | Budget ran out before 90% confidence (leader at 86%) |

**What the engine learned and reused**

- Controlled principles written to memory: "proof" beat "pain" and "outcome" for audience leaders (13/60 vs 4/58 and 5/57) and for revenue leaders (16/103 vs 8/102).
- Observational avoid-list: outcome-led (7.4%) and pain-led (8.2%) angles were the weakest across campaigns.
- The fourth campaign (Product leaders) started from memory. It skipped the angle test and opened with a call-to-action experiment on a proof-led baseline.
- A safety rule paused one campaign in an earlier run when unsubscribes crossed the limit on a small first batch. That showed the guardrails work; batch sizes were then tuned.

These are simulation results that test the engine's capabilities, not real-world performance.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Small samples produce false winners | Bayesian P(best) thresholds, minimum delivered per arm, practical-equivalence rule, "preliminary" labels |
| Deliverability damage | Warm-up, caps, verification, health pauses, suppression |
| Hallucinated claims | Source-cited proof only, prohibited-claim guard, document/Brain grounding |
| Prompt injection via Brain, documents or replies | All external text wrapped as untrusted data; tools are read-only |
| Lessons that don't transfer between personas | Persona-scoped memory; cross-segment principles are hypotheses to verify |

## 12. Roadmap

1. Learned reply-quality scorer and a reward model on accumulated outcomes; contextual bandits for allocation within batches.
2. Meeting-quality feedback from CRM stages (qualified pipeline, not just booked calls).
3. Per-prospect personalisation from research tools, measured as its own trait.
4. More CRMs (HubSpot, Salesforce) and Brain connectors.
5. OCR for scanned PDFs; Google Docs/Notion import.

## 13. Open decisions

- Pricing and plan limits.
- Marketing site and documentation copy.
- Name of the in-app assistant.
- Production domain and launch date.
