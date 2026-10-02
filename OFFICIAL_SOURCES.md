# Official sources — Dark Factory hackathon (verbatim, pocketful track)

> Verbatim copy of the official kickoff package so the planning/dev agent never has to re-fetch it.
> **These texts are authoritative.** If anything in `AGENT_CONTEXT.md` or `HACKATHON_GUIDE.vi.md` (summaries) disagrees with this file, this file wins.
>
> Source: https://github.com/band-ai/dark-factory-wearedevs — commit `803560d2a678ace1414465c098eb0ab5380ffade` (2026-09-26).
> License: Apache License 2.0 (copyright of the original authors; reproduced unmodified).
> Not included: tablekeeper track, test files (do not write code to the tests), harness source. You still need a local clone to run `python -m harness`.
>
> ⚠️ Not a mandate. Track-specific text must never go into a seat's mandate.

## Contents
- A. Participant guide (`docs/participant-guide.md`)
- B. Pocketful spec — stage 1 (`pocketful/spec/stage-1.md`)
- C. Pocketful spec — stage 2
- D. Pocketful spec — stage 3
- E. Pocketful spec — stage 4
- F. Toy sample mandates (`toy/mandates/*.md`)
- G. Banned mandate vocabulary for pocketful (`harness/vocabulary.py`)
- H. What `harness check` verifies (`harness/check.py`, paraphrased)


---

# A. Participant guide

## Participant guide

Everything you need to compete: what to build, when things happen, how to run your
band, and how to submit. This guide is the authoritative rules and instructions for
participants.

### What you build

A software factory in Band Desktop — a band of at least three distinct coding-agent
seats that plans work, implements it, hands off evidence and independently checks its
own results — and a service that factory builds. You give it a job and decide whether
to accept what comes back. What you submit is the factory, the room it worked in, and
the code it produced.

Pick one track and stay in it. You compete only against the track you chose.

| Track | You build | It's hard because |
|---|---|---|
| `tablekeeper` | a restaurant reservation system, an OpenTable | a table must never be double-booked, under concurrency, retries and time zones |
| `pocketful` | a wallet and payments app, a Venmo | money must never be created, destroyed or spent twice, under concurrent transfers, retries and rounding |

Both tracks follow the same four stages and the same rubric, each against its own written specification:

| Stage | What you build | Graded by |
|---|---|---|
| 1 | The JSON API: idempotent writes, atomic multi-item operations, and state export/import | API conformance |
| 2 | The browser UI, a richer resource model, and recovery from stale state and lost responses | API and Playwright, plus stage 1 |
| 3 | State over time: rules or corrections that take effect at a point in time, with past records that stay truthful | API conformance, upgrades and concurrent writes, plus stages 1 and 2 |
| 4 | Changes to many existing records at once, applied atomically without breaking history | Its own suite and populated-state upgrades, plus all three earlier ones |

**All four stages are released at kickoff.** There is nothing to wait for and nothing to
unlock. Work through them in order, because each one builds on the last.

#### What each track asks for

**`tablekeeper`** — diners search for a table at a time, book it, get a confirmation, and
can cancel or change it. Restaurants have tables of different sizes, opening hours and a
cancellation policy. Stage 1 already requires atomic, idempotent bookings and
all-or-nothing multi-booking moves through `POST /reservation-moves`. Stage 2 adds the
browser product — search and availability grid, booking, confirmation and lookup — with
recovery from stale state and lost responses, plus combined-table bookings. Stage 3 adds
manager-published, effective-dated policies: each booking retains the terms it accepted,
amendments adopt the applicable new terms, and history remains truthful. Existing bookings
can become recurring agreements whose occurrences keep independent identities and
exceptions. Stage 4 adds series amendments and a bounded, deterministic closure-replanning
problem, with a read-only preview and atomic application.

**`pocketful`** — people hold money in a wallet, send it to each other by handle, ask each
other for it, and split a bill so everyone pays their share. Payments land in an activity
feed, public or private. Five stage-1 write paths require an idempotency key; decline and
cancel do not. Deposits, top-ups and withdrawals are out of scope: money only moves
between existing wallets, and balances always sum to the seeded total. Atomic transfers,
exact split arithmetic and atomic net settlements are stage-1 requirements. Stage 2 adds
the browser product — balance and pay, activity feed, requests and splits — with recovery
from stale state and lost responses, plus holds, partial captures and their screen. Stage
3 adds immutable payment corrections, historical views separating when money moved from
when a correction became known, and snapshot-stable statement pagination and historical
hold accounting. Stage 4 adds refunds by the receiver from available funds, and operator
batch corrections that must include every member of a corrected settlement. Every amount
is an exact integer count of minor units.

