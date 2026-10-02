# Context Pack — WeAreDevelopers x BAND: AI Dark Factory (hackathon edition)

> **Chosen track: 💸 pocketful (wallet & payments).**
>
> **Purpose of this file:** background context for a *planning / advisory* agent that helps the team decide on track, factory design, and execution plan.
> **This file is NOT a seat mandate.** Do not load it into any BAND seat's standing instructions — it contains track-specific detail, which disqualifies the entry if it appears in a mandate (see §6.1).
>
> **Source of truth:** `OFFICIAL_SOURCES.md` (verbatim participant guide + full pocketful specs + banned mandate vocabulary, repo commit `803560d`, 2026-09-26). This file is a summary; when they differ, the official file wins. Always paste the **full** stage spec into the room, never this summary.
>
> Sources (fetched 2026-10-02):
> - https://lablab.ai/ai-hackathons/wearedevelopers-hackathon
> - https://www.band.ai/hacker-guide
> - https://docs.band.ai/band-desktop (formerly `docs.band.ai/jam`)
> - https://github.com/band-ai/dark-factory-wearedevs (kickoff package; `docs/participant-guide.md` is authoritative)

---

## 1. Key facts

| Item | Value |
|---|---|
| Name | WeAreDevelopers x BAND present: Dark Factory (hackathon edition) |
| Organizers | BAND (presenter), WeAreDevelopers World Congress North America, lablab.ai |
| Format | Fully online, global, free |
| Build window | Sep 26 – Oct 5, 2026 · Kickoff 09:00 PDT · **Close Oct 5, 23:59 PDT** (= **Oct 6, 13:59 Vietnam time, UTC+7**) |
| Team size | 1–6 people |
| Prize pool | $6,000 cash across 2 tracks (+ $300 Featherless credits for first winning team) |
| Platforms to join | lablab.ai (enroll) + lablab Discord + BAND Discord |
| Detailed spec | In the starter repo: `pocketful/spec/stage-1..4.md` (summary in §4). Limits: 2 vCPU, 2 GiB, 50 concurrent requests, 5 s/request |
| Starter repo | https://github.com/band-ai/dark-factory-wearedevs (commit `803560d`, 2026-09-26). Clone it to run the harness; do **not** submit into it |
| Bonus | Sign-ups are eligible for a free ticket to WeAreDevelopers World Congress NA (San Jose, Sep 23–25) |

---

## 2. The challenge

Build a **software factory** in **BAND Desktop**: a team ("band") of coding agents that
1. plans work,
2. implements it,
3. hands off evidence,
4. independently checks its own results.

Then use the factory to ship a **clean-room clone** of a well-known product. A human gives the job and decides whether to accept the result.

**What you submit = the factory + the run that produced the result + the result.**

Structure: 2 tracks, **4 graded stages**, 1 week. The factory must be able to build a service, repair failures, and extend what it built without breaking existing work.

### 2.1 Chosen track: 💸 pocketful

A clean-room clone of a wallet & payments app (like Venmo): people hold money in a wallet, send it by handle, request money, and split bills. Payments appear in a public/private activity feed. Competition is only against other pocketful teams.

The spec forbids using source code, API docs or schemas from existing products in this domain.

---

## 3. Official starter repo (kickoff package)

Repo: https://github.com/band-ai/dark-factory-wearedevs — **`docs/participant-guide.md` is the authoritative rulebook** and overrides the lablab page where they differ.

| Path | Content |
|---|---|
| `docs/participant-guide.md` | Rules, schedule, gates, rubric, step-by-step instructions |
| `pocketful/spec/stage-1.md` … `stage-4.md` | Full written spec per stage (all 4 released at kickoff) |
| `pocketful/test/` | **Part** of each stage's tests (rest held back for judging) |
| `toy/` | Unscored practice track (shared counter): full tests + 3 sample mandates (coordinator, implementer, reviewer) |
| `scaffold/` | Minimal Python service, used only by the toy walkthrough |
| `harness/` | `python -m harness` CLI: builds stage folders, runs checks, offline submission check |

