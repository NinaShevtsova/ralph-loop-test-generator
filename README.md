# API test generation under supervision

A **Ralph loop**: an AI — the **agent** — writes one API integration test per turn, a machine
checks the result by building and running it, and a second AI — the **judge** — grades the change
against written rules. A criterion is closed only when both agree, and the agent is never allowed
to mark its own work done.

The system under test is a demo veterinary-clinic REST API. The input is a set of acceptance
criteria in plain language; the output is a C# BDD test project the client can run.

## What came out of it

| | |
|---|---|
| Acceptance criteria closed | **20**, one scenario each |
| Generated test project | **42** files, **2,742** lines of C# |
| Tests in a run | **23** (20 scenarios + 3 smoke) |
| Negative control — the app is deliberately broken, the tests must go red | **4 of 4** breakages caught |
| Judge exam — 10 diffs with a known correct grade | **10 of 10** |
| Tests of the harness itself | **554**, all green |

The negative control is the one that matters most: it answers, by running things rather than by
reading them, whether these tests are capable of failing at all.

## Where to start

| If you want to… | Read |
|---|---|
| understand what this is and how it works | [docs/ralph-loop-demo.md](docs/ralph-loop-demo.md) — full walkthrough, Russian and English |
| run it, or add a new criterion | [docs/operating-the-loop.md](docs/operating-the-loop.md) |
| know why it is built this way | [docs/design/](docs/design/) |
| see how it was implemented, step by step | [docs/plans/](docs/plans/), [docs/reviews/](docs/reviews/) |

The demo is the place to start. It explains the idea, the architecture and every file, and the
first five sections need no technical background.

## Quick start

```bash
npm test                                   # 554 harness tests — free, no Docker
npm run ralph -- --dry-run --stage tests   # what the loop would do — spends nothing
```

Running the real thing needs Docker and spends money on model calls; see the operating guide.

## Repository map

| Folder | What it is |
|---|---|
| `docs/` | the specification the loop consumes, plus all documentation |
| `loop/` | the loop itself: runner, prompts, judge rules, task lists |
| `scripts/` | the automatic checks and the maintenance tools |
| `framework/` | the generated C# test project — the output |
| `tests/` | tests of the harness, not of the product |
| `.claude/` | memory between turns, and limits on what the agent may do |

Only `docs/specs/` is read by the code as input; everything else under `docs/` is for people.
