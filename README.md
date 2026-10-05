# Pocketful — Dark Factory entry

**Team:** Nguyễn Lê Tuấn Phi, Trương Văn Thái · **Track:** pocketful (wallet and payments) · **Event:** WeAreDevelopers x BAND Dark Factory hackathon

A band of four Claude Code seats in Band Desktop (coordinator, implementer, tester, reviewer) built
all four stages of the pocketful specification, one stage at a time, in one room and one repository.
Each stage was given to the band as a single task message pasted into the room; nothing else was sent to the room during the run.

## How to read this repository

| Path | What it is |
|---|---|
| `FACTORY.md` | The factory: seats, design choices, what it cost, how bad work is caught, honest limitations. **Start here.** |
| `mandates/` | One mandate per seat (`coordinator.md`, `implementer.md`, `tester.md`, `reviewer.md`). Each starts with its harness and model. They are deliberately generic: none names anything specific to this track. |
| `room.json` | The full, unedited download of the Band room the band worked in. |
| `stage-1/` … `stage-4/` | Each stage is a complete, buildable service (Node.js + TypeScript, no runtime dependencies, in-memory state). `stage-N/` is `stage-(N-1)/` carried forward and extended. Each has a `Dockerfile` and `RUN.md`. |

Inside each stage folder, `acceptance-tests*/` hold the black-box suites the tester seat wrote from the
written requirements alone.

## Run a stage

```sh
cd stage-4
docker build -t pocketful .
docker run --rm -e PORT=8080 -p 8080:8080 pocketful
```

Then open `http://localhost:8080/login` (stage 2 and later include the browser UI) or call
`GET http://localhost:8080/health`. See each stage's `RUN.md` for details.

## Result on the shipped checks

Run with the organizers' harness in isolated mode (no network, 2 vCPU, 2 GiB), all four folders at once:

```
stage-1/: claims stage 1 on the shipped checks
stage-2/: claims stage 2 on the shipped checks
stage-3/: claims stage 3 on the shipped checks
stage-4/: claims stage 4 on the shipped checks
```

The shipped checks are only part of the full suite, so this is directional evidence, not a guarantee.
Known gaps and ambiguous-spec decisions are listed in `FACTORY.md`.
