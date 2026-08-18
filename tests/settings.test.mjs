// tests/settings.test.mjs — the blast radius of an unattended agent turn.
//
// `AGENT_CMD` runs with `--permission-mode auto`, headless, for up to thirty turns, with Bash. Until
// this file existed the only thing standing between that and `git push` was a sentence in
// `loop/PROMPT.tests.md` — and the whole design of this harness is built on the position that a
// prompt is not an enforcement mechanism. Every other rule the prompts state has a deterministic
// twin: the diff fence, `forbiddenStatusWrites`, the left-behind probe. These are the twins for the
// destructive ones.
//
// Project settings apply to interactive sessions in this repository too, so the list is kept to
// operations a human runs in their own terminal anyway. `scripts/` is deliberately NOT denied: the
// prompts forbid a stage-1 turn from touching it, `check-tests.mjs`'s diff fence is repo-wide and
// already refuses it in a commit, and denying it here would block the person maintaining the harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const settings = () => JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));
const deny = () => settings().permissions?.deny ?? [];

test('the settings file is valid JSON with a deny list', () => {
  assert.ok(Array.isArray(deny()), 'permissions.deny must be an array');
  assert.ok(deny().length > 0, 'an empty deny list is the state this file was added to end');
});

test('every git operation that could throw a run away is denied', () => {
  // `push` publishes an unreviewed run. `checkout`/`switch` move HEAD mid-run, and `ralph.mjs` says in
  // as many words that the branch is created by a HUMAN and that it never writes to git itself.
  // `reset`, `rebase` and `clean` destroy the very state the loop reads back each iteration — the
  // recorded base in `loop/verdicts/<id>.base` is removed by `git clean -xd`, and the runner has a
  // dedicated warning for exactly that.
  for (const forbidden of ['push', 'checkout', 'switch', 'reset', 'rebase', 'clean']) {
    assert.ok(
      deny().includes(`Bash(git ${forbidden}:*)`),
      `git ${forbidden} is not denied — the prompt forbids it and nothing enforces that`
    );
  }
});

test('the inputs of the run are write-protected', () => {
  // The specification, the rubric and the prompt are what the run is graded AGAINST. An agent that
  // edits its own acceptance criteria has closed the loop on itself, and neither the gate nor the
  // judge would notice: the fence only inspects what is committed, and the judge is handed the
  // rubric as text rather than reading it from the tree.
  for (const path of ['docs/specs/**', 'loop/rubrics/**', 'loop/PROMPT.*.md']) {
    for (const tool of ['Edit', 'Write']) {
      assert.ok(deny().includes(`${tool}(${path})`), `${tool}(${path}) is not denied`);
    }
  }
});

test('the SessionStart hook survived the edit', () => {
  // The deny list was added to a file that already had one job. The memory bridge failing closed and
  // silent is the plan's own named single point of failure.
  const hooks = settings().hooks?.SessionStart ?? [];
  const commands = hooks.flatMap((entry) => entry.hooks ?? []).map((hook) => hook.command);
  assert.ok(
    commands.some((command) => command.includes('loop-memory.mjs')),
    'the loop memory hook is no longer registered'
  );
});

test('what the prompts forbid and what the settings deny do not contradict each other', () => {
  // A prompt that forbids something the settings allow is a rule with no enforcement; the reverse — a
  // setting that denies something a prompt tells the agent to do — is worse, because the turn then
  // fails for a reason the agent cannot see or fix.
  const prompt = readFileSync(join(ROOT, 'loop/PROMPT.tests.md'), 'utf8');
  const denied = deny().join(' ');

  for (const command of ['git push', 'git checkout']) {
    assert.ok(prompt.includes(command), `the prompt no longer mentions ${command}`);
    assert.ok(denied.includes(command), `${command} is denied by prompt only`);
  }

  // The turn's own protocol: it must be able to commit, and to run the gate.
  for (const needed of ['Bash(git commit:*)', 'Bash(git add:*)', 'Bash(dotnet:*)', 'Bash(npm:*)']) {
    assert.ok(!deny().includes(needed), `${needed} is denied, but a turn cannot finish without it`);
  }
});