The submitted result is a **separate** repo the band builds — nothing goes into the kickoff repo.

### 3.1 Stage overview (both tracks)
| Stage | Builds | Graded by |
|---|---|---|
| 1 | JSON API: idempotent writes, atomic multi-item ops, state export/import | API conformance |
| 2 | Browser UI, richer resource model, recovery from stale state & lost responses | API + Playwright, plus stage 1 |
| 3 | State over time: corrections effective at a point in time, truthful history | API, upgrades, concurrent writes, plus 1–2 |
| 4 | Atomic changes to many existing records without breaking history | Own suite + populated-state upgrades, plus 1–3 |

### 3.2 Shipped test coverage (pocketful) — the rest is hidden
| Stage | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Shipped | 79% | 35% | 9% | 16% |

---

## 4. Pocketful spec summary

> This is a condensed summary for planning. The full spec text must be pasted into the room for each stage — this summary is not a substitute.

### 4.1 Global constraints (all stages)
- Deliver: HTTP service + `Dockerfile` + `RUN.md` per stage folder. **Any language/framework/storage.** Judges only talk HTTP to the container.
- Listen on `0.0.0.0:$PORT` (default 8080). Single container; Compose is ignored.
- Limits: **2 vCPU, 2 GiB RAM, healthy within 60 s, up to 50 concurrent requests, 5 s per request (10 s for reset), no outbound network at runtime** (allowed during `docker build`), ephemeral disk.
- All runtime assets (fonts, JS, CSS) must be inside the image.
- No 5xx ever, including under concurrent load.
- JSON everywhere; RFC 3339 timestamps with offset; unknown fields/query params ignored; IDs opaque, ≤64 chars.
- Passwords must be hashed (bcrypt/scrypt/Argon2). Bearer tokens never expire; multiple sessions allowed.
- Error body: `{"error": {"code": "...", "message": "..."}}` with spec-defined status + code.

### 4.2 Stage 1 — payments and settlements (API only)
**Core invariants:** (1) sum of balances always equals the total seeded by the last reset; (2) no balance negative, even transiently; (3) a request moves money at most once.
- One currency per service, declared in fixture; `minor_units` is 0, 2 or 3 (JPY, EUR, BHD). All amounts are exact integers of minor units; max 1,000,000,000 per request. `1000`, `1000.0`, `1e3` are equal; strings/booleans invalid.
- No deposits/top-ups/withdrawals: money only moves between existing wallets.
- Test endpoints (no auth): `GET /health`, `POST /_test/reset` (replace all state with fixture → 204), `GET /_test/export`, `POST /_test/import` (atomic replacement; must preserve tokens, password hashes, idempotency records, original responses; no regeneration of IDs/timestamps).
- Auth: `POST /auth/signup`, `POST /auth/login`. Signup derives the handle from the email local part (lowercase, non-`[a-z0-9_]` → `_`, max 20 chars); collisions → `409 handle_taken`.
- API: `GET /me`, `POST /payments`, `POST /requests`, `POST /requests/{id}/pay|decline|cancel`, `GET /requests`, `POST /splits`, `GET /activity`, `POST /settlements` (operators only).
- Request states: `pending` → exactly one of `paid` / `declined` / `cancelled`. A request may exceed the payer's balance (stays pending; paying while short → 409).
- Feed rule: a payment is visible iff it is `public` OR the caller is a party. Requests are never in the feed.
- **Idempotency** (5 write paths: payments, requests, pay, splits, settlements): `Idempotency-Key` header, scoped per user; same method+path+JSON body → 200 with identical original body; different body → 409; key reused after a 4xx counts as first use; concurrent identical requests → exactly one 201, effect once. Claimed key is resolved before field validation.
- **Split rounding:** shares are whole minor units, sum exactly to amount, differ by ≤1; extra units go to the first participants in the given order (1000/3 → 334, 333, 333; 1/3 → 1, 0, 0). One request per participant except the caller; zero shares still create a request.
- **Settlements:** operators (from fixture `settlement_operator_ids`) submit 1–32 transfers; affordability is judged on each wallet's **net** result; all-or-nothing; members share one `committed_at`.

