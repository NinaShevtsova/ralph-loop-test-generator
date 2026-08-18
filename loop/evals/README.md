# Judge evals

One file per `npm run eval:judge` run, **committed**, so a change to `loop/rubrics/tests.md` can be
argued about with a number instead of an opinion.

`tests/rubrics.test.mjs` checks the rubric the only way a text file can be checked for free: the
items are numbered 1..27 with no gap, every `item N` it cites exists, every §-reference resolves in
the conventions file. All of that stays green if an item is softened into uselessness.

So the eval shows the real judge ten diffs whose verdict is known — eight defects the loop exists to
stop, two diffs it actually accepted in the measured run — and reports which ones it caught. The
fixtures and what each is for live in `loop/judge-eval.mjs`.

## Running it

```bash
npm run eval:judge -- --dry-run
```

Builds every prompt and spends nothing. Then one fixture, to check the plumbing against the real
judge for the price of a single call:

```bash
npm run eval:judge -- --only weak-count
```

Then the set. Ten calls on inputs that floor around 45–56 KB each.

```bash
npm run eval:judge
```

## Reading the result

Two failure directions, and they are not the same fault.

- **a defect accepted** (`expected REJECT got PASS`) — the failure this whole loop is built around. A
  wrongly accepted scenario ships a lie into the deliverable *and* is copied by later iterations as
  approved style.
- **a good scenario rejected** (`expected PASS got …`) — costs an iteration each time, and if the
  judge does it consistently the run ends at the no-progress stop with nothing wrong with the work.

A rubric edit that fixes the first by causing the second has not improved anything, which is why the
two accepted diffs are in the set.

`escalated` — `SPEC_UNCLEAR` on a defect — is neither. The defect is not fixed, but the judge did not
approve it either: it routed the question to a human.