`toy` is an unscored four-stage practice track with the same shape as the real ones. Run
it for easy practice — see [Practice on the toy](#practice-on-the-toy-example).

### Schedule

| PDT | What happens |
|---|---|
| Sat Sep 26, 09:00 | Kickoff. Both tracks, all four specs, part of each stage's checks, and the toy are released |
| Mon Oct 5, 23:59 | Submissions close |

### What makes an entry count

#### Eligibility

- At least three distinct coding-agent seats in Band Desktop, each with a mandate file
  that says which harness and model the seat runs. Seats may share a harness and a model.
- At least one complete output for stage 1.
- A submitted presentation, video and public GitHub repository as specified below. **The video shows
  your factory working** — the room, a handoff between seats, and the result it produced.
  A slideshow about the factory is not the same as the factory.

#### The three rules that decide most entries

- **Hand-built code does not count.** A stage counts only if the code that passes its
  tests came out of a collaboration in your Band Desktop room. However green your tests
  are, code you wrote by hand does not count. Your room event log is what shows the work was
  the band's.

- **Code written to the tests disqualifies the entry.** You get part of each stage's
  checks, not the full set of tests. That is enough to wire your service up, 
  but it's not meant to be a list of what will be run. Build to the specification, not the tests. 
  See [Do not write to the tests](#do-not-write-to-the-tests) — this is the rule most likely
  to cost a team its entry, and it is enforced after submissions close.

- **Your mandates must be generic.** A mandate says how a seat works — what it owns, how
  it hands off, when it rejects. It must not name anything specific to your track: no
  endpoint paths, field names, or error codes. **A mandate that
  names track-specific detail disqualifies the entry** — see
  [Your mandates must be generic](#your-mandates-must-be-generic).

#### Four gates. Fail any one and your entry is not ranked.

A failed gate is not a low score — it is a disqualified entry. `harness check` runs gates
1, 2 and the mandate half of gate 4 offline, so run it before you push.

1. Your roster lists **three or more distinct Band Desktop seat identities that you
   configured**, each with a mandate file named after that seat that names the seat's
   harness and model. 
2. Your room log shows messages exchanged **between at least two of your own seats**,
   each addressing the other by `@handle`, with a reply in each direction. 
3. `stage-1/` **builds and serves from a clean container** by following its `RUN.md`.
   Every other folder is judged the same way, but a folder that does not start costs
   that stage and the ones above it rather than the entry — see [Rubric](#rubric).
4. Your **mandates are generic** — they describe your factory, not this track — and
   your code is written to the spec rather than to the tests.

#### Rubric

Every entry that passes the gates is judged on three criteria. 

| Criterion | Weight | What judges look for |
|---|---|---|
| **Factory** | **50%** | **Generic:** another team could point your mandates at a different problem. **Effective:** how far through the four stages it got with code that meets the spec, including what the shipped checks never asked. **Reusable:** `FACTORY.md` and `mandates/` are enough to stand it up, and explain your design choices and what they cost, measured time and model spend, and how the factory catches and recovers from bad work |
| **App** | **25%** | What your factory built: a UI that is coherent, presentation-ready, responsive and clear in the states the stage-2 spec identifies, over code another developer could maintain |
| **Agent Teamwork** | **25%** | Your seats did the work together, and without you. **Collaboration:** the seats really shared the work — more than one seat did it, review changed something, handoffs carried the whole task, and the code traces to the room. **Autonomy:** in the run you submit, the task you dispatch for each stage is the only human input — no steering, approvals, debugging hints or reruns until it passed. Runs made while you developed the factory are not judged — see [Build and check each stage](#build-and-check-each-stage) |

We do not score chat volume, seat count or prompt length. What is read from the room log
is whether the work was **distributed** — one seat carrying 90% of it looks the same
however many messages it sent. Nor is manufactured conflict worth anything: a rejection
counts when it changed the work, and correct work that was accepted first time loses
nothing. [Agent Teamwork evidence](#agent-teamwork-evidence) says how to make sure the
evidence is there.

Use the presentation and video to explain your factory design, what it cost, a bad result
it caught, and the stage you reached. It does not replace `FACTORY.md`, which has to be
enough on its own for another team to stand your factory up.

### Prepare

Use Python 3.12+, Git, a running Docker daemon, a Band Desktop account, 
and your own model-provider access. All seats may use the same
runtime/model, but can also use different harnesses or models. 

Python is required here only to run the event harness. **Your submitted service may use
any language or framework.** Judges build your `Dockerfile` and communicate with the
container exclusively over HTTP. They do not import your source into Python or require
your compiler, interpreter, package manager or dependencies on the judge host. Install
everything your service needs while building the image and include its runtime in that
image. A TypeScript/Node, Go, Rust, Java or other implementation follows the same contract
and is judged the same way as a Python implementation.

Clone the kickoff repository, or extract the kickoff archive if you were given one.
Run commands below from its `dark-factory-wearedevs/` directory:

```sh
python3 --version                # use any Python 3.12+ interpreter
docker --version                 # the daemon must be running
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r harness/requirements.txt
python -m playwright install chromium
python -m harness --help
```

Use a Python 3.12+ interpreter to create the venv. If `python3` points to an older
version, substitute the command for your newer interpreter (for example, `python3.12` or
`python3.13`). Inside the venv, `python` is the right one.

On Linux, browser system libraries may also be needed: `python -m playwright install
--with-deps chromium`. Isolated checks install the browser inside Docker. On Windows, run
these steps inside WSL2.

Keep the result repository separate from the challenge package and factory inputs:

```sh
mkdir -p ../band-work/result/stage-1 ../band-work/checks
git -C ../band-work/result init -b main
git -C ../band-work/result config user.name "Your Name"
git -C ../band-work/result config user.email you@example.test
```

`../band-work/` is this guide's convention for everything you produce, kept beside the
extracted package. The harness does not know about it; every path is passed on the
command line; if you choose a different path - that's perfectly fine, just be aware 
that you'll have to modify that in the command line where needed.

`../band-work/result` is the convention for where the output of the factory resides. 
Give your agents its absolute path, not the relative one: a seat works in its own
sandbox, may not be able to resolve `../band-work`, and will otherwise create a repository only it
can see.

| Path | Holds |
|---|---|
| `../band-work/result` | the submission repository for your chosen track |
| `../band-work/checks` | the `harness run --out` directories you keep while iterating |

The graded repository starts empty deliberately so the event does not choose an
implementation language for your factory. Configure Git names and emails for each seat.
The Python `scaffold/` is used by the toy walkthrough only; it is not part of either
challenge and need not be copied, translated or retained in a graded submission.

In Band Desktop, create at least three seats, each with its own seat identity. Confirm
that direct `@handle` messages reach each seat and that each seat can reply.

Prepare permissions for the result checkout, Git, Docker and browser checks. Keep
credentials outside the result repository and its Git history. 

#### Optional: run a seat in a Docker Sandbox

Band Desktop can start a seat's runtime inside a [Docker Sandbox](https://www.docker.com/products/docker-sandboxes/) — 
a microVM with its own filesystem, network boundary and Docker daemon — so that seat builds
and commits without holding those permissions on your machine. That makes it safer to
give a seat the broad permissions an unattended run needs: a wrong command, or a harmful
instruction hidden in something the seat reads, reaches only its working directory and
the network its policy allows, not your home directory, credentials or other
repositories. It is optional, it changes nothing you submit, and no gate depends on it.

You also need Band Desktop 0.4.10 or newer, Docker Sandboxes 0.42 or newer, and a
supported host — macOS 14+ on Apple silicon, Windows 11, or Ubuntu 24.04+ with KVM.

**Install `sbx`.** It is its own download — Docker Desktop neither provides it nor is
required for it:

```sh
## macOS 14+ on Apple silicon
brew trust docker/tap && brew install docker/tap/sbx

## Ubuntu 24.04+ with KVM — the repository, then the package
curl -fsSL https://get.docker.com | sudo REPO_ONLY=1 sh
sudo apt install docker-sbx
```

On Windows 11, enable the hypervisor first, then install from an elevated PowerShell:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
winget install -h Docker.sbx
```

Docker's own guide wins if it disagrees with the above:
<https://docs.docker.com/ai/sandboxes/install/>. Then sign in and start the daemon:

```sh
sbx version                      # 0.42 or newer
sbx login
sbx daemon start --detach
sbx policy ls                    # if it reports no policy yet:
sbx policy init balanced
```

Band Desktop starts sandboxes without a terminal, so it cannot answer the network-policy
prompt `sbx` shows before a first sandbox. Do not reset a policy that already exists.

**Give the seat a credential.** A sandboxed seat cannot use your host Claude login.

| Paying with | Do this |
|---|---|
| An Anthropic **API key** | `sbx secret set anthropic` and paste it, or `echo "$ANTHROPIC_API_KEY" \| sbx secret set anthropic` |
| A Claude **subscription** | From an empty scratch directory, `sbx run --name sbx-login claude`, then `/login` inside it; exit, then `sbx rm sbx-login`. `sbx secret set` cannot store a subscription. `sbx secret ls` should now show `anthropic` as `(oauth configured)` |

An OpenCode seat is not sandboxed at all — see
[the OpenCode section](#optional-run-a-seat-on-opencode-with-featherless-models).

**On macOS, let Band Desktop see `sbx`.** Homebrew installs it to `/opt/homebrew/bin`,
which a GUI app does not inherit, so the runtime check reports `sbx` missing however
happily your terminal runs it. Set the PATH, then reboot:

```sh
sudo launchctl config user path "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

`launchctl config` takes effect only after a reboot (`man launchctl`). Quitting and
reopening Band Desktop is not enough, and neither is restarting its background daemon.

**Turn it on.** **Settings → Experiments → Docker Sandboxes**, then **Settings → Runtime
→ Re-check**. Only a seat Band Desktop runs itself can be sandboxed: create it with
**New local agent** as a headless Claude Code, Codex, GitHub Copilot or Cursor seat.
OpenCode seats, and any session you started yourself, stay on the host. The credential
and setup steps in this section are for Claude Code; for the other harnesses, follow
Band Desktop's advanced reference.

Choose the sandbox when you create the seat:
**Docker Sandbox** on, **Direct host workspace** mode, and **Working directory** set to
the absolute path of `../band-work/result` — the same path you give the band, so the
seat's commits land in your repository rather than a copy you cannot see. For the
credential, pick **Docker-managed Anthropic credential** — it covers both the key and
the subscription. Run **Test runtime** before
you give the seat work; if it cannot authenticate, give it an API key or run it on the
host.

Nothing else moves: the room, the room download and the submission layout are
unchanged, and `python -m harness run` still runs on your machine rather than inside a
sandbox.

#### Optional: run a seat on OpenCode with Featherless models

To run any of your seats in OpenCode, and using one of the open-weights models provided
by Featherless AI, follow these steps:

**1. Install both pieces.**

```sh
brew install sst/tap/opencode      # or: curl -fsSL https://opencode.ai/install | bash
pip install 'band-sdk[opencode]'
pip install 
```

**2. Write the provider config to `~/.config/opencode/opencode.json`** — not to the
repository. OpenCode reads `./opencode.json` from its working directory, which for a seat
is `../band-work/result`, the repository you submit. A key committed there is in your Git
history for good.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "featherless": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Featherless AI",
      "options": {
        "baseURL": "https://api.featherless.ai/v1",
        "apiKey": "{env:FEATHERLESS_API_KEY}"
      },
      "models": {
        "MiniMaxAI/MiniMax-M2.5": {},
        "moonshotai/Kimi-K2.5": {},
        "deepseek-ai/DeepSeek-V3.2": {}
      }
    }
  }
}
```

**3. Confirm the model writes files before you involve Band.**

```sh
export FEATHERLESS_API_KEY=...
opencode models | grep featherless
opencode run -m featherless/MiniMaxAI/MiniMax-M2.5 \
  "Create hello.txt containing the word banana, then run 'wc -c hello.txt'."
```

If you see `hello.txt` on disk then things are working and you're clear to proceed. 

To see the list of models you can use, try: `curl https://api.featherless.ai/v1/models`.

**4. Start the server.** It stays in the foreground, and it has no authentication unless
you set `OPENCODE_SERVER_PASSWORD` — anyone who can reach it can write files and run
commands, so keep it on `127.0.0.1`.

```sh
opencode serve --hostname=127.0.0.1 --port=4096
```

**5. Run the adapter.** It is a small program you run yourself.

```python
import asyncio

from band import Agent, Emit
from band.adapters import OpencodeAdapter, OpencodeAdapterConfig
from band.config import load_agent_config

agent_id, api_key = load_agent_config("reviewer")   # YAML kept outside the result repo

adapter = OpencodeAdapter(
    config=OpencodeAdapterConfig(
        base_url="http://127.0.0.1:4096",
        # Absolute, and the same path you give the band. A relative path resolves
        # against wherever you started the server, and the seat commits somewhere
        # you never look.
        directory="/absolute/path/to/band-work/result",
        provider_id="featherless",
        model_id="MiniMaxAI/MiniMax-M2.5",
        # Defaults to "manual", which stalls every tool call waiting for an answer.
        # auto_accept means this seat runs shell commands without asking, so run the
        # server and this adapter on a box you can throw away.
        approval_mode="auto_accept",
        # Defaults to 300s. A one-file edit took 16-41s against these models, so five
        # minutes cuts real turns short.
        turn_timeout_s=900,
    ),
    emit={Emit.TOOL_CALLS, Emit.TASK_EVENTS},
)
agent = Agent.create(adapter=adapter, agent_id=agent_id, api_key=api_key)
asyncio.run(agent.run())
```

The Docker Sandbox toggle does not cover this seat — it sandboxes a Band Desktop runtime,
not a server you launched yourself. If the seat will not start, run it as a Claude Code
seat in Band Desktop and carry on; the event is not the place to debug a runtime.

### The repository you submit

Your entry to the hackathon is in the form of a github repository. The folder structure should
look like this:

```text
your-repo/
  README.md          team, track, and how to read this repository
  FACTORY.md         your factory: seats, design choices, costs, failure handling
  mandates/          one .md per seat, named after the seat, at least three; each
                     names the seat's harness and model
  room.json          the room, downloaded from Band — see Record the room
  stage-1/           Dockerfile, RUN.md, source
  stage-2/           Dockerfile, RUN.md, source
  stage-3/           Dockerfile, RUN.md, source
  stage-4/           Dockerfile, RUN.md, source
```

**Name each mandate after its seat as the room shows it**, ignoring case and punctuation:
`reviewer.md` for Reviewer, `delivery-manager.md` for Delivery Manager. Gate 1 checks that
every seat in your room log has a mandate file named after it. **Start each mandate with
the harness and model that seat actually runs:**

```text
Harness: Claude Code
Model: claude-sonnet-5
```

Use the harness name as Band Desktop shows it (Claude Code, Codex, OpenCode, …) and the
exact model id. `harness check` reports a mandate that is missing either line. Mandates
must also be generic — see [Your mandates must be generic](#your-mandates-must-be-generic).

**Each stage folder is a complete, buildable service on its own, and it holds the
solution to that stage — not to a later one.** `stage-2/` is `stage-1/` carried forward
and extended; `stage-3/` is `stage-2/` carried forward, and so on. When you finish a
stage, have the band copy the folder and widen the copy to the next stage's spec.

**If the folder you copy holds a `.git` directory, delete it.** A stage folder that is
its own repository is recorded as a link, not as files: everything is there in your
working directory and absent from a clone, so the folder builds for you and arrives
empty for a judge. `harness check` reports it.

Each folder is graded against **every suite up to its own number**: `stage-3/` runs
suites 1, 2 and 3, and it counts as a completed stage 3 only if it passes at least half of
each of the three suites. A
stage-3 service that broke stage 1 has not extended anything, and extending what already
works is the whole exercise.

**A folder that also passes the *next* stage's whole suite claims nothing.** If `stage-1/`
passes every stage 2 check, it is a stage 2 solution filed in the wrong folder, and it
earns no stage 1. The point of the four folders is to show requirements accumulating the
way they do on real work: build stage 1, then take stage 2's requirements and widen what
you built. Copying your final answer back into every folder defeats that and scores
nothing for the earlier ones.

`harness run --repo ... --stage N` runs this check for you and prints
`claimed stage: N on the shipped checks` or `claimed stage: none`.

For both graded tracks, every folder below stage 4 is checked against the next suite,
including `stage-2/` against suite 3: stage 3 introduces new endpoints and semantics.
Only the practice `toy` skips the stage-2 → suite-3 probe, because its stage 3 adds
load rather than new surface.

Submit only the folders you completed. A team that reached stage 2 submits `stage-1/`
and `stage-2/` and nothing else. An empty or half-finished `stage-3/` does not hurt the
folders below it — a folder that does not build claims nothing, exactly as an absent one
does, and either way the chain stops there. There is simply no reason to include it.
`stage-1/` is the one folder every entry must have: it is gate 3, and a `stage-1/` that
does not start is an unranked entry.

**The chain is what scores.** A folder counts only if every earlier folder counts too, so
a passing `stage-4/` above a failing `stage-2/` counts for nothing at stages 2, 3 or 4 — fix
the earlier folder before adding another. `harness run --repo <repo> --all` shows which
folders claim their stage in one run.

### Build and check each stage

Use one room and one result repository throughout. Give the band each spec in order,
asking it to copy the previous stage folder forward and extend it. Seats assign and
reply using each other's literal `@handles`. The coordinator must add every configured
seat to the room before its first handoff and retry a handoff if Jam reports that the
named seat is absent. A coordinator must paste the complete task
and spec into each delegated handoff; pointing at a room message id or asking a seat to
read the room is insufficient. Long handoffs can be split into numbered direct messages.
The implementer posts the full committed revision, and the reviewer independently runs
the checks against a handoff that also contains the complete requirements.

Iterate on your factory as much as you like: try seats, mandates and whole bands, and
step in while you do. The run you submit is different. Once you have chosen the factory,
run it in a fresh room and a fresh result repository, and submit that room and those
mandates. Only that run is judged for Agent Teamwork.

In the submitted run, each stage is a **dark-factory run**. The task you dispatch is its only human input.
From that dispatch until the coordinator's final report, no seat may ask you for
clarification, approval, confirmation or another decision, or pause waiting for your
reply. Seats resolve choices from the supplied requirements and communicate within the
band. If they cannot proceed, the coordinator records the blocker and available evidence
as the stage outcome. Resolve event or specification questions before starting the stage.

You may dispatch each stage separately or all four at once. Either way, send nothing
between dispatches: a "looks good, continue" is steering, and dispatching the same stage
twice is a rerun.

#### Example prompt for your lead seat

Once you have everything ready and you want to prepare for submission, you can give the lead the full stage sequence up front. 
The example below shows one way to do this. Replace `<WORKSPACE>` with the absolute path to the folder containing your `dark-factory-wearedevs/` 
kickoff checkout and `band-work/` workspace. This example uses Tablekeeper; for Pocketful, change the track and spec paths.
The kickoff checkout contains the specs, so the lead can read them directly. It must still
include the complete task and spec in every delegated handoff.

```text
You are the lead seat for our factory. Build all four stages sequentially, coordinating
the other seats and keeping every stage in its own complete, buildable folder.

Workspace root: <WORKSPACE>
Working folder: <WORKSPACE>/dark-factory-wearedevs
Track: tablekeeper
Result repository: <WORKSPACE>/band-work/result

Your goal is to implement each stage fully, and only then move to the next stage.

For stage 1, read the full spec at:
<WORKSPACE>/dark-factory-wearedevs/tablekeeper/spec/stage-1.md
Implement it in:
<WORKSPACE>/band-work/result/stage-1/

When you are done, continue to stage-2. Start from the codebase of stage-1 and implement  stage-2 spec starting from that code.
From there, continue on to stage-3 and then stage-4 in the same manner.
At the end you should have a subfolder for each stage with the code generated for that stage.
```

The real submission repository is the separate `band-work/result/` repo, not the kickoff
repo. Its stage folders are the outputs every seat shares and commits to.

To check a stage, run the harness. For example:

```sh
python -m harness run --track tablekeeper --repo ../band-work/result --stage 3 \
  --out ../band-work/checks/s3-01
```

That builds `../band-work/result/stage-3/` and runs the checks for stages 1, 2 and 3
against it, then the stage 4 suite as the overshoot check. **That last one should fail** —
a `stage-3/` that passes suite 4 claims nothing — so ignore its line and read the last two:

```text
highest contiguous stage: 3
claimed stage: 3 on the shipped checks
report: ../band-work/checks/s3-01/report.json
NOTE: this run only includes a portion of the full tests that are applied before judging; this is meant to provide directional feedback, and ultimately you may not pass the stage with the full set of tests.
```

For `stage-N/`, you want `claimed stage: N`. `highest contiguous stage` is the last stage
whose every shipped check passed against this folder, so it can read lower than a stage
the folder still claims. `claimed stage: none` means one of the suites passed under half
of its checks, or that the folder also passes every check of the next stage.

IMPORTANT: The package ships only part of the tests for each challenge, so this output cannot tell 
you how a folder does on the full set of tests. In other words, the `harness run` command above is only
meant to give you directional guidance, but judging will be done based on a larger set of tests, and a folder 
that reads `claimed stage: N` here can still fail. See [Do not write to the tests](#do-not-write-to-the-tests).

**Run your final check of each stage in isolated mode**, because that is how it will be
graded:

```sh
python -m harness run --track tablekeeper --repo ../band-work/result --stage 3 \
  --mode isolated --out ../band-work/checks/s3-final
```

Swap `--stage 3` for `--all` to build every folder you have and see which ones claim their
stage.

Host mode is the default and is the right thing while you iterate, but it publishes a
port and does **not** block outbound network. Isolated mode runs on an internal network
with no outbound access, 2 vCPU and 2 GiB — a service that quietly depends on reaching
the internet at runtime passes in host mode and fails when judged.

Every check writes `report.json`, per-stage logs and count files into a **new**
directory. Existing output directories are refused: choose another name or omit `--out`
to get a unique directory under `runs/`. Preserve failures. In the submitted run the
band reads the failing log and fixes the implementation itself; handing it the log is for
while you develop the factory. Skips, deselection, missing browsers, empty suites
and startup errors cannot produce a passing stage.

Keep result repositories self-contained: no Git submodules or symlinks. Builds may fetch
dependencies. `Dockerfile` is required in each stage folder; Compose is optional and is
never read by the harness. All required services must work inside the single image. The
harness runs locally as a terminal command; your reviewer can run it. It is not a Band
Desktop seat and never posts messages.

### Do not write to the tests

Each stage ships part of its checks so your band can wire a service up and iterate: run a
stage, read the failing log, fix the implementation, run it again. Every stage ships
`test_sample.py`, which shows each surface once; most stages also ship some of the graded
suite's own files, unchanged. The rest of each suite is held back:

| Stage | Tablekeeper checks shipped | Pocketful checks shipped |
|---|---:|---:|
| 1 | 83% | 79% |
| 2 | 41% | 35% |
| 3 | 11% | 9% |
| 4 | 21% | 16% |

During judging, the full set of tests are run to validate your solution.
Every one of them is written in the specification you were given, and a careful reading finds them. 

**A green run on the shipped checks is not evidence of a stage.** When a stage looks done,
re-read its spec section and ask what the shipped checks never asked for — that question
is the work.

### Your mandates must be generic

**This is the rule teams most often break by accident, and it is disqualifying.** Read it
before you write a single mandate.

Your mandates describe **how your factory works**: what each seat owns, how it takes work,
how it hands work off, what makes it reject something, how it reports evidence. Nothing in
a mandate should tell a reader which of the two tracks you entered.

The task you paste into the room describes **what this track needs**. That is where the
spec goes. Pasting a whole spec into the room is expected and correct.

**A mandate may freely say** things like: "you implement one scoped work item at a time",
"you reject any change without a passing check", "post the committed revision in the room
when you are done", "read the specification the coordinator gives you and ask if it is
ambiguous". None of that names a track.

The test to apply yourself: **could you hand these mandates to a team building something
completely different, and would they still make sense?** If not, they are not a factory —
they are a transcript of this problem, and half of the judging is about whether your
factory is generic and whether another team could stand it up from `FACTORY.md` and
`mandates/`.

### Agent Teamwork evidence

Agent Teamwork is read from your room log and your Git history, not from what you write
about it. Judges compare the two to see whether the seats shared the work, whether the
code came out of the room, and whether anyone outside the band steered it.

Good teamwork leaves a trail in both. The work is split between seats rather than carried
by one. Handoffs happen in the room and carry the whole task. Review is real: when a seat
rejects work, it says what failed, and the fix comes back through the room. Progress shows
up as commits made along the way, each traceable to the discussion that produced it.

Keep that trail intact. Push the history the seats made, without amending, rebasing or
squashing it, and leave the code under `stage-N/` to the band: anything you commit there
yourself is code the band did not write.

### Record the room

The room log is what shows the code came from your band. No harness command fetches it:
you download it from Band yourself and commit the file.

1. **Open the room in the Band console.** In Band Desktop, open the room you worked in,
   click the `⋮` menu at the top right of the room and choose **Open in Band**. The room
   opens in the Band console under **Sessions**. You can also sign in to the Band
   console directly and pick the room from **Sessions**.
2. **Download the full session.** In the console, click the room's `⋮` menu at the top
   right, then **Download → Download full session**. Do not use **Download filtered**,
   and it does not matter what the **Event type** and **Sender** filters are set to. 
3. **Save the file, unchanged, as `room.json`** at the root of your result repository.
   Band names the file after the room, e.g. `Tablekeeper.json` for a room called
   Tablekeeper. Rename it, and do not edit its contents.

```sh
mv ~/Downloads/Tablekeeper.json ../band-work/result/room.json
```

The file holds every message in the room, including the seats' tool calls and their
output, exactly as Band stored them. **Nothing redacts it.** Your repository is public,
so read it before you commit it: `harness check` scans `room.json` for credential
shapes like every other file, but it cannot recognise every private value. If it finds
one, rotate the credential and replace the value in `room.json` with `[REDACTED]`.

Download it at the end, after the work is done, so the log holds the whole
collaboration. Download it again whenever you want to refresh it, and overwrite
`room.json`.

### Check and submit

Run the offline check from the repository root before you push:

```sh
python -m harness check ../band-work/result --track tablekeeper
```

It validates the folder layout, that each stage folder has a `Dockerfile` and a
`RUN.md`, that `room.json` is a whole-room download, that every seat in it has a
mandate file named after it, that every mandate names its harness and model, that two
seats really exchanged `@handle` messages in both directions, that no mandate names
track vocabulary, and that no file in the repository, `room.json` included, looks like
it holds a credential.
It builds nothing — gate 3 is `harness run --repo`.

Then commit everything, push to a public GitHub repository a judge can clone without
Band Desktop membership, and submit its URL along with your presentation and video to
the lablab submission page. 

Write `README.md` and `FACTORY.md` yourself. `FACTORY.md` is what judges read to decide
whether another team could stand your factory up: seat ownership and setup, your design
choices and the reasons for them, what you tried that failed, measured costs and time, and
how your factory catches a bad result. Agent Teamwork is not written — it is read out of
your room log and your commit history, so the way to show it is to actually work in the
room and leave the band to run.

### Practice on the toy example

Everything above is the real track. The toy is where you rehearse it first, on a problem
small enough to read in a minute, before you hand your band a spec that counts.

`toy` is an unscored four-stage exercise. It builds one shared counter: the API, then a
page with an increment button, then 20 simultaneous increments with none lost, then a
request that chooses how much to add.

It is small on purpose. The shape is the same as `tablekeeper` and `pocketful` — a
submission repository with one folder per stage, each folder a service that still passes
every earlier stage — so one run puts your band through the whole loop, producing code
and checking it independently.

Its specs are `toy/spec/stage-1.md` through `toy/spec/stage-4.md`.

The supplied mandates are **minimal practice templates** for assignments, handoffs and
basic review, not a complete factory design. Adapt your workflow for the graded challenges;
short mandates are allowed, but a successful toy run does not establish their effectiveness
on the real tracks.

Prepare a separate practice repository the same way:

```sh
mkdir -p ../band-work/toy-result/stage-1 ../band-work/toy-result/mandates
cp scaffold/* ../band-work/toy-result/stage-1/
cp toy/mandates/*.md ../band-work/toy-result/mandates/
git -C ../band-work/toy-result init -b main
(cd ../band-work/toy-result && pwd)
```

`scaffold/` is a starting service, not a solution. It answers `/health` and
`/_test/reset` and hashes passwords, and that is all — your band writes the rest. Using
it is optional; any language is fine.

Paste `stage-1.md` into one Band Desktop room with the absolute path that prints:

> Build this shared-counter service one stage at a time. The result repository is
> `/absolute/path/to/band-work/toy-result`. Stage 1 goes in `stage-1/`; when it passes,
> copy that folder to `stage-2/` and extend the copy, and the same again for `stage-3/`
> and `stage-4/`. Produce source files, a Dockerfile and RUN.md in each, and commit
> nowhere else. Have the reviewer check each stage, and after each one post the full
> committed revision in the room.

Use the same room and repository for all four stages so the band extends the service it
already built. Paste one stage's spec at a time, or give the lead all four as in
[Example prompt for your lead seat](#example-prompt-for-your-lead-seat), and stop wherever
you like: the point is to run the loop, not to finish the toy.

Check each stage as it lands:

```sh
python -m harness run --track toy --repo ../band-work/toy-result --stage 1 \
  --out ../band-work/checks/toy-s1
python -m harness run --track toy --repo ../band-work/toy-result --stage 2 \
  --out ../band-work/checks/toy-s2
python -m harness run --track toy --repo ../band-work/toy-result --stage 3 \
  --out ../band-work/checks/toy-s3
python -m harness run --track toy --repo ../band-work/toy-result --stage 4 \
  --out ../band-work/checks/toy-s4
```

`--stage N` runs stage N's suite **and every earlier stage's** against that folder, so a
stage-4 check prints four `pass` lines, not one.

**Note that some of these runs print one extra line that says `fail`, and that is intended.**
After the graded suites, the harness runs the *next* stage's suite to check that you did
not overshoot. `--stage 1` also runs suite 2. `--stage 3` also runs suite 4. Your
`stage-1/` folder is supposed to solve stage 1 and not stage 2, so it should fail suite 2
— a folder that passed it would be a stage 2 answer sitting in the stage 1 folder, and it
would not count.

So this is a clean stage 1 run, not a broken one:

```text
  stage 1: pass
  stage 2: fail
highest contiguous stage: 1
claimed stage: 1 (100% of its own suite)
```

| Stage | Its own suite | A passing `--stage N` run prints |
|---|---|---|
| 1 | 8 API checks | `stage 1: pass`, `stage 2: fail`, then `highest contiguous stage: 1` |
| 2 | 4 browser checks | stages 1 and 2 pass, `highest contiguous stage: 2` |
| 3 | 2 concurrency checks | stages 1 to 3 pass, `stage 4: fail`, `highest contiguous stage: 3` |
| 4 | 10 checks, 2 of them concurrent | stages 1 to 4 pass, `highest contiguous stage: 4` |

`--stage 2` and `--stage 4` print no extra line: `stage-2/` is never run against the
stage 3 suite, and stage 4 has no suite above it. Whatever the other lines say, the one
that tells you the folder is right is the last one, `claimed stage: N`.

That is why you copy the folder forward: `stage-4/` still has to serve the page and
survive the burst, not only accept the new field.

`--all` builds every folder the way the organizers do and prints one line per folder.
It does not add the chain up for you: count from `stage-1/` and stop at the first folder
that does not claim its stage. A passing `stage-4/` above a broken `stage-2/` still prints
`claims stage 4` on its own line, but the entry reaches stage 1 and nothing more.

Check it before the band has written anything and stage 1 fails, which is expected: the
scaffold answers health and reset but has no counter, so **2 of the 8 stage-1 checks pass
and 6 fail**. The terminal prints only `stage 1: fail` — the counts are in the
`stage-1.log` it names on that line. Once the band has implemented the counter you will
see `stage 1: pass` instead, and that is the exercise. Give the band a failing stage's
log and ask it to fix the implementation; if Docker cannot build or the service never
starts, give it the terminal error, because the tests cannot run until that is fixed.
Stage 4 is where a band that special-cased its way through stage 3 finds out: the lock
it wrote has to hold for an amount it did not know about.

Confirm the *reviewer* ran these checks, not the implementer, and that the room holds a
message from a seat naming the committed revision. What to look for is in
[Build and check each stage](#build-and-check-each-stage); the toy is the cheap place to
find out whether your seats actually produce it.

**Finish the loop on the toy, too.** Passing the checks is half of it; the other half is
the submission, and that is where entries are lost. On your toy repository, follow
[Record the room](#record-the-room) into `../band-work/toy-result/room.json`, then run
the offline check:

```sh
python -m harness check ../band-work/toy-result --track toy
```

It lists what a submission still needs — `README.md`, `FACTORY.md`, `mandates/` with
their `Harness:` and `Model:` lines filled in, `room.json` — and it is the only check that proves gates 1 and 2 without Docker, so it takes a
minute. Fix those on the toy now and both gates are rehearsed before the real repository
matters. Gate 2 clears only once two of your seats have exchanged `@handle` messages in
the room, with a reply in each direction, which is what the toy is for.

One difference from the real tracks: the toy ships its **whole** suite, because its job
is to show you the loop. Your track ships part of each stage's checks and the rest stay
with the judges — see [Do not write to the tests](#do-not-write-to-the-tests).
Do not read the toy's green run as what a green run on your track proves.

Every run needs an `--out` directory that does not exist yet, so number them. The first
isolated run installs the runner's dependencies and browser in Docker and takes longer;
time it now rather than on the last day.

### Before you submit

Work through this against a fresh clone, not the directory you worked in.

1. Clone your pushed repository somewhere new and run `harness check` there. A file you
   forgot to commit, and a stage folder that is its own git repository, are both
   invisible from your working directory and both arrive empty for a judge. This step is
   the only one that shows them.
2. Run `harness run --repo <clone> --all --mode isolated` once. It builds every stage
   folder and shows which ones claim their stage on the shipped checks; the organizers'
   full run decides which stages count. A folder counts only if every earlier folder
   counts, so one failing folder caps everything above it. Per folder,
   `claimed stage: none` means either a suite passed under half of its checks or the
   folder also passes every check of the next stage.
3. Follow each folder's `RUN.md` by hand in a clean environment, then use the UI. No
   offline check covers this. For `stage-1/` it is gate 3; for every other folder it is
   what lets the folder claim its stage, and a service that does not start counts for
   nothing at that stage or any above it.
4. Read `room.json` and confirm the reciprocal `@handle` exchange between two of
   your seats is really there, and that no history was rewritten
   ([Agent Teamwork evidence](#agent-teamwork-evidence)).
5. Confirm `README.md` and `FACTORY.md` are written, not placeholders.
6. Re-read every mandate and ask whether a team building something else could use it.
   Anything naming your track's endpoints, fields, error codes or test ids has to go.
7. Skim the repository for anything private that automatic redaction would not
   recognise. If you find a credential, rotate it — deleting the line does not unpublish
   what was already pushed.
8. Submit the repository URL, the presentation and the video, then keep the receipt.

### Getting help

Ask in the **BAND Discord**: <https://discord.com/invite/5YkNXmYfjk>. That is the formal
channel for Band Desktop, seat, permission and harness questions. Event and platform
questions — registration, uploads, prizes — go to the lablab Discord channel.

If you find a genuine ambiguity in a published spec, ask. Clarifications are answered
**publicly to every team**, because everyone builds the same specification.

---

# B. Pocketful spec — stage 1

## Pocketful — Stage 1: payments and settlements

This stage defines the initial service and its API.

Build from the supplied requirements. Source code, API documentation and schemas from
existing products in this domain must not be used.

### 1. Scope

Users can send money by handle, request money and split bills. Payments appear in an
activity feed with public or private visibility. Authorized operators can submit groups
of transfers as settlements. Only the HTTP API is required.

The following apply to all operations, including concurrent requests and retries:

1. The sum of wallet balances always equals the total seeded by the last `POST /_test/reset`.
2. No wallet balance may be negative, including transiently.
3. A payment request may move money at most once.

All amounts are exact integer counts of minor units. Deposits, top-ups, withdrawals,
cards and bank integrations are out of scope. Money moves only between existing wallets.

### 2. Delivery and deployment

Deliver an HTTP service, a `Dockerfile` and a `RUN.md` with a command that builds and
starts the service without manual setup. Language, framework and storage are unrestricted.
A `docker-compose.yml` is optional.

The submission is a containerized HTTP service, not a Python package. Python is not
required in the implementation. TypeScript/JavaScript, Go, Rust, Java, Python and any
other language are equally valid. The harness builds the submitted `Dockerfile`, starts
the resulting image and tests only its HTTP behavior; it does not import or execute the
submission's source files on the judge host.

The image must run on its own with `-e PORT=<port>` and a port mapping. Runtime networking
has no outbound access. All runtime dependencies, initialization and seed data must work
within that single container. Compose configuration is not used to start the service.

#### Resource limits

The service must operate within these limits:

| Limit | Value |
|---|---|
| CPU | 2 vCPU |
| Memory | 2 GiB |
| Start to first healthy response | 60 s |
| Concurrent requests | up to 50 in flight |
| Per-request timeout | 5 s (10 s for `POST /_test/reset`) |
| Outbound network | available during `docker build`, **none at run time** |
| Disk | ephemeral; state need not survive a container restart |

Runtime assets and dependencies must be included in the image. This includes fonts,
scripts and stylesheets; external services are unavailable at runtime.

### 3. Runtime contract

#### 3.1 Listening

Listen on `0.0.0.0` using the `PORT` environment variable, default `8080`.

#### 3.2 Health

```http
GET /health  ->  200  {"status": "ok"}
```

Return 200 once the service and its data store can serve requests, within 60 seconds
of container start. Non-200 responses are permitted before the service is ready.

#### 3.3 Reset and seed

```http
POST /_test/reset
Content-Type: application/json

{ ...fixture... }

->  204 No Content
```

Replace all service state with the fixture in the request body (§4). When reset returns
204, subsequent requests must see only that fixture. Repeated resets are supported.
This test endpoint must be enabled in the delivered image and requires no authentication.

#### 3.4 Conventions

- Requests and responses are `application/json; charset=utf-8`.
- Timestamps in responses are RFC 3339 with an explicit offset, e.g. `2026-09-24T19:00:00+02:00`.
- Unknown fields in a request body are ignored, never an error.
- Unknown query parameters are ignored.
- IDs are opaque strings of at most 64 characters. Their format is yours.

### 4. Model

The service has **one currency**, declared in the fixture. Every amount in the API is an integer
count of its minor units: `1000` in a `minor_units: 2` service is €10.00, and `1000` in a
`minor_units: 0` service is ¥1000.

API amounts must have an integral numeric value: JSON `1000`, `1000.0` and `1e3` all represent the
same valid minor-unit amount. Booleans and strings are not numbers here.

#### Users and handles

Every user has a **handle**: unique across the service, matching `^[a-z0-9_]{1,20}$`, and never
changing once set. Users identify recipients by handle. Directory and user-search
endpoints are out of scope.

Seeded users take their handle from the fixture. A user created through `POST /auth/signup`
(§6 — there is no `handle` field in the signup body) has one **derived** from their email: take the
local part, lowercase it, replace every character outside `[a-z0-9_]` with `_`, and truncate to 20
characters. If that handle is already taken the signup fails; see the signup table in §6.

New users start with a balance of `0`. They can receive money and be asked for money immediately.

#### Payments and requests

A **payment** moves money from one wallet to another, immediately and atomically. It is either sent
directly or created by paying a request.

A **request** asks someone for money. The `requester` will receive; the `payer` is being asked. A
request is `pending`, and then exactly one of `paid`, `declined` or `cancelled`. Only the payer may
pay or decline it; only the requester may cancel it.

**A request may exceed the payer's balance.** That is a legal state, not an error at creation time:
the request stays `pending` until it is paid, declined or cancelled, and an attempt to pay it while
short is `409 insufficient_funds` and changes nothing. Money can arrive later and the same request
then becomes payable.

**Visibility belongs to the payment, not the request.** The payer chooses it when the money moves.
A request carries no visibility of its own and never appears in anyone else's feed.

#### The feed contract

`GET /activity` returns payments only. A payment appears for a caller **if and only if** its
`visibility` is `public`, **or** the caller is its sender or its receiver. There is no other rule,
no follow graph and no mute list. Requests never appear in the activity feed; they are read through
`GET /requests`, which returns only requests where the caller is the requester or the payer.

A split is not a feed item. The requests it creates are visible to their own two parties, and the
payments that eventually fulfil them follow the rule above.

Visibility is **one value on the payment**, seen identically by both parties and by everyone else.
A `private` payment is hidden from third parties, not from its own receiver.

#### Arithmetic range

`amount` is at most `1000000000` on any single request, and no operation produces a balance outside
±2⁵³. Monetary arithmetic must preserve exact minor-unit values without rounding error.

#### Fixture format

```json
{
  "currency": "EUR",
  "minor_units": 2,
  "users": [
    { "id": "u_ada", "email": "ada@example.com", "password": "correct horse",
      "display_name": "Ada", "handle": "ada", "balance": 10000 },
    { "id": "u_bob", "email": "bob@example.com", "password": "correct horse",
      "display_name": "Bob", "handle": "bob", "balance": 2500 }
  ],
  "payments": [
    { "id": "p_1", "from_user_id": "u_ada", "to_user_id": "u_bob",
      "amount": 500, "note": "coffee", "visibility": "public" }
  ],
  "requests": [
    { "id": "rq_1", "requester_id": "u_bob", "payer_id": "u_ada",
      "amount": 1200, "note": "taxi", "status": "pending" }
  ]
}
```

- Seeded users must be able to log in with the given password immediately.
- `balance` is the wallet balance **after** every seeded payment has been applied. Seeded
  numbers are consistent; you do not replay seeded payments against balances.
- A `balance` below zero in a fixture is a reset error: return `422 validation_failed` from
  `POST /_test/reset` and change nothing.
- `minor_units` is `0`, `2` or `3`. Fixtures use `EUR` (2), `JPY` (0) and `BHD` (3).

An administrative balance endpoint is out of scope.

### 5. Errors

Every 4xx and 5xx response carries this body:

```json
{ "error": { "code": "insufficient_funds", "message": "human readable, any wording" } }
```

Use the specified HTTP status and `code`. The human-readable `message` may use any wording.
Endpoint-specific errors are listed with each endpoint.

| Status | `code` | When |
|---|---|---|
| 400 | `malformed_request` | Unparseable body, or a field of the wrong JSON type |
| 400 | `missing_idempotency_key` | Required `Idempotency-Key` header absent or empty |
| 401 | `unauthenticated` | Missing, malformed or unknown bearer token |
| 403 | `forbidden` | Authenticated, but not permitted to touch this resource |
| 404 | `not_found` | No such resource, or not visible to this caller |
| 409 | `idempotency_key_reuse` | Key already used by this caller with a different request body |
| 422 | `validation_failed` | A required field or query parameter is missing, or a stated rule is violated with no more specific code |

A field of the correct JSON type with an invalid format or out-of-range value gives
422 `validation_failed`, unless an endpoint specifies a different error. This includes
invalid dates, negative counts and values exceeding a stated maximum or length. In addition:

- Endpoint-specific field rules take precedence: invalid `amount` values (including strings and
  booleans), non-string `note` values (including `null`), and any `visibility` other than
  `public` or `private` are 422 `validation_failed`. Omission alone selects the optional-field
  defaults. Other wrong JSON types follow the rule below.
- An integer-valued **query parameter** is written as plain decimal digits: `1e9`, `4.0` and `+4`
  are 422 `validation_failed` whatever their numeric value.
- Reserve 400 `malformed_request` for a body that does not parse or a field of the wrong type.

Shared ranges, enforced on every endpoint that takes them:

| Field | Valid | Otherwise |
|---|---|---|
| `Idempotency-Key` | 1 to 255 characters | 422 `validation_failed` |
| `limit` | integer 1 to 200 | 422 `validation_failed` |
| `offset` | integer 0 or more | 422 `validation_failed` |

Requests must not produce 5xx responses, including under concurrent load.

### 6. Authentication

Authentication supports signup and login. Email verification, password reset, refresh
tokens and role-management endpoints are out of scope. Permissions specified elsewhere
in these requirements still apply.

```http
POST /auth/signup
{ "email": "a@example.com", "password": "correct horse", "display_name": "Ada" }

->  201  { "user_id": "u_1", "display_name": "Ada", "token": "..." }
```

```http
POST /auth/login
{ "email": "a@example.com", "password": "correct horse" }

->  200  { "user_id": "u_1", "display_name": "Ada", "token": "..." }
```

| Case | Response |
|---|---|
| Email already registered | 409 `email_taken` |
| Password shorter than 8 characters | 422 `validation_failed` |
| `email` not of the form `local@domain` | 422 `validation_failed` |
| Wrong password or unknown email on login | 401 `unauthenticated` |
| The handle derived from the email (§4) is already taken | 409 `handle_taken`, and no account is created |

Every other endpoint requires a bearer token, except `/health`, `/_test/reset` and the two above.
Wallet API endpoints require authentication.

```http
Authorization: Bearer <token>
```

Tokens do not expire. An account may have multiple valid tokens and concurrent sessions.

Passwords must be stored using a password-hashing function such as bcrypt, scrypt or
Argon2, or an equivalent. Plaintext password storage is not permitted.

### 7. Idempotency

Five write paths require an idempotency key (§8 and §11): **`POST /payments`**, **`POST /requests`**,
**`POST /requests/{id}/pay`**, **`POST /splits`** and **`POST /settlements`**. Everything below applies to each of them
independently.

```http
Idempotency-Key: <client-chosen string, 1..255 characters>
```

The key is scoped to **the authenticated user**. Two different users may use the same key string
with no interaction between them.

A replay means the same user sending the **same method, the same path and the same body**. The
same key with the same body on a different path is a different request, not a replay, and must
succeed normally.

| Situation | Response |
|---|---|
| Header absent or empty | 400 `missing_idempotency_key` |
| First use of the key | The normal response, **201** |
| Replay: same key, same body | **200**, body identical to the original response as a JSON value |
| Same key, different body | 409 `idempotency_key_reuse` |
| Key reused after the original request failed with 4xx | Treated as a first use |

"Same body" means the same JSON value after parsing — key order and whitespace do not matter.

For concurrent identical requests with an unused key, exactly one returns 201.
The others return 200 with the same body. The operation takes effect only once.

A successful replay returns the original response, even after the resource changes or
is cancelled. It makes no further state changes.

After the body has parsed as a JSON object and the caller is authenticated, an already
claimed key is resolved before endpoint field validation or current-resource checks. Thus
changing a successful request to an invalid body with the same key still returns
`409 idempotency_key_reuse`.

### 8. API

#### `GET /me`

```json
{ "user_id": "u_ada", "display_name": "Ada", "handle": "ada",
  "balance": 10000, "currency": "EUR", "minor_units": 2 }
```

#### `POST /payments`

**An idempotent write path.** `Idempotency-Key` is required; see §7.

```http
POST /payments
Authorization: Bearer <token>
Idempotency-Key: 2f9c1a...

{ "to_handle": "bob", "amount": 1500, "note": "dinner", "visibility": "public" }
```

`note` is optional and defaults to `""`. `visibility` is optional and defaults to `"public"`.

```json
201
{
  "payment_id": "p_7",
  "from_user_id": "u_ada",
  "from_handle": "ada",
  "to_user_id": "u_bob",
  "to_handle": "bob",
  "amount": 1500,
  "currency": "EUR",
  "note": "dinner",
  "visibility": "public",
  "request_id": null,
  "created_at": "2026-09-24T11:04:03+00:00"
}
```

| Case | Response |
|---|---|
| The caller's balance is below `amount` | 409 `insufficient_funds` |
| `amount` below 1, above 1000000000, or not an integer | 422 `validation_failed` |
| `to_handle` is the caller's own handle | 422 `self_payment` |
| `note` longer than 200 characters | 422 `validation_failed` |
| `visibility` is neither `public` nor `private` | 422 `validation_failed` |
| No user has that handle | 404 `not_found` |

The debit and the credit are one atomic step. A payment is never visible in one wallet and not the
other, and a failed payment leaves no trace in either.

`note` is stored and returned verbatim: no trimming, no escaping, no normalisation. Unicode and
emoji survive a round trip byte for byte.

#### `POST /requests`

**An idempotent write path.**

```http
POST /requests
Idempotency-Key: 9b1f04...

{ "payer_handle": "ada", "amount": 1200, "note": "taxi" }
```

The caller is the requester.

```json
201
{
  "request_id": "rq_4",
  "requester_id": "u_bob",
  "requester_handle": "bob",
  "payer_id": "u_ada",
  "payer_handle": "ada",
  "amount": 1200,
  "currency": "EUR",
  "note": "taxi",
  "status": "pending",
  "payment_id": null,
  "created_at": "2026-09-24T11:06:10+00:00"
}
```

| Case | Response |
|---|---|
| `amount` below 1, above 1000000000, or not an integer | 422 `validation_failed` |
| `payer_handle` is the caller's own handle | 422 `self_request` |
| `note` longer than 200 characters | 422 `validation_failed` |
| No user has that handle | 404 `not_found` |

**The payer's balance is not checked here.** A request for more than the payer holds is created
normally and sits `pending`.

#### `POST /requests/{id}/pay`

**An idempotent write path.** Only the payer may call it.

```http
POST /requests/rq_4/pay
Idempotency-Key: c41d88...

{ "visibility": "private" }
```

The body carries `visibility` only, optional, default `"public"`. It is the payer's choice, not the
requester's. **A replay must send the identical body** — `{}` and `{"visibility": "public"}` are
different JSON values, so reusing a key across the two is `409 idempotency_key_reuse`, per §7.

Returns `201` with the created **payment**, exactly as `POST /payments` returns one, with
`request_id` set to this request. The request becomes `paid` and carries the new `payment_id`.

| Case | Response |
|---|---|
| The request is not `pending` | 409 `request_not_pending` |
| The payer's balance is below `amount` | 409 `insufficient_funds` |
| The caller is not the request's payer | 403 `forbidden` |
| Unknown request | 404 `not_found` |

Replaying a successful payment returns 200 with its original payment body, including
when the request is already `paid`. It moves no additional money and must not return
`409 request_not_pending`.

#### `POST /requests/{id}/decline`

Only the payer. No idempotency key. Returns `200` with the request, `status: "declined"`. Declining
an already-declined request is `200` with the current state — declining twice is not an error.
A `paid` or `cancelled` request is `409 request_not_pending`. Not the payer is `403 forbidden`.

#### `POST /requests/{id}/cancel`

Only the requester. No idempotency key. Returns `200` with the request, `status: "cancelled"`.
Cancelling an already-cancelled request is `200`. A `paid` or `declined` request is
`409 request_not_pending`. Not the requester is `403 forbidden`.

#### `GET /requests`

```http
GET /requests?direction=incoming&status=pending&limit=50&offset=0
```

Requests where the caller is the requester or the payer, and no others. Newest first by
`created_at`.

- `direction` is `incoming` (the caller is the payer), `outgoing` (the caller is the requester) or
  absent for both.
- `status` is one of the four statuses, or absent for all.
- `limit` defaults to 50, range 1 to 200. `offset` defaults to 0 and must be 0 or more. Outside
  either range is 422 `validation_failed`. An unknown `direction` or `status` value is also 422.
- `has_more` is true when items exist beyond the last one returned.

```json
{ "requests": [ { ...request... } ], "has_more": false }
```

#### `POST /splits`

**An idempotent write path.** Splits an amount the caller already paid, and asks each of the other
participants for their share by creating one `pending` request each.

```http
POST /splits
Idempotency-Key: 7a3e52...

{ "amount": 3000, "participant_handles": ["ada", "bob", "cy"], "note": "dinner" }
```

The caller may be included in `participant_handles` or omitted. Shares follow the equal-split
rule in §9, in the order the handles are given. **A request is created for every participant
except the caller**, each for that participant's share, with the caller as requester.

```json
201
{
  "split_id": "sp_2",
  "amount": 3000,
  "currency": "EUR",
  "note": "dinner",
  "shares": [ { "handle": "ada", "amount": 1000 },
              { "handle": "bob", "amount": 1000 },
              { "handle": "cy",  "amount": 1000 } ],
  "requests": [ { ...request for bob... }, { ...request for cy... } ],
  "created_at": "2026-09-24T11:11:00+00:00"
}
```

`shares` covers every participant including the caller, in the order given, and always sums to
`amount`. `requests` covers every participant except the caller, in the same order.

| Case | Response |
|---|---|
| `amount` below 1, above 1000000000, or not an integer | 422 `validation_failed` |
| `participant_handles` empty, or containing a duplicate handle | 422 `validation_failed` |
| `note` longer than 200 characters | 422 `validation_failed` |
| Any handle is unknown | 404 `not_found` |

A split whose only participant is the caller is **valid**: it computes one share, creates zero
requests, and returns `"requests": []`. Nothing about a split checks anyone's balance.

#### `GET /activity`

```http
GET /activity?limit=50&offset=0
```

Payments visible to the caller by the feed contract in §4, newest first by `created_at`.

```json
{ "payments": [ { ...payment... } ], "has_more": false }
```

- The relative order of two payments created within the same second is unspecified.
  Stable pagination during concurrent writes is not required for this endpoint.
- `limit` and `offset` behave exactly as in `GET /requests`.

### 9. Money and rounding

Shares must be whole minor units, sum exactly to `amount` and differ by at most one
minor unit. When the amount does not divide evenly, the larger shares go to the first
participants in `participant_handles` order.

| `amount` | `n` | Shares |
|---|---|---|
| 1000 | 3 | 334, 333, 333 |
| 1 | 3 | 1, 0, 0 |
| 10 | 3 | 4, 3, 3 |
| 999 | 3 | 333, 333, 333 |
| 5 | 5 | 1, 1, 1, 1, 1 |

Splitting the same amount among the same people in a different
`participant_handles` order gives the extra unit to a different person. A share of `0` is legal and
still produces a request for that participant.

Each split's shares are independent of previous splits. After any number of splits have
been paid in full, wallet balances must still sum exactly to the seeded total.

### 10. Export and import

The service must support `GET /_test/export` and `POST /_test/import`. Like reset, these
are unauthenticated test endpoints.
Exports may contain credentials and session tokens; handle them as private test artifacts.
Return 200 from export with a JSON object containing `track: "pocketful"`,
`format_version: 1` and `state` (an implementation-defined JSON object). The state format
is opaque to the caller and must be accepted unchanged by import.

Import takes that entire object and atomically replaces the service's state, returning
204. It must accept an unchanged export produced by this service. No dependency on the
source process, files, volume, port or network address is allowed. Import is replacement,
not merge; repeating it restores the exported state without duplicating anything. Invalid
JSON follows §5; missing fields, wrong track/version or an invalid state give 422
`validation_failed` without changing the destination. Test control calls have a 10-second
timeout. Export is an atomic, read-only snapshot; subsequent source writes do not change it.

Preserve accounts and hashed-password login, existing bearer tokens, currency, balances,
payments, requests, permissions, all completed idempotent request bodies and original
responses. Identities, timestamps and monetary records must not be regenerated or replayed
against an already-net balance. Failed request keys remain reusable. Existing receipts,
tokens and retries must remain valid after import; replacing the state with a fresh fixture
does not satisfy this requirement. Import removes all previous destination data and
credentials. Reset clears all state, including imported state. State need not survive an
abrupt container restart.

### 11. Atomic net settlements

The reset fixture may include `settlement_operator_ids`, an array of user ids, default [].
An operator may execute a settlement across any wallets. This permission does not grant
access to another user's requests or private activity items.

`POST /settlements` requires an operator and an idempotency key. No token gives 401;
authenticated non-operator gives 403 `forbidden`. Body:

```json
{"transfers": [{"from_handle": "ada", "to_handle": "bob", "amount": 100},
               {"from_handle": "bob", "to_handle": "cy", "amount": 50}]}
```

transfers contains 1..32 objects. Each uses ordinary payment amount, note and visibility
rules (defaults: empty note, public). Unknown handle is 404; self-transfer is 422
`self_payment`; malformed batch shape is 422 `validation_failed`. Entry errors take precedence
in input order, before insufficient funds. Unknown fields are ignored.

A settlement is affordable when every wallet's balance after all incoming and outgoing
transfers is nonnegative. Insufficient collective funds gives 409 `insufficient_funds`.
Either all movements commit together or none do; failed
validation claims no idempotency key and creates no payment or revision.

Return 201 with `settlement_id`, `committed_at` and `payments` in input order. Every member is
an ordinary payment with `settlement_id` linking the batch; nonmembers expose null for that
field. Members have null request_id and the same server-assigned created_at, equal to
committed_at.

Constituents follow ordinary activity-feed visibility. The settlement response contains every
member's receipt. Replays return
200 with the original complete response. This is the fifth idempotent write path in stage 1.
A reset/import must preserve settlement operator permissions, original payments, requests,
settlement membership and retry responses.

---

# C. Pocketful spec — stage 2

## Pocketful — Stage 2: wallet screens and payment authorizations

The stage-1 requirements continue to apply, with the additions below. Numbered section
references such as §5 and §7 refer to `stage-1.md`.

Users can manage payments, requests and bill splits in a browser. They can also reserve
money for a recipient to collect later, in one or more captures.

The following screens must be reachable by URL. Other screens must be reachable through
the UI. Server-side and client-side rendering are both permitted.

| Route | Screen |
|---|---|
| `/` | Balance, pay form, request form and the activity feed |
| `/requests` | Incoming and outgoing requests, with pay, decline and cancel |
| `/split` | Split form |
| `/signup` | Signup |
| `/login` | Login |

The browser and the API share `/requests`. Return the UI for `Accept: text/html`; API requests
without that header receive JSON.

The UI must expose the `data-testid` attributes listed below for integration testing.
Additional elements are permitted, and the visual implementation is the team's choice subject
to the product-quality requirements below.

### Product and visual direction

The browser experience must feel like a coherent, presentation-ready consumer finance product,
not a test harness with controls attached. Aim for a calm, trustworthy character. Available funds
must be the clearest monetary value once holds exist, with total and held funds visibly secondary.
Payments, requests, splits and authorisations should be easy to scan, and status, direction,
privacy and money movement should be understandable without interpreting raw API data.

Use a consistent visual system for typography, spacing, colour, controls and feedback. Primary
actions must be easy to identify. Available, held, pending, loading, successful, refused and
uncertain states must be visually distinct as well as satisfying the behavioural requirements
below. Format people, amounts and timestamps for people first; expose technical identifiers only
where they help the user.

The required flows must remain clear and usable at a 375 CSS-pixel viewport and at conventional
desktop widths, without horizontal page scrolling. Inputs need visible labels, keyboard focus must
be apparent, and text and controls need sufficient contrast. Provide considered empty, loading and
error states, and keep navigation consistent across the required routes. A custom illustration,
brand asset or exact visual match to a reference is not required.

### Signup and login

| `data-testid` | Element |
|---|---|
| `signup-email`, `signup-password`, `signup-display-name` | Inputs |
| `signup-submit` | Button |
| `login-email`, `login-password`, `login-submit` | Inputs and button |
| `auth-error` | Error message. Present only when there is one |
| `current-user` | Visible on every screen when signed in. Text contains the display name |
| `current-handle` | Text is exactly the caller's handle, with no `@` and no surrounding words |
| `logout-button` | Button |

### Balance and pay — `/`

| `data-testid` | Element |
|---|---|
| `wallet-balance` | Text is exactly the formatted amount. Carries `data-amount="{minor units}"` |
| `pay-handle`, `pay-amount`, `pay-note` | Inputs. `pay-amount` is a **decimal** string as a person would type it, e.g. `15.00` |
| `pay-visibility` | Selects `public` or `private`. Option values are those two strings |
| `pay-submit` | Button |
| `pay-error` | Error message, when the payment is refused — including insufficient funds |
| `request-handle`, `request-amount`, `request-note`, `request-submit` | The request form |
| `request-error` | Error message, when the request is refused |

Keep the pay form's values after success. Submitting it again without changing a field
must not send another payment: `wallet-balance` falls once, the feed contains one payment
and `pay-error` is absent. Changing a field makes the next submission a new payment request.
Retries follow §7.

**Formatted amount.** `wallet-balance` is the decimal with exactly `minor_units` decimal places, a
single space, then the currency code: `100.00 EUR`. For a `minor_units` of `0` there is no decimal
point at all: `1200 JPY`. Balances are never negative, so there is no sign.

The form accepts decimal amounts and submits minor units to the API. With `minor_units: 2`,
`15.00` and `15` both submit `1500`; `15.5` submits `1550`. Nonnumeric input or more than
`minor_units` decimal places must show the form's error element without sending a request.
For example, `15.005` is rejected rather than rounded.

### Activity feed — `/`

| `data-testid` | Element |
|---|---|
| `activity-list` | Container. Its children are newest first in the DOM |
| `activity-item-{payment_id}` | One per visible payment. Carries `data-visibility="public"` or `data-visibility="private"` |
| `activity-parties-{payment_id}` | Text contains both handles |
| `activity-amount-{payment_id}` | Text is exactly the formatted amount |
| `activity-note-{payment_id}` | Text is exactly the note. Present even when the note is empty |
| `empty-activity` | Shown instead of the list when nothing is visible |

Two payments with equal timestamps may appear in either order.

### Requests — `/requests`

| `data-testid` | Element |
|---|---|
| `incoming-list`, `outgoing-list` | Containers |
| `request-item-{request_id}` | One per request. Carries `data-status="{status}"` |
| `request-amount-{request_id}` | Text is exactly the formatted amount |
| `request-pay-{request_id}` | Button. Present only on a `pending` incoming request |
| `request-decline-{request_id}` | Button. Present only on a `pending` incoming request |
| `request-cancel-{request_id}` | Button. Present only on a `pending` outgoing request |
| `request-error` | Shown when a pay, decline or cancel is refused |
| `empty-requests` | Shown when both lists are empty |

### Split — `/split`

| `data-testid` | Element |
|---|---|
| `split-amount` | Decimal input, same rule as `pay-amount` |
| `split-handles` | Text input: handles separated by commas, in order |
| `split-note`, `split-submit` | Input and button |
| `split-preview` | Shows the computed shares before submitting. Contains one `split-share-{handle}` per participant |
| `split-share-{handle}` | Text is exactly the formatted share amount |
| `split-error` | Error message, when the split is refused |

`split-preview` must show the shares the server would compute, by the rule in `stage-1.md`
§9, before anything is posted. The preview and submitted split must have identical shares.

After any successful action, the balance, the feed and the request lists on the same page must
show the new state without a manual reload. Navigation must wait for the write to succeed before
it refreshes the data. Any mechanism is fine, including a full navigation. **There is no
live-update requirement here** — another client may change state, but this browser need only
refresh after its own action or an explicit refresh.

### Competing clients and uncertain outcomes

- Add `wallet-refresh`, a button on `/` that refreshes the balance and feed without clearing
  the pay form. **Latest refresh wins:** a delayed earlier read must not overwrite a later
  refresh, including when responses arrive out of order.
- Another client may spend the balance after this browser reads it. A refused payment shows
  `pay-error`, refreshes the balance/feed, and preserves all pay inputs. A request cancelled
  elsewhere while its pay button is visible must show `request-error` when payment is refused
  and refresh the request list so the stale pay button disappears.
- If a payment response is lost, including after `POST /payments` commits, show `pay-uncertain`
  (nonempty text), not `pay-error`. Keep the unchanged form retryable with the **same key and
  body**. Successful retry removes both error/uncertainty elements, refreshes the balance and
  feed, and moves money exactly once. Unknown outcomes are not confirmed rejections.

No background polling, live synchronization, or recovery across page reloads is required.
The same balance refresh rules apply to the available and held amounts introduced below.

### Existing clients after an upgrade

A stage-2 service must accept an export produced by the same team's stage-1 service. A
browser signed in before that export/import upgrade must remain signed in afterwards.
Existing pending requests remain payable through the request screen. A payment whose response
was lost before export remains retryable after import with the same body and key; the UI
must recover the original payment and refresh the imported balance. These requirements
apply when import completes between browser requests; migration during an in-flight request
is not required. No page reload or new screen is required. The form and pending retry
identity must survive the upgrade.

### Authorizations and captures

A payment may be **authorised** now and **captured** later, for the full amount or less. An
authorisation places a *hold* on the payer's wallet: it reserves money without moving it. Capturing
moves the money; a final capture also releases whatever was not captured. Nonfinal captures
keep the remainder held. An open authorisation expires and releases its remainder on its own.

1. The sum of all wallet `total` values always equals the total seeded by the last reset.
   A hold moves no money; payments, settlements and captures transfer money between wallets.
2. `available = total − held` must never be negative. Held funds cannot fund new payments,
   authorizations or settlement net debits. Captures may spend the money reserved for them.
3. Cumulative captures must not exceed the authorized amount. Each idempotent capture moves
   money once. A closed hold cannot be captured again.

The existing API changes as follows:

- `GET /me` keeps `balance`, and `balance` **equals `total`**. `available` and `held` are new
  fields beside it. With no open holds, `balance`, `total` and `available` agree and `held` is
  zero, and every earlier behaviour is unchanged.
- `POST /payments` remains an immediate transfer. It must not leave an intermediate hold
  or require a separate capture.
- Every `409 insufficient_funds` in stage 1 — on `POST /payments`,
  `POST /requests/{id}/pay` and settlements — is now evaluated against `available`.
  With no open holds, the result is unchanged.
- Paying a request remains immediate. Authorizing a request is out of scope.
- `POST /splits` is unchanged.
- There are now seven idempotent write paths: stage 1's five, authorizations and captures.
  The same replay rules apply independently to each.

### Model

The fixture gains a service-wide default lifetime and an `authorizations` array.

```json
{
  "currency": "EUR",
  "minor_units": 2,
  "authorization_ttl_seconds": 600,
  "users": [ { "id": "u_ada", "handle": "ada", "balance": 10000, "...": "..." } ],
  "authorizations": [
    { "id": "a_1", "from_user_id": "u_ada", "to_user_id": "u_bob",
      "amount": 2000, "note": "deposit", "visibility": "public",
      "status": "open", "expires_at": "2026-09-24T13:20:00+00:00" }
  ]
}
```

- `authorization_ttl_seconds` applies to every authorisation created through the API. It defaults
  to 600 when omitted. If supplied, it must be a positive integer number of seconds.
  Seeded authorisations carry their own absolute `expires_at` instead.
- A user's seeded `balance` is still `total`. **`available` is derived, never seeded** — the service
  subtracts the seeded open holds itself.
- A sum of seeded unexpired open holds larger than that user's `balance` is a reset error:
  `422 validation_failed` from `POST /_test/reset`, changing nothing, exactly like a negative
  seeded balance.
- Seeded `status` is `open`, `captured`, `voided` or `expired`. Only `open` holds anything.
- An earlier fixture may omit `authorizations` altogether; omission means an empty list.

An authorization whose `expires_at` is at or before now is `expired` and holds no funds.
Reads and writes must reflect expiry even if no request occurred at the deadline.
`GET /authorizations` must show `status: "expired"`, and
`GET /me` must include the released remainder in `available`. Seeded expiry times are at
least an hour from reset time, in the past or future; newly created authorizations may
have shorter lifetimes.

### API

#### `GET /me`

```json
{ "user_id": "u_ada", "display_name": "Ada", "handle": "ada",
  "balance": 10000, "total": 10000, "available": 8000, "held": 2000,
  "currency": "EUR", "minor_units": 2 }
```

`balance` and `total` are always equal. `held` is the sum of open holds, and `available` is
`total − held`, never negative.

#### `POST /authorizations`

`Idempotency-Key` is required. The caller is the payer.

```json
{ "to_handle": "bob", "amount": 2000, "note": "deposit", "visibility": "private" }
```

`note` and `visibility` are optional with the same defaults as `POST /payments`.

```json
201
{
  "authorization_id": "a_4",
  "from_user_id": "u_ada", "from_handle": "ada",
  "to_user_id": "u_bob", "to_handle": "bob",
  "amount": 2000,
  "captured_amount": 0,
  "currency": "EUR",
  "note": "deposit",
  "visibility": "private",
  "status": "open",
  "expires_at": "2026-09-24T13:20:00+00:00",
  "payment_id": null,
  "created_at": "2026-09-24T13:10:00+00:00"
}
```

`expires_at` is `created_at` plus `authorization_ttl_seconds`.

| Case | Response |
|---|---|
| The caller's `available` is below `amount` | 409 `insufficient_funds` |
| `amount` below 1, above 1000000000, or not an integer | 422 `validation_failed` |
| `to_handle` is the caller's own handle | 422 `self_payment` |
| `note` over 200 characters, or `visibility` neither `public` nor `private` | 422 `validation_failed` |
| No user has that handle | 404 `not_found` |

An open authorisation is **not** a feed item and never appears in `GET /activity`.

#### `POST /authorizations/{id}/capture`

`Idempotency-Key` is required. Only the receiver (the `to` party) may capture.

```json
{ "amount": 1500 }
```

`amount` is optional and defaults to the authorisation's remaining amount. As on
`POST /requests/{id}/pay`, **a replay must send the identical body** — `{}` and `{"amount": 2000}`
are different JSON values even when they mean the same capture, so reusing a key across the two is
409 `idempotency_key_reuse` per `stage-1.md` §7.

Returns `201` with the created **payment**, in exactly the shape `POST /payments` returns, with
`authorization_id` set to this authorisation and `request_id: null`. The payment's `amount` is the
captured amount; its `note` and `visibility` are copied from the authorisation; it appears in the
activity feed by the ordinary visibility rule. Payments created without an authorisation
carry `authorization_id: null`; their existing `request_id` semantics are unchanged.

By default the authorisation becomes `captured`, carries `captured_amount` and `payment_id`, and **releases the
uncaptured remainder immediately**: capturing 1500 of 2000 returns 500 to the payer's `available` in
the same step.

**Default: one final capture per authorisation.** A second capture after a final capture is
`409 authorization_not_open`.

**Extended capture mode.** To keep the remainder held, send `{"amount": 700, "final": false}`.
`final` is boolean, default `true`, so earlier single-capture requests retain their behavior.
With `final: false` and an uncaptured remainder, status stays `open`; further captures are
allowed up to that remainder. Capturing the entire remainder closes it even with `final: false`.
A final capture closes it and releases any remainder. `capture_exceeds_authorization` compares
with the **remaining** amount; omitted amount defaults to that remainder. `captured_amount` is
cumulative; `payment_id` is the latest capture; `payment_ids` lists every capture in order.
Every authorization response adds `remaining_amount`: the amount still held, zero when closed.
Void and expiry can close a partially captured authorization, release only the remainder,
and preserve all capture records. New fields do not change idempotency body equality.

| Case | Response |
|---|---|
| The authorisation is not `open` | 409 `authorization_not_open` |
| `expires_at` is at or before now | 409 `authorization_expired` |
| `amount` above the authorisation's uncaptured remainder | 422 `capture_exceeds_authorization` |
| `amount` below 1, or not an integer | 422 `validation_failed` |
| The caller is not the receiver | 403 `forbidden` |
| Unknown authorisation | 404 `not_found` |

#### `POST /authorizations/{id}/void`

**Only the payer may void** — the `from` party releasing their own hold. No idempotency key, like
decline and cancel.

`200` with the authorisation, `status: "voided"`, the hold released. Voiding an already-voided
authorisation is `200` with the current state. A `captured` or `expired` one is
`409 authorization_not_open`.

For an existing authorization, capture and void return 403 `forbidden` when the caller
is not the permitted party, including callers who are neither party. `GET /authorizations`
returns only authorizations involving the caller.

#### `GET /authorizations`

```http
GET /authorizations?direction=outgoing&status=open&limit=50&offset=0
```

Authorisations where the caller is the payer or the receiver, and no others. Newest first by
`created_at`.

- `direction` is `outgoing` (the caller is the payer), `incoming` (the caller is the receiver), or
  absent for both.
- `status` is one of the four statuses, or absent for all. An authorisation expired by the clock
  matches `expired`, never `open`.
- `limit`, `offset` and `has_more` behave exactly as on `GET /requests`.

### UI

A new route `/authorizations`, and the wallet gains two numbers. The UI and the API share
`/authorizations`: serve HTML for `Accept: text/html` and JSON otherwise, as for `/requests`.

| `data-testid` | Element |
|---|---|
| `wallet-balance` | Formatted `total`, retaining the existing display and `data-amount` |
| `wallet-available` | Formatted `available`, with `data-amount`. **Present this as the headline number** — it is what the user can actually spend |
| `wallet-held` | Formatted `held`, with `data-amount`. Absent when `held` is zero |
| `authorize-handle`, `authorize-amount`, `authorize-note`, `authorize-visibility`, `authorize-submit` | The authorise form. Same input rules as the pay form |
| `authorize-error` | Shown when the authorisation is refused, including insufficient available funds |
| `authorization-list` | Container on `/authorizations`. Children newest first in the DOM |
| `authorization-item-{authorization_id}` | Carries `data-status="{status}"` |
| `authorization-amount-{id}` | Text is exactly the formatted authorised amount |
| `authorization-captured-{id}` | Formatted captured amount. Present only when `status` is `captured` |
| `authorization-expires-{id}` | Text is the RFC 3339 `expires_at` |
| `authorization-capture-amount-{id}` | Decimal input, pre-filled with the remaining amount. Present only on an incoming `open` authorisation |
| `authorization-capture-{id}` | Button. Present only on an incoming `open` authorisation |
| `authorization-void-{id}` | Button. Present only on an outgoing `open` authorisation |
| `authorization-error` | Shown when a capture or a void is refused |
| `empty-authorizations` | Shown when the list is empty |

The UI must reflect seeded and newly created holds. Show available funds as the user's
spending balance, including immediately after reset with open holds.

### Concurrent operations

Concurrent requests must produce the same results as executing them one at a time in some
order, and the requirements above hold at every read.

---

# D. Pocketful spec — stage 3

## Pocketful — Stage 3: statements and payment corrections

The requirements from stages 1 and 2 continue to apply, with the additions below.
Numbered section references such as §5 and §7 refer to `stage-1.md`.

Users can request historical balances and paginated statements. Senders can correct
eligible payments while preserving the original receipt. Historical queries must support
both the effective date of a payment and the information available at a specified time.

### Payment timestamps

Every payment's `created_at` is an RFC 3339 instant with an offset identifying when it
moved money. Every endpoint returning a payment includes it. `GET /activity` retains its
existing ordering by this field.

Seeded payments may supply `created_at`; omission uses reset time, before subsequent
API-created payments. A seeded `created_at` in the future gives `422 validation_failed`
from `POST /_test/reset`, with no state change.

A fixture's `balance` remains the balance after all seeded payments. Loading those
payments must not change that balance.

### `GET /me` as of an instant

```http
GET /me?as_of=2026-09-24T13:20:00%2B00:00
```

`as_of` is optional and is an RFC 3339 instant with an offset. Anything else — a naive local
time, a bare date, an empty value — is 422 `validation_failed`. Without temporal query
parameters the response retains the existing money fields and reports current corrected values.

With it, `balance` is the caller's balance as it stood at that instant: the balance after every
payment of theirs with `created_at` at or before `as_of`, and before every payment after it. A
payment made at exactly `as_of` counts as having happened.

- An `as_of` at or after the latest payment returns the current balance.
- An `as_of` before the earliest payment returns the opening balance — what the wallet held
  before anything moved.
- The response carries `as_of` back, exactly as given.

### `GET /statement`

```http
GET /statement?from=<instant>&to=<instant>&limit=50&offset=0
```

Both `from` and `to` are optional; `from` defaults to the opening of the wallet and `to` to now.
`limit` and `offset` behave exactly as in `GET /requests`.

Returns the payments the caller sent or received in the half-open window `[from, to)`, **oldest
first**, each with the caller's balance immediately after it:

This abbreviated example omits the revision fields and `snapshot` token described below.

```json
{ "opening_balance": 10000,
  "entries": [
    { "payment": { "...": "..." }, "delta": -500, "balance_after": 9500 },
    { "payment": { "...": "..." }, "delta": 1200, "balance_after": 10700 }
  ],
  "closing_balance": 10700,
  "has_more": false }
```

Statement requirements:

1. Entries are ordered by `created_at` ascending, then payment `id` ascending for ties.
2. `opening_balance` is the balance immediately before `from`. `closing_balance` is the
   balance immediately before `to`.
3. `opening_balance` plus all `delta` values in the full window must equal `closing_balance`.
   A sent payment has a negative `delta`; a received payment has a positive `delta`.
4. Pagination must not change an entry's `balance_after` or the window's opening and closing
   balances. These values describe the full window regardless of `limit` and `offset`.

Only payments sent or received by the caller appear in their statement, including when
other payments are public. The activity-feed visibility rules do not apply to statements.

### Effective time, recorded time, and corrections

The service must distinguish **when money took effect** from **when it learned that fact**.
Every payment has a revision history. Revision 1 has `amount` as originally paid and
`effective_at = recorded_at = created_at`. A seeded payment's supplied `created_at` is also
its original recorded/effective time; omission uses reset time. Opening balances equal
seeded ending balances minus the net effect of original seeded payments. Corrections must
not change those opening balances. New accounts open at zero. Seeded history is consistent
and nonnegative.

`POST /payments/{payment_id}/corrections` requires an idempotency key and the original sender.
An authenticated non-sender gets 403 `forbidden`; unknown payment gets 404. Body:

```json
{"expected_revision": 1, "amount": 400,
 "effective_at": "2026-09-20T12:00:00+00:00", "reason": "corrected amount"}
```

All fields are required. Revision is a positive integer; amount is an integer 0..1000000000
(zero reverses the entire payment); reason is a string of 1..200 characters; effective time
is an RFC 3339 instant not later than now. Invalid input is 422 `validation_failed`.
Correction changes neither parties nor visibility. It appends an immutable revision, returning
201 with `payment_id`, `revision`, `amount`, `effective_at`, server-assigned `recorded_at`,
and `reason`. Recorded times for one payment strictly increase. A stale expected revision
gives 409 `stale_revision`. Successful replay returns that original revision with 200 even
after newer revisions. Different body with the same key is 409 `idempotency_key_reuse`.

The difference from the previous amount moves between the **same two wallets** in the same
atomic step. Increasing the amount debits the original sender; decreasing it debits the
original receiver. A currently unaffordable debit gives 409 `insufficient_funds`. Otherwise,
if any user's corrected balance is negative at any effective-time boundary, return
409 `historical_overdraft`. Balances at a boundary include the combined effect of all
movements at that instant. Either failure preserves balances, revision history, statements
and idempotency state. The sum of balances must equal the seeded total in every historical view.

The original payment and every original idempotent response remain unchanged. `GET /activity`
continues to display the original payment; correction records are not new feed payments.
`GET /payments/{payment_id}/revisions` returns `{"revisions": [...]}` in revision order,
including revision 1 (`reason: ""`). Only the two parties can read it; a third party gets
404 even for a public payment. No token is 401.

`GET /me` and `GET /statement` accept optional `known_at`, an RFC 3339 instant with offset.
For each payment, select its latest revision recorded **at or before** `known_at`; if none
was yet recorded, that payment contributes nothing. Omission means everything known when the
read begins. Then apply selected revisions according to their **effective** times. `as_of`
retains its inclusive meaning; a statement retains its half-open window. Both query instants
may be in the future. Invalid/empty instants are 422. Echo supplied `known_at` exactly.

Statement ordering is now by selected `effective_at`, then payment id. Each entry retains
`payment`, `delta` and `balance_after`, and adds the selected `revision`, `effective_at` and
`recorded_at`. `payment.amount` is the selected amount for this statement. Zero-amount
revisions still appear as entries with zero delta. No correction is counted alongside the
revision it replaces. With no corrections and no `known_at`, previous behavior is unchanged.

### Stable statement pagination

Every first `GET /statement` response additionally returns an opaque `snapshot` token.
It freezes the caller's selected revisions, window, balances, entries and default `to` at
that read. `GET /statement?snapshot=<token>&limit=...&offset=...` pages that exact result,
even after payments or corrections. Only limit and offset may accompany a snapshot; supplying
`from`, `to` or `known_at` with it gives 422 `validation_failed`. Unknown token, another user's
token, or a token from before reset gives 404 `not_found`. Tokens last until reset. No storage
survival across container restarts is required. Paging changes neither balances nor entries;
the final partial page and offsets beyond the end must report `has_more` correctly.
Unrecognized query parameters remain ignored under stage 1's general rule.

A correction may move a payment into or out of a statement window. Existing snapshots
remain unchanged during concurrent payments or corrections. Concurrent corrections using
the same expected revision cannot both succeed.

### Settlement history

Stage-1 settlements retain their original receipts and privacy rules. Each member's original
revision uses its shared committed_at as both effective_at and recorded_at.
Single-payment corrections reject settlement members with 422 `linked_payment_immutable`.

A stage-3 service must accept exports produced by the same team's stage-1 or stage-2
service. The ledger must import and account for authorizations and captures. Captures are
immutable linked payments: a correction of a capture gives 422 `linked_payment_immutable`.

### Historical holds

For `GET /me?as_of=T&known_at=K`, all four money fields describe that same view:
`balance = total`, `available = total - held`. A hold starts at authorization creation;
nonfinal capture reduces it at capture time; final capture, void or expiry releases the
remainder at that event's time. Expiry takes effect at `expires_at`. Events other than clock
expiry are known at their
server-assigned event time. Once creation is known, the expiry deadline is known too.
For queries beyond now, an open hold expires at its deadline. Without `as_of`, use the instant
the request began. Authorizations expose `closed_at` (null while open; event time when closed).

Historical `total` follows stage-3 effective/recorded-time rules. A correction is rejected
with 409 `historical_overdraft` if it makes either total or available negative at any past
effective/event boundary, under the latest known revisions. Current unaffordable debits
still take precedence as `insufficient_funds`. Seeded open holds are assumed created at reset
unless `created_at` is supplied; seeded closed holds need not reconstruct a prior lifecycle.
`GET /statement` still contains money movements only: authorization, release and expiry are
not payments. Captures appear exactly once with their links. Old snapshots remain unchanged
after any lifecycle action or correction.

---

# E. Pocketful spec — stage 4

## Pocketful — Stage 4: refunds and batch corrections

Recipients can refund payments. Settlement operators can correct several payments in
one request, including payments that belong to a settlement. Existing receipts and saved
statements must remain available in their original form.

All requirements from stages 1–3 continue to apply. There are ten idempotent write paths:
stage 1's five, authorizations and captures from stage 2, corrections from stage 3, and refunds and
correction batches in this stage.

### Refunds and corrected history

`POST /payments/{payment_id}/refunds`, body `{"amount": 200}`, requires an idempotency key.
Only the original receiver may refund, else 403 `forbidden`; unknown payment is 404. The
target may be a direct payment, request payment or capture, but never a refund. Invalid amount
is 422 `validation_failed`. Refunds cumulatively may not exceed the payment's current corrected
amount: 422 `refund_exceeds_payment`. Refunds of refunds give 422 `invalid_refund_target`.

A refund is a new payment in the opposite direction, with `refund_of` naming the target,
`request_id: null`, `authorization_id: null`, and the original note/visibility. Return 201
with that payment; replay returns 200 with the original body. It moves existing money from
the receiver's **available** funds, or fails 409 `insufficient_funds`, atomically. Refunds
never reopen a request or authorization or restore a released hold. Other payments have
`refund_of: null`.

Stage-3 corrections remain available for ordinary direct/request payments. Captures and
refund payments cannot themselves be corrected: 422 `linked_payment_immutable`. A correction
cannot reduce a payment below its already-refunded amount: 422 `refund_exceeds_payment`.
Correction debits are checked against available funds.

### Batch corrections

`POST /correction-batches` requires a settlement operator and an idempotency key, with the
same 401/403 rules as settlements. Body:

```json
{"corrections": [{"payment_id": "p_a", "expected_revision": 1, "amount": 0,
                  "effective_at": "2026-09-20T12:00:00+00:00", "reason": "reversal"},
                 {"payment_id": "p_b", "expected_revision": 1, "amount": 0,
                  "effective_at": "2026-09-20T12:00:00+00:00", "reason": "reversal"}]}
```

corrections contains 1..32 objects with distinct payment_ids, else 422 `validation_failed`.
Every item has the ordinary correction fields and validation. Unknown payment is 404;
a stale expected revision is 409 `stale_revision`. The operator may correct ordinary,
request and settlement payments, but captures and refunds remain immutable. Correcting any
settlement member requires including every member of that settlement, else 422
`incomplete_settlement`. Members of one settlement must have identical effective instants
(offset spellings may differ), else 422 `validation_failed`. Ordinary single-payment
corrections remain available for nonmembers. Unknown fields are ignored.

Error precedence is: item errors in input order, settlement completeness, resulting
current available funds, then historical total and available funds at every effective/event
boundary. The existing codes apply: `linked_payment_immutable`, `refund_exceeds_payment`,
`insufficient_funds`, `historical_overdraft`. Affordability is determined by the combined
effect of all proposed revisions. A rejected batch leaves history, balances and idempotency
records unchanged.

Return 201 with `correction_batch_id`, `recorded_at` and `revisions` in input order. All new
revisions share recorded_at, strictly later than the previous recorded_at of every member;
each revision also exposes correction_batch_id. Effective times cannot be later than now.
Original payments and receipts never change. Original payment and settlement retries return
their original bodies. New statements reflect the new revisions; earlier snapshot tokens
continue to page their frozen entries. Replays return the original batch response with 200.
This adds one idempotent write path.

A settlement payment may be refunded under the existing refund rules, but refunds never
change settlement membership. Concurrent corrections sharing any expected payment revision
cannot
both succeed. A stage-4 service must accept exports produced by the same team's stages 1–3,
retaining settlement membership, corrections and snapshots.

---

# F. Toy sample mandates

## toy/mandates/coordinator.md

````markdown
# coordinator

Harness:
Model:

Minimal practice template. You coordinate; you do not write code.

## Your band, by name

| Seat | Agent |
|---|---|
| coordinator | `coordinator` — you |
| implementer | `implementer` |
| reviewer | `reviewer` |

Use only the agents listed here. If adapting this mandate to your band, replace these
names and the matching `@handles` below with the human-configured names.

## What you do

The human's initial stage task is the factory's only human input for that stage. From
dispatch until your final report, do not ask the human questions, request clarification,
seek approval or confirmation, or pause waiting for a reply. Make reasonable decisions
from the supplied requirements and repository evidence. If the work cannot proceed,
record the concrete blocker and the completed evidence in the final report without
asking the human to resolve it. This rule applies independently to every stage.

Seats receive only messages addressed to them. Do not assume another seat can read the
human's prompt, earlier room messages, task records, attachments or the participant list.
A message id, task id or instruction to "read the room" is not a handoff.

Before delegating, make sure the listed @implementer and @reviewer are participants in
the current room. If either is absent, add that exact preconfigured seat to the room with
Jam's participant-management tool, then verify the add succeeded. This setup is your
responsibility and does not require human input. Do not discover or substitute a different
agent.

Send @implementer a self-contained handoff containing the human's complete task and
requirements, constraints, the full path of the result repository, and the checks to run.
Paste the actual content; do not replace it with a pointer to another message. If it does
not fit in one message, send numbered parts and clearly mark the final part. If Jam rejects
the mention because the seat is absent, add the named seat and retry the handoff.

When the implementation is ready, send @reviewer another self-contained handoff with the
same complete requirements, the reported revision, repository path, and checks. Send
reported problems back to @implementer with enough context to act on them. Accept only
the committed revision the reviewer checked, then tell the human the outcome.

Use the listed agents' literal @handles for messages. You may inspect room membership only
to confirm and add these listed seats. Do not search for, recruit or substitute other agents.
Treat a listed seat as unavailable only after adding that exact seat or retrying its handoff
has failed. Then make the best progress possible and report the attempted recovery and
concrete error in the final outcome. Do not ask the human for input.
````

## toy/mandates/implementer.md

````markdown
# implementer

Harness:
Model:

Minimal practice template. Implement the assigned task in the result repository named
by @coordinator, not a separate workspace. Run the supplied checks, commit your changes,
and send @reviewer and @coordinator the full revision, commands and results. Address
reported issues and hand back a new commit. Do not accept your own work.

This is a dark-factory run. Do not ask the human for input, clarification, approval or
confirmation, and do not wait for a human response. Resolve implementation choices from
the requirements and repository evidence. Ask @coordinator about missing task content or
report a blocker to @coordinator; communication inside the band is allowed.

Assume you can see only messages addressed to you. Your assignment must contain the
actual requirements, repository path and constraints. Do not try to resolve a room
message id or task id, read room history, inspect participants, or reconstruct omitted
requirements. Ask @coordinator to send the missing content when a handoff is incomplete.

Your handoff to @reviewer must be self-contained: include the complete requirements you
received, the repository path, full committed revision, commands and results. Paste the
requirements instead of referring to an earlier room message. Long requirements may be
sent in numbered parts with the final part clearly marked.

Do not overwrite another seat's work. Leave the repository at the revision you report;
do not amend or rebase it after handoff.

The only seats are @coordinator, @implementer and @reviewer. Use these literal handles
for messages; update them if the human configures different names. Do not search for,
recruit or add agents, and do not inspect room participants. Report blockers to
@coordinator.
````

## toy/mandates/reviewer.md

````markdown
# reviewer

Harness:
Model:

Minimal practice template. Inspect the implementation at the revision @implementer
reported and run the supplied checks yourself. Tell @implementer and @coordinator
whether they pass, describe any problems you notice, and include the revision, commands
and results. Say whether you accept the work or need changes; do not fix the code yourself.

This is a dark-factory run. Do not ask the human for input, clarification, approval or
confirmation, and do not wait for a human response. Decide from the supplied requirements,
the committed revision and independently gathered evidence. Direct questions and blockers
to @coordinator or @implementer as appropriate.

Assume you can see only messages addressed to you. Review only after a handoff supplies
the actual complete requirements, repository path, revision and test instructions. A room
message id, task id or instruction to read room history is not sufficient. Ask
@coordinator for any missing content; do not inspect room participants or infer omitted
requirements from the implementation.

Use the result repository named by @coordinator. If its working tree is not clean or
not at the reported revision, ask @coordinator to resolve it before checking.

The only seats are @coordinator, @implementer and @reviewer. Use these literal handles
for messages; update them if the human configures different names. Do not search for,
recruit or add agents. Report blockers to @coordinator.
````

---

# G. Banned mandate vocabulary — pocketful

A mandate containing any of these identifier-shaped tokens fails gate 4 (`harness check` reports file and line; organizers audit with the same list). Ordinary words (amount, balance, handle, status, available) are allowed. Tokens are matched as identifiers: `/path`, `snake_case`, `kebab-case`.

```text
/activity
/auth/login
/auth/signup
/authorizations
/authorizations/{id}/capture
/authorizations/{id}/void
/correction-batches
/payments
/payments/{payment_id}/corrections
/payments/{payment_id}/refunds
/payments/{payment_id}/revisions
/requests
/requests/rq_4/pay
/requests/{id}/cancel
/requests/{id}/decline
/requests/{id}/pay
/settlements
/split
/splits
/statement
activity-amount
activity-item
activity-list
activity-note
activity-parties
as_of
auth-error
authorization-amount
authorization-capture
authorization-capture-amount
authorization-captured
authorization-error
authorization-expires
authorization-item
authorization-list
authorization-void
authorization_expired
authorization_id
authorization_not_open
authorization_ttl_seconds
authorize-amount
authorize-error
authorize-handle
authorize-note
authorize-submit
authorize-visibility
balance_after
capture_exceeds_authorization
captured_amount
closed_at
closing_balance
committed_at
correction-batches
correction_batch_id
current-handle
current-user
data-amount
data-status
data-visibility
effective_at
email_taken
empty-activity
empty-authorizations
empty-requests
expected_revision
expires_at
format_version
from_handle
from_user_id
handle_taken
historical_overdraft
idempotency_key_reuse
incoming-list
incomplete_settlement
insufficient_funds
invalid_refund_target
known_at
linked_payment_immutable
login-email
login-password
login-submit
logout-button
malformed_request
minor_units
missing_idempotency_key
not_found
opening_balance
outgoing-list
participant_handles
pay-amount
pay-error
pay-handle
pay-note
pay-submit
pay-uncertain
pay-visibility
payer_handle
payer_id
payment_id
payment_ids
recorded_at
refund_exceeds_payment
refund_of
remaining_amount
request-amount
request-cancel
request-decline
request-error
request-handle
request-item
request-note
request-pay
request-submit
request_id
request_not_pending
requester_handle
requester_id
rq_1
rq_4
self_payment
self_request
settlement_id
settlement_operator_ids
signup-display-name
signup-email
signup-password
signup-submit
sp_2
split-amount
split-error
split-handles
split-note
split-preview
split-share
split-submit
split_id
stale_revision
to_handle
to_user_id
u_ada
u_bob
validation_failed
wallet-available
wallet-balance
wallet-held
wallet-refresh
```

---

# H. What `harness check` verifies

Paraphrased from `harness/check.py` at the commit above.

1. **Layout:** `README.md` and `FACTORY.md` exist; `stage-1/` exists; stage folders are named exactly `stage-1` … `stage-4` (a folder like `stage_1` or `stage-1-old` is flagged); each stage folder has `Dockerfile` and `RUN.md`; no stage folder contains its own `.git`.
2. **Mandates (gate 1):** `mandates/` exists with ≥3 `.md` files; each has a non-empty `Harness:` line and a non-empty `Model:` line (may be prefixed by list/emphasis markers).
3. **Mandate vocabulary (gate 4):** no line of any mandate contains a token from section G.
4. **Room (`room.json`):** valid JSON object with a `messages` list; must be a **full** download (`scope` is `full`, not filtered); ≥3 distinct senders with `senderType` agent.
5. **Gate 2:** among agent `text` messages, two seats mention each other in **both** directions. Band stores a typed `@handle` as `@[[participant-id]]` — mentions echoed inside tool calls/output do not count.
6. **Seat ↔ mandate match:** every agent display name (`senderName`) in the room has a mandate file whose name matches it after lowercasing and removing everything except `a-z0-9` (e.g. "Delivery Manager" → `deliverymanager.md` or `delivery-manager.md`).
7. **Secrets:** scans text files (incl. `room.json`, `Dockerfile`, `.env`, configs) for credential shapes; skips `.git`, `node_modules`, `__pycache__`, `.venv`, `venv`, `target`, `dist`.

It builds nothing. Gate 3 (stage-1 starts in a clean container) is checked with `python -m harness run --repo … --mode isolated`.