### 4.3 Stage 2 — wallet UI and payment authorizations
- Routes: `/`, `/requests`, `/split`, `/signup`, `/login`, `/authorizations`. Same path serves HTML for `Accept: text/html`, JSON otherwise.
- Many required `data-testid` attributes (listed in spec). Amounts formatted as `100.00 EUR` / `1200 JPY`; inputs accept decimals and reject excess precision (e.g. `15.005`) without sending.
- Product quality: calm, trustworthy consumer-finance look; consistent visual system; usable at 375 px and desktop without horizontal scroll; labels, focus, contrast; empty/loading/error states.
- Resilience: resubmitting an unchanged pay form must not pay twice; latest refresh wins over out-of-order responses; a lost response shows an "uncertain" state and retries with the same key and body; refused actions refresh stale data.
- Upgrade: stage-2 service must import a stage-1 export; signed-in browsers stay signed in; pending retries stay valid.
- **Authorizations (holds):** reserve money now, capture later (full, partial, or multiple non-final captures). `available = total − held` never negative; `balance == total`; insufficient-funds checks now use `available`. Holds expire at `expires_at` (must be reflected even with no request at the deadline). New write paths: authorizations, captures (7 idempotent paths total). Void by payer only; capture by receiver only.
- Concurrent operations must be serializable (equivalent to some one-at-a-time order).

### 4.4 Stage 3 — statements and payment corrections
- `GET /me?as_of=<instant>`: historical balance (inclusive at the instant).
- `GET /statement?from&to&limit&offset`: half-open window, oldest first, each entry with `delta` and `balance_after`; opening + deltas = closing regardless of pagination; first response returns a `snapshot` token for stable paging even after later writes.
- **Bitemporal history:** each payment has immutable revisions with `effective_at` (when money took effect) and `recorded_at` (when the service learned it). `known_at` query selects the latest revision recorded at or before that instant.
- Corrections by the original sender with `expected_revision` (optimistic concurrency → `409 stale_revision`); difference moves between the same two wallets; rejected if unaffordable now or if any historical balance would go negative at any effective-time boundary.
- Settlement members and captures cannot be corrected individually. Historical holds must be reconstructable in `as_of`/`known_at` views.
- Must import stage-1 and stage-2 exports.

### 4.5 Stage 4 — refunds and batch corrections
- Refunds by the original receiver from **available** funds; cumulative refunds ≤ current corrected amount; refunds of refunds are invalid; refunds never reopen requests or holds.
- Batch corrections by operators: 1–32 distinct payments, atomic; correcting any settlement member requires including **every** member with identical effective instants; defined error precedence; all revisions share one `recorded_at`.
- 10 idempotent write paths total. Old snapshots keep paging frozen entries. Must import stage 1–3 exports.

---

## 5. Prizes

pocketful track: 🥇 $1,500 · 🥈 $1,000 · 🥉 $500 (same amounts in the other track).

- A place is awarded only if the track has enough eligible entries: ≥1 for 1st, ≥4 for 2nd, ≥6 for 3rd. Unawarded prizes are not redistributed.
- Featherless prize: $300 credits to the first winning team (track TBA).
- Winners may be published as case studies: task, band, key design decision, verified result, cost, limitation.
- Prize distribution may take up to 90 days. Submissions must be original and MIT-compliant.

---

## 6. Rules, gates and judging (from the participant guide)

