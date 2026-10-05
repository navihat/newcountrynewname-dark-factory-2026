# FACTORY

A four-seat software factory in Band Desktop. One task message per stage goes in; a reviewed,
committed, independently checked service comes out.

## 1. Seats

All seats run Claude Code with `claude-sonnet-5-5`, with the shared result repository as working directory.

| Seat | One job | Must not |
|---|---|---|
| `coordinator` | Reads the whole task, splits it into work items with acceptance criteria, sends self-contained handoffs, runs the review loop, writes one final report per stage | Write code, ask the human anything |
| `implementer` | Implements the stage in its folder, runs the checks, commits, posts the full revision | Accept its own work, edit the tester's tests |
| `tester` | Writes a black-box acceptance suite from the written requirements only | Read the implementation, touch service code, copy the sample checks |
| `reviewer` | Builds the exact committed revision, runs the harness and the tester's suite itself, walks the requirements, replies ACCEPTED or BLOCKED with evidence | Fix code |

Flow: human task → `@coordinator` → `@implementer` and `@tester` in parallel → `@reviewer` →
(BLOCKED → `@implementer`) → `@coordinator` → final report to the human.

Who is deliberately excluded: the tester never talks to the implementer first and never sees its code,
so its tests cannot be shaped by the implementation. The reviewer never edits code, so a verdict is
never a verdict on its own work.

## 2. How to stand it up

1. Create four Band Desktop seats named exactly `coordinator`, `implementer`, `tester`, `reviewer`.
   Paste the matching file from `mandates/` into each seat's instructions. Working directory for all
   four: the result repository (absolute path).
2. Create an empty result repository with its own `.git`. Do not place it inside another repository.
3. Create one room, add all four seats yourself before the first message (this is setup, not steering).
4. Send the stage task to `@coordinator` using a real mention (chosen from the mention list). The task
   is a short header (repository path, which folder to build in, the check command, optional stack
   hint) followed by the **full, unabridged** specification text for that stage.
5. Send nothing else. When the coordinator's final report arrives, send the next stage the same way.

The mandates contain no endpoint paths, field names, error codes or other track vocabulary, so the same
four files can be pointed at a different specification. Another team can reuse them as-is.

## 3. Design choices and why

- **Independent tester seat.** The shipped checks cover only part of each stage (79 / 35 / 9 / 16 percent
  for stages 1 to 4). A seat that writes tests from the requirements alone is our defence against code
  that merely satisfies the samples. The tester's suites are committed in each stage folder.
- **Reviewer re-runs everything.** It builds from a clean export of the exact commit, runs the harness in
  normal and isolated mode, runs the tester's suite, and only then answers. Numbers reported by other
  seats are not trusted.
- **Self-contained handoffs.** Seats only see messages that mention them, so every handoff carries the
  complete requirements, repository path, check commands and the seat's work items. The coordinator split
  long specifications into numbered parts.
- **Stage-at-a-time scope.** Each stage was dispatched alone. Seats are told to implement exactly the
  current requirements, so an earlier folder cannot accidentally pass a later suite.
- **Copy-forward by the coordinator.** For each new stage the coordinator copied the previous folder,
  committed that copy as an unchanged carry-forward, and recorded the revision. Reports confirm that
  earlier folders stayed byte-identical afterwards.
- **No human in the loop.** Mandates forbid asking the human for input, approval or clarification;
  blockers are recorded as the stage outcome instead.
- **Plain Node.js, no web framework, in-memory state.** The implementer chose this itself: no runtime
  dependencies means the image builds and runs with no network, and a single-threaded runtime makes the
  money invariants (no negative balance, no double spend) simple to uphold.

## 4. Measured time and cost

Wall-clock from task message to the coordinator's final report, from the coordinator's own reports:

| Stage | Time | Review rounds | Reviewer verdict |
|---|---|---|---|
| 1 | about 22 min | 1 | ACCEPTED |
| 2 | about 33 min | 1 | ACCEPTED |
| 3 | about 38 min | 1 | ACCEPTED |
| 4 | about 21 min | 1 | ACCEPTED |
| **Total** | **about 114 min** | | |

Model spend: Band Desktop's room counter reads **$4.13** for the whole room. We do not fully trust
that number: it was already $4.13 when stage 2 finished and had not changed after stages 3 and 4
(about 60 more minutes of work), so we treat it as a lower bound, not a measurement. We did not
capture per-seat or per-stage token usage, and all seats used one model, so there is no finer breakdown.

Tester suites written by the band: stage 1 — 131 tests, stage 2 — 122, stage 3 — 83, stage 4 — 55.

## 5. How the factory catches bad work, and what it did not catch

Mechanisms: the tester's independent suite, the reviewer's clean-build re-run of both the harness and
that suite, a requirement-by-requirement code walk, and an explicit BLOCKED verdict that the coordinator
must treat as terminal.

Honest limitation: **in this run the mechanism never had to fire.** Every stage was ACCEPTED in the first
review round with zero BLOCKED findings, so we have no real example of the reviewer catching a defect and
the implementer fixing it through the room. We prefer to say so than to invent one. The tester's suites
were adjusted by the tester itself in follow-up commits (for example fixing timing and arithmetic
assumptions in its own tests), which is the only rework visible in the history.

## 6. Known limitations

- **Hidden tests.** Our results are on the shipped part of each suite only. Stage 3 and 4 have most of
  their tests hidden, so a claim of stage 3 or 4 may not hold on the full set.
- **Ambiguous requirements were resolved by the most literal reading.** Examples recorded by the band:
  a wrongly typed settlement entry or batch field is accepted by the tester as either 400 or 422; a
  statement window with `from` after `to` is empty; old snapshots after an import may return 404 or the
  frozen result. If the organizers' reading differs we may lose those checks.
- **The reviewer could not run `docker` directly** (not on its PATH). It relied on the harness, which
  builds and starts the Dockerfile, and the harness passed in both normal and isolated mode.
- **The tester did not run its suites inside a container**; only the organizers' harness did in
  isolated mode.
- **One stage-1 test of the exact `/me` shape fails from stage 2 onwards** by design: stage 2 adds fields
  to that response, as the requirements demand.
- **Stage 2 UI:** the browser-signed-in-before-upgrade requirement is covered only at API level by the
  harness upgrade run; the tester could not build a browser session token for it.
- **Git authorship does not identify seats.** All seats share one git identity on this machine, so every
  commit is authored by the same name. Which seat did what is visible in `room.json`, not in `git log`.
- **Single run, single model.** We did not compare mandates or models; there is no ablation.

## 7. Reproducing our check

```sh
python -m harness run --track pocketful --repo <this-repo> --all --mode isolated --out <new-dir>
python -m harness check <this-repo> --track pocketful
```
