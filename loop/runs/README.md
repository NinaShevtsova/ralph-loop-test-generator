# Run summaries

One file per `npm run ralph` run, written by the runner as the run happens and **committed**.

Everything else the loop leaves behind is gitignored: `loop/JOURNAL.md` is the agent's self-report,
`loop/verdicts/` is overwritten by the next attempt at the same row, `loop/STEPS.md` is regenerated
every iteration. So until these files existed there was no durable record of how a run went — only
of where it stopped. That made every question about the loop's own quality unanswerable: whether a
rubric edit reduced the rework rate, whether a prompt change cost more tokens, whether the judge
started rejecting more than it used to.

Each file holds one row per iteration — the target row, how the turn ended, the verdict, what the
judge's call cost, how long it took — and a totals block when the run ends.

## Reading them

- **rework rate** — the share of rows that appear more than once. The measured run of 2026-08-08/09
  produced 20 acceptance criteria in 27 agent turns: 13 first-pass, 6 rows needing a second turn, one
  needing a third.
- **`gate red` before `judged`** — the deterministic gate did its job and the judge was never paid
  for. Those iterations are the cheap half of a rework.
- **`refused`** — the runner's own checks stopped the turn: a rewritten tracker row, nothing
  committed, work left uncommitted. A rise here is a prompt problem, not a model problem.
- **cost** — the judge's only. The agent's usage is not captured, because its stdio is inherited so a
  human can watch the turn; iteration count and wall clock stand in for it.

## What is not here

`total_cost_usd` appears only when `JUDGE_CMD` reports it — that is what `--output-format json` in
the default judge command is for. A run with a different judge tool records the decisions and the
timings, and says plainly that the usage was not reported rather than printing zeroes.