### 6.1 The three rules that decide most entries
1. **Hand-built code does not count.** A stage counts only if its passing code came out of the band's collaboration in the room. The room log is the proof.
2. **Code written to the tests disqualifies the entry** (enforced after close). Shipped tests are only for wiring up; build to the spec. A green run on shipped checks is not evidence of a stage — ask "what did the shipped checks never ask?"
3. **Mandates must be generic.** No endpoint paths, field names, error codes or test ids. `harness check` scans `mandates/` against a track vocabulary list generated from the specs (identifier-shaped tokens like `/path`, `snake_case`, `kebab-case`). Ordinary words (amount, balance, handle, status) are fine. The pocketful list has 146 tokens and includes easy-to-miss ones such as `not_found`, `validation_failed`, `payment_id`, `minor_units`, `expires_at`, `/payments`, `/split`, `data-status` — full list in the official sources file §G. Safest rule: no `/paths`, `snake_case` or `kebab-case` identifiers in mandates at all.

### 6.2 Four gates — fail any one and the entry is not ranked
1. ≥3 distinct Band Desktop seat identities you configured, each with a mandate file named after the seat that names the seat's harness and model.
2. Room log shows messages **between at least two of your own seats**, addressing each other by `@handle`, with a reply in each direction.
3. `stage-1/` builds and serves from a clean container by following its `RUN.md`.
4. Mandates are generic, and code is written to the spec, not the tests.

### 6.3 Rubric
| Weight | Criterion | What judges look for |
|---|---|---|
| **50%** | **Factory** | **Generic** mandates; **effective** (how far through 4 stages, incl. what shipped checks never asked); **reusable** — `FACTORY.md` + `mandates/` enough to stand it up, explain design choices, measured time and model spend, how bad work is caught and recovered |
| **25%** | **App** | Coherent, presentation-ready, responsive UI, clear in the states the stage-2 spec names, over maintainable code |
| **25%** | **Agent Teamwork** | **Collaboration:** more than one seat did the work, review changed something, handoffs carried the whole task, code traces to the room. **Autonomy:** in the submitted run, the per-stage task is the only human input — no steering, approvals, debugging hints or reruns |

Not scored: chat volume, seat count, prompt length. One seat doing 90% of the work looks bad however many messages it sends. Manufactured conflict is worth nothing; correct work accepted first time loses nothing.

### 6.4 Stage chaining
- Each `stage-N/` is a complete service holding the solution to **that** stage only. `stage-2/` = `stage-1/` copied forward and extended, etc. Delete any `.git` inside copied folders.
- A folder is graded against every suite up to N; it counts only if it passes **≥50% of each** suite.
- **Overshoot rule:** a folder that also passes the whole next-stage suite claims nothing.
- **The chain is what scores:** a folder counts only if all earlier folders count.
- Submit only completed stages. `stage-1/` is mandatory (gate 3).

### 6.5 The submitted run ("dark-factory run")
- Iterate freely while developing (you may step in). Then run the chosen factory in a **fresh room and fresh result repo** — only that run is judged for teamwork.
- From dispatch to the coordinator's final report: no seat may ask the human anything or wait for a reply. Blockers are recorded as the stage outcome.
- You may dispatch stages one by one or all at once, but send **nothing** between dispatches ("looks good, continue" = steering; re-dispatching = rerun).
- Handoffs must paste the **complete** task and spec; "read the room" or a message id is not a handoff. Coordinator must add all seats to the room before the first handoff.
- Implementer posts the full committed revision; reviewer independently runs checks.
- Keep Git history as the seats made it — no amend/rebase/squash; don't commit into `stage-N/` yourself.

---

## 7. Submission

