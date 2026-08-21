# Run summaries

One file per `npm run ralph` run, written by the runner as the run happens and **committed**.

Everything else the loop leaves behind is gitignored: `loop/JOURNAL.md` is the agent's self-report,
`loop/verdicts/` is overwritten by the next attempt at the same row, `loop/STEPS.md` is regenerated
every iteration. So until these files existed there was no durable record of how a run went — only
of where it stopped. That made every question about the loop's own quality unanswerable: whether a
rubric edit reduced the rework rate, whether a prompt change cost more tokens, whether the judge
started rejecting more than it used to.

Each file holds one row per iteration — the target row, how the turn ended, the verdict, what the
agent turn and the judge call each cost, how long it took — and a totals block when the run ends.

## Reading them

- **rework rate** — the share of rows that appear more than once. The measured run of 2026-08-08/09
  produced 20 acceptance criteria in 27 agent turns: 13 first-pass, 6 rows needing a second turn, one
  needing a third.
- **`gate red` before `judged`** — the deterministic gate did its job and the judge was never paid
  for. Those iterations are the cheap half of a rework.
- **`refused`** — the runner's own checks stopped the turn: a rewritten tracker row, nothing
  committed, work left uncommitted. A rise here is a prompt problem, not a model problem.
- **cost** — both sides, in two labelled sets of columns: `j-in`/`j-out`/`j-cost` for the judge and
  `a-in`/`a-out`/`a-cost` for the agent. The agent's half arrives from
  `--output-format stream-json --verbose`, which emits one JSON object per line as the turn runs — so
  the runner relays each line to the console AND reads the cost off the last one. The agent turn is
  usually the larger half of a run's bill, so a summary carrying only the judge's numbers understated
  most of it.

## What is not here

`total_cost_usd` appears only when the tool reports it — that is what `--output-format json` in the
default judge command and `--output-format stream-json --verbose` in the default agent command are
for. A run with a different tool on either side records the decisions and the timings, and says
plainly that that side's usage was not reported rather than printing zeroes: "nobody said" is not
"it was free".