### 7.1 Result repository layout
```text
your-repo/
  README.md      team, track, how to read the repo (written by you)
  FACTORY.md     seats, design choices, what failed, measured costs/time, failure handling
  mandates/      one .md per seat, named after the seat (e.g. reviewer.md),
                 first lines:  Harness: Claude Code
                               Model: <exact model id>
  room.json      full room download, unedited
  stage-1/ … stage-4/   each: Dockerfile, RUN.md, source
```
- Mandate file names must match each seat's display name in the room after lowercasing and stripping non-alphanumerics ("Delivery Manager" → `delivery-manager.md`). Every agent that speaks in the room needs a mandate.
- `room.json` must be a **full** download with ≥3 agent senders; gate 2 counts only real text messages where seats `@mention` each other both ways (mentions inside tool output don't count).
- No submodules or symlinks. Public GitHub repo, cloneable without Band membership.
- Submit on lablab: repo URL + presentation + video. **The video must show the factory working**: the room, a handoff between seats, and the result.

### 7.2 Recording the room
Band Desktop → room `⋮` → **Open in Band** → console room `⋮` → **Download → Download full session** (not "filtered") → save unchanged as `room.json`. It is **not redacted**: check for secrets; if one leaked, rotate it and replace with `[REDACTED]`.

### 7.3 Harness commands
```sh
# setup (Python 3.12+, Docker running; on Windows use WSL2)
python3 -m venv .venv && . .venv/bin/activate
python -m pip install -r harness/requirements.txt
python -m playwright install chromium

# check one stage (also runs earlier suites + next suite as overshoot probe)
python -m harness run --track pocketful --repo <abs>/band-work/result --stage 1 --out <abs>/band-work/checks/s1-01

# final check: isolated mode = no network, 2 vCPU, 2 GiB (how judging runs)
python -m harness run --track pocketful --repo <repo> --stage N --mode isolated --out <new-dir>
python -m harness run --track pocketful --repo <repo> --all --mode isolated

# offline submission check (gates 1, 2, mandate vocabulary, secrets, layout)
python -m harness check <repo> --track pocketful
```
Target line: `claimed stage: N on the shipped checks`. Every run needs a new `--out` directory.

### 7.4 Pre-submit checklist
1. Fresh clone → `harness check`. 2. `harness run --all --mode isolated` on the clone. 3. Follow each `RUN.md` by hand and use the UI. 4. Confirm the reciprocal `@handle` exchange in `room.json` and untouched Git history. 5. `README.md`/`FACTORY.md` are real. 6. Re-read mandates for track terms. 7. Scan for secrets. 8. Submit and keep the receipt.

### 7.5 Optional runtimes
- **Docker Sandbox seat** (needs Band Desktop ≥0.4.10, sbx ≥0.42; macOS 14+ Apple silicon, Windows 11, or Ubuntu 24.04+ with KVM): Settings → Experiments → Docker Sandboxes; create seat via **New local agent**, working dir = absolute result path.
- **OpenCode + Featherless seat:** config in `~/.config/opencode/opencode.json` (never in the repo), models e.g. `MiniMaxAI/MiniMax-M2.5`, `moonshotai/Kimi-K2.5`, `deepseek-ai/DeepSeek-V3.2`; run `OpencodeAdapter` with `approval_mode="auto_accept"`, `turn_timeout_s=900`. Not sandboxable.

### 7.6 Practice on the toy first
Run the full loop on `toy/` (shared counter, full test suite shipped) including `room.json` + `harness check` — it rehearses gates 1 and 2. Sample mandates in `toy/mandates/` are minimal templates (they start with empty `Harness:`/`Model:` lines and enforce "never ask the human").

### 7.7 Help
BAND Discord for Band Desktop, seats, harness and **spec ambiguities** (answers shared publicly). lablab Discord for registration, uploads, prizes.

---

## 8. BAND platform — essentials

### 8.1 What BAND is
An interaction layer for AI agents: agents built on any framework join shared **chat rooms**, route work via `@mentions`, hand off, delegate, and recruit each other. Humans sit in the same rooms. Agents run on **your** infrastructure with **your** LLM keys; BAND only carries messages and context.

### 8.2 Core primitives
| Concept | Meaning |
|---|---|
| Agent | Definition (name, description, model, tools) you run yourself; reusable across rooms |
| Chat room | Shared space for messages/events; the coordination unit; context scoped here |
| `@mention` | Routing. **Agents only see messages they're mentioned in.** Humans see everything |
| Contact | Permission-controlled link between agents/users across accounts |
| Execution | Isolated runtime of one agent in one room |
| Peer vs participant | Peer = can be invited; participant = currently in the room |

### 8.3 Platform tools (auto-exposed to the LLM via adapters)
`band_send_message`, `band_send_event`, `band_add_participant`, `band_remove_participant`, `band_get_participants`, `band_lookup_peers`, `band_create_chatroom`. Contact tools are opt-in (`capabilities={Capability.CONTACTS}`), only needed across accounts.

### 8.4 Free tier
No card. Up to **10 agents**, full Agent API + WebSocket, all `band_*` tools, multi-agent rooms. Memory API and Human API are Enterprise-only.

### 8.5 SDK
- Python: `pip install "band-sdk[<extra>]"` → import as `band`. TypeScript: `@band-ai/sdk` (Python is more mature).
- Extras: `langgraph`, `anthropic`, `crewai`, `pydantic-ai`, `claude_sdk`, `agno`, … (combinable).
- Pattern: build adapter → `Agent.create(adapter, agent_id, api_key)` → `await agent.run()`.
- Credentials: per-agent block in `agent_config.yaml`; LLM keys in `.env`. Git-ignore both.
- **Coding-agent adapters:** `ClaudeSDKAdapter` (Claude Code), `CodexAdapter` (Codex CLI), `OpencodeAdapter`, `CopilotSDKAdapter` / `CopilotACPAdapter`.
- Load mandate into adapter's `custom_section` (e.g. `Path("prompts/planner.md").read_text()`), set `cwd` to the repo.

### 8.6 Gotchas
- **One live WebSocket per `agent_id`.** Every seat needs its own registration, UUID, API key.
- Don't name agents "Assistant", "AI", "Bot", "Agent" — LLMs read them as role tokens.
- Keep execution events **on** while recording (don't pass `emit=()`): tool calls/results become visible evidence in the room. `Emit.THOUGHTS` works on Agno, Claude SDK, Codex, Copilot SDK.
- Agent restarts rehydrate history via `/context`.

---

## 9. BAND Desktop (formerly Jam)

- Desktop app (macOS / Windows / Linux) = coordination & oversight surface: connected agents, rooms, work items, ownership, swim lanes, activity, usage, decision requests.
- **It does not run the models.** Coding agents run as headless processes in your environment.
- Components: Desktop app · `band` CLI · `jamd` daemon (state in `~/.jam`) · `band-peer` Claude Code plugin.
- Prereqs: BAND account + **Claude Code installed and signed in** (default path).
- Setup flow: install app → *Sign in with browser* → readiness checks (CLI on PATH, `band-peer` plugin) → restart Claude Code or `/reload-plugins` → **Recheck**.
- First agent: in Claude Code run `/jam` then e.g. "Start a Band Desktop session as the architect for this project." Architect creates the room and invites others.
- Add roles: one Claude Code window per role (developer, tester, reviewer…), ask each to join the same collaboration.
- Reattach after restart: "Reattach this session to the existing architect peer."
- Linux + Wayland + NVIDIA: `WEBKIT_DISABLE_DMABUF_RENDERER=1 band-desktop`, or switch to X11.

---

## 10. Collaboration patterns (from BAND hacker guide)

| Pattern | Use when | BAND move |
|---|---|---|
| Assembly line | Clear stages, each enriches the last | Each agent `@mentions` the next |
| Panel | Disagreement is the value | Mention all specialists; synthesizer speaks last |
| Fan-out / fan-in | Many independent checks → one verdict | Coordinator mentions N checkers |
| Runtime recruit | Specialist depends on the case | `band_lookup_peers` → `band_add_participant` |
| Breakout room | Noisy subtask | `band_create_chatroom`, report summary back |
| **Critic overlay** | Output must survive scrutiny | Extra agent with **real veto** ("reply BLOCKED and name missing evidence"); coordinator treats block as terminal |
| One human gate | Consequential decision | Single agent owns escalation (note: this hackathon scores **autonomy** — no human input beyond the stage task) |
| Shared state machine | Long-running cases | Broadcast state; agents check state before acting |

**"Meaningful use" signals:** dependent handoff (next agent responds to the finding, not just the task) · runtime roster · enforced boundary · blockable verdict.
**Anti-patterns:** status-update spam · one process switching personas · your own orchestrator calling agents in turn · dashboard as the only deliverable.

**Recommended write-up (fits `FACTORY.md`):** the crew (agent, framework/model, one job each) · who talks to whom and who is deliberately excluded · one end-to-end flow on one line · "what breaks without the room".

Example mandate shape (generic — this style is allowed):
```
You are the planner for this repository.
Own: inspect the request and repository, write an ordered plan with one owner
and acceptance criteria per task.
Do not: edit files or claim tests passed unless you ran them.
Use: existing project structure and conventions; name validation commands.
Ask a person: when requirements conflict or a product decision is needed.
Done means: plan posted in the room, tasks assigned, open questions called out.
```
⚠️ For this hackathon, "Ask a person" conflicts with the autonomy score — a submitted run should need no human input after the stage task.

---

## 11. Partner resources

- **Featherless AI:** OpenAI-compatible serverless API, 30k+ open models (DeepSeek, Llama, Qwen, Mistral, Kimi). $25 per-request credits per participant, context up to 256K, first 1,000 participants; promo code emailed before kickoff. Signup needs a card — cancel before next billing cycle if not continuing.
- **Docker Sandboxes:** isolated, reproducible environments; useful for testing the "clean container, no outbound network" requirement. Docs: https://docs.docker.com/ai/sandboxes/ · BAND kit: https://docs.band.ai/integrations/sandboxes/docker-sbx-kit

---

## 12. Links

| Resource | URL |
|---|---|
| Hackathon page | https://lablab.ai/ai-hackathons/wearedevelopers-hackathon |
| Starter repo | https://github.com/band-ai/dark-factory-wearedevs |
| BAND account | https://app.band.ai/ |
| BAND Desktop docs | https://docs.band.ai/band-desktop |
| Hacker guide | https://www.band.ai/hacker-guide |
| Coding-agent setup | https://docs.band.ai/integrations/sdks/tutorials/coding-agents |
| SDK overview | https://docs.band.ai/integrations/sdks/overview |
| API reference | https://docs.band.ai/api/introduction |
| Docs index for agents | https://docs.band.ai/llms.txt |
| lablab rules | https://lablab.ai/hackathon-rules |
| BAND Discord | https://discord.com/invite/5YkNXmYfjk |
| lablab Discord | https://discord.gg/lablabai |

---

## 13. Open questions for the planning agent

0. Before planning, confirm nothing changed after commit `803560d`: run `git pull` in the kickoff clone and check BAND Discord for public spec clarifications.
1. Seat roster (≥3, each its own Band identity) and harness/model per seat; how to keep work distributed so no seat carries ~90%.
2. How the factory catches bad work without a human: reviewer runs `harness run` independently, plus its own tests derived from the **spec** (not the shipped tests) — especially for hidden checks (stage 2: 65%, stage 3: 91%, stage 4: 84% hidden).
3. Stack choice for the service (any language) that fits 2 vCPU / 2 GiB, serializable concurrency, and bitemporal history in stage 3–4 (e.g. embedded SQL DB with transactions).
4. How to measure and report time and model spend per stage for `FACTORY.md`.
5. Time budget: as of Oct 2, ~3.5 days to close (Oct 6, 13:59 UTC+7). Plan: toy rehearsal → develop factory on stage 1 → fresh submitted run → record room, write docs, video.
6. Workstation: harness needs Docker + Python 3.12+; on Windows run in WSL2.
