// tests/invoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { targetSection, judgePrompt, splitCommand, runAgent, runJudge } from '../loop/invoke.mjs';

test('splitCommand separates the binary from its arguments', () => {
  assert.deepEqual(splitCommand('claude -p --model sonnet'), {
    bin: 'claude',
    args: ['-p', '--model', 'sonnet'],
  });
});

test('splitCommand tolerates repeated whitespace', () => {
  assert.deepEqual(splitCommand('  codex   exec  --sandbox workspace-write '), {
    bin: 'codex',
    args: ['exec', '--sandbox', 'workspace-write'],
  });
});

test('targetSection names the iteration, the ceiling, the row and the branch', () => {
  const section = targetSection({
    stage: 'tests',
    iteration: 3,
    maxIter: 30,
    row: { id: 'AC-F02-01', group: 'F-02', title: 'an added pet is visible', status: 'todo' },
    branch: 'feat/api-tests',
    findings: '',
  });
  assert.match(section, /## Target of this run/);
  assert.match(section, /\*\*Iteration:\*\* 3 of 30/);
  assert.match(section, /AC-F02-01/);
  assert.match(section, /feat\/api-tests/);
});

test('targetSection for stage tests derives the feature file and the data file from the group', () => {
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F02-01', group: 'F-02', title: 't', status: 'todo' },
    branch: 'b',
    findings: '',
  });
  assert.match(section, /Features\/F02-owner-pet-lifecycle\.feature/);
  assert.match(section, /Data\/F02-owner-pet-lifecycle\.json/);
  assert.match(section, /flows\/F-02-owner-pet-lifecycle\.md/);
  assert.match(section, /@AC-F02-01/);
});

test('targetSection names the row when its group is not a known flow', () => {
  // Without this the failure was a bare TypeError about reading 'slice' of undefined, which names
  // neither the row, the file, nor the fix.
  assert.throws(
    () =>
      targetSection({
        stage: 'tests',
        iteration: 1,
        maxIter: 30,
        row: { id: 'AC-F09-01', group: 'F-09', title: 't', status: 'todo' },
        branch: 'b',
        findings: '',
      }),
    /AC-F09-01 has group "F-09".*expected one of F-01, F-02, F-03/s
  );
});

test('targetSection for stage scaffold names the wave, not a feature file', () => {
  const section = targetSection({
    stage: 'scaffold',
    iteration: 1,
    maxIter: 24,
    row: { id: 'S2', group: 'wave-2', title: 'Config', status: 'todo' },
    branch: 'b',
    findings: '',
  });
  assert.match(section, /wave-2/);
  assert.ok(!section.includes('.feature'), 'the scaffold target must not mention a feature file');
});

test('targetSection includes the judge findings when the row is in rework', () => {
  const section = targetSection({
    stage: 'tests',
    iteration: 4,
    maxIter: 30,
    row: { id: 'AC-F02-01', group: 'F-02', title: 't', status: 'rework' },
    branch: 'b',
    findings: '- [item 6] file.cs:87 HaveCountGreaterThan(0) where the AC says exactly one.',
  });
  assert.match(section, /rework/i);
  assert.match(section, /HaveCountGreaterThan/);
  assert.match(section, /judge/i);
});

test('targetSection separates a runner refusal from a judge rejection', () => {
  // B4. The two are different work: a REJECT says the scenario is wrong, a runner note says the turn
  // never reached the judge. Measured before this existed — a turn refused for committing nothing was
  // handed the previous judge call's findings under "These are the problems an independent judge
  // found. Fix **all** of them", three iterations running.
  const common = {
    stage: 'tests',
    iteration: 4,
    maxIter: 30,
    row: { id: 'AC-F02-01', group: 'F-02', title: 't', status: 'rework' },
    branch: 'b',
    findings: 'gate red at "check:tests"',
  };

  const fromRunner = targetSection({ ...common, findingsFrom: 'runner' });
  assert.match(fromRunner, /judge was \*\*not\*\* called/i);
  assert.ok(
    !/problems an independent judge found/.test(fromRunner),
    'a runner refusal must not be presented to the agent as a judge finding'
  );

  const fromJudge = targetSection({ ...common, findingsFrom: 'judge' });
  assert.match(fromJudge, /problems an independent judge found/);
  assert.ok(!/judge was \*\*not\*\* called/i.test(fromJudge));

  // Both still carry the text itself, whichever heading it got.
  for (const section of [fromRunner, fromJudge]) assert.match(section, /gate red at "check:tests"/);
});

test('targetSection defaults an unlabelled findings block to the judge, as every existing caller expects', () => {
  const section = targetSection({
    stage: 'tests',
    iteration: 2,
    maxIter: 30,
    row: { id: 'AC-F02-01', group: 'F-02', title: 't', status: 'rework' },
    branch: 'b',
    findings: '- [item 6] file.cs:87',
  });
  assert.match(section, /problems an independent judge found/);
});

test('targetSection omits the findings block when there are none', () => {
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F01-01', group: 'F-01', title: 't', status: 'todo' },
    branch: 'b',
    findings: '',
  });
  assert.ok(!/judge findings/i.test(section));
});

test('targetSection marks the very first row as the exemplar', () => {
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F01-01', group: 'F-01', title: 't', status: 'todo' },
    branch: 'b',
    findings: '',
    isExemplarCandidate: true,
  });
  assert.match(section, /exemplar/i);
});

test('judgePrompt puts the rubric first and the diff last', () => {
  const prompt = judgePrompt({
    rubric: 'RUBRIC TEXT',
    acText: 'AC TEXT',
    diff: 'DIFF TEXT',
    report: 'REPORT TEXT',
    steps: 'STEPS TEXT',
    exemplar: null,
  });
  assert.ok(prompt.indexOf('RUBRIC TEXT') < prompt.indexOf('AC TEXT'));
  assert.ok(prompt.indexOf('AC TEXT') < prompt.indexOf('DIFF TEXT'));
  assert.match(prompt, /REPORT TEXT/);
  assert.match(prompt, /STEPS TEXT/);
});

test('judgePrompt includes the exemplar when one exists', () => {
  const prompt = judgePrompt({
    rubric: 'R', acText: 'A', diff: 'D', report: 'M', steps: 'S',
    exemplar: { id: 'AC-F01-01', code: 'EXEMPLAR CODE' },
  });
  assert.match(prompt, /AC-F01-01/);
  assert.match(prompt, /EXEMPLAR CODE/);
});

test('judgePrompt says so explicitly when no exemplar exists yet', () => {
  const prompt = judgePrompt({ rubric: 'R', acText: 'A', diff: 'D', report: 'M', steps: 'S', exemplar: null });
  assert.match(prompt, /no accepted scenario yet|first scenario/i);
});

test('judgePrompt repeats the verdict contract so a malformed first line is unlikely', () => {
  const prompt = judgePrompt({ rubric: 'R', acText: 'A', diff: 'D', report: 'M', steps: 'S', exemplar: null });
  assert.match(prompt, /VERDICT: PASS/);
  assert.match(prompt, /first line/i);
});

// ── The two spawn wrappers ────────────────────────────────────────────────────────────
//
// SAFETY. These tests must never reach the real `claude`: one accidental invocation costs money.
// `runAgent`'s stdin path triggers on `bin === 'claude'`, which is a PATH lookup, and the real binary
// IS on PATH on a developer machine. So the stub is placed in a temporary directory, the child's PATH
// is rewritten to contain only that directory (plus System32, which cmd.exe needs), and the
// resolution is PROVEN before anything is spawned: `where claude` must return exactly one path whose
// dev/ino match the stub's, and must not match the real binary's. A failed assertion there fails the
// test without spawning anything.

const WIN = process.platform === 'win32';

/** A directory holding a `claude.cmd` that records what it was given, and never anything else. */
function makeStubDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const captured = join(dir, 'captured.json');
  writeFileSync(
    join(dir, 'stub.mjs'),
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      "let input = '';",
      "try { input = readFileSync(0, 'utf8'); } catch { input = ''; }",
      `writeFileSync(${JSON.stringify(captured)}, JSON.stringify({`,
      '  argv: process.argv.slice(2),',
      '  stdin: input,',
      '  self: fileURLToPath(import.meta.url),',
      // The SessionStart hook is gated on RALPH_STAGE, so whether it survives the trip down to the
      // agent process is what decides between "the memory bridge works" and "the hook is silent
      // forever and nothing says so".
      '  stage: process.env.RALPH_STAGE ?? null,',
      '  tracker: process.env.RALPH_TRACKER ?? null,',
      '  judge: process.env.RALPH_JUDGE ?? null,',
      '}));',
    ].join('\n')
  );
  // The interpreter is baked in by absolute path: the child's PATH is stripped down, so a bare
  // `node` here would not resolve and the failure would look like the stub was never reached.
  writeFileSync(join(dir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0stub.mjs" %*\r\n`);
  return { dir, captured };
}

/** process.env with every case variant of PATH replaced, so the override cannot be shadowed. */
function pathOnly(dir) {
  const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const value = `${dir};${system32}`;
  const override = {};
  for (const key of Object.keys(process.env)) {
    if (/^path$/i.test(key)) override[key] = value;
  }
  override.PATH = value;
  return override;
}

/** Proves, without executing it, that `claude` on this PATH is our stub and not the real binary. */
function assertClaudeResolvesToStub(dir, env) {
  const stub = statSync(join(dir, 'claude.cmd'));
  const found = spawnSync('where', ['claude'], { encoding: 'utf8', env: { ...process.env, ...env } });
  const hits = (found.stdout ?? '').split(/\r?\n/).filter((line) => line.trim());
  assert.equal(hits.length, 1, `claude must resolve to exactly one file, got:\n${hits.join('\n')}`);
  const resolved = statSync(hits[0]);
  assert.equal(resolved.dev, stub.dev, 'resolved claude is on a different device than the stub');
  assert.equal(resolved.ino, stub.ino, `resolved claude is not the stub — it is ${hits[0]}`);

  // And it is not the binary this must never run, checked by identity rather than by path spelling.
  const real = spawnSync('where', ['claude'], { encoding: 'utf8' });
  for (const line of (real.stdout ?? '').split(/\r?\n/).filter((l) => l.trim())) {
    const other = statSync(line);
    assert.ok(
      other.dev !== stub.dev || other.ino !== stub.ino,
      `the stub is the real claude at ${line} — refusing to spawn`
    );
  }
}

test('runAgent refuses an over-long prompt on win32 rather than let cmd.exe truncate it', { skip: !WIN }, async () => {
  // The measured failure: a 9,970-character stage-1 prompt through an 8,191-character cmd.exe line
  // died with `The command line is too long.` before the agent started.
  //
  // The bin deliberately does not exist. If the guard ever moves below the spawn this comes back as
  // ENOENT instead of the length message — which is how we know nothing was spawned.
  const prompt = 'x'.repeat(9000);
  const result = await runAgent('definitely-not-a-real-binary-9f3a2b -p', prompt, { root: process.cwd() });

  assert.equal(result.ok, false);
  assert.match(result.why, /the prompt is 9000 characters/);
  assert.match(result.why, /cmd\.exe accepts about 7500/);
  assert.match(result.why, /only `claude` goes through stdin/);
  assert.doesNotMatch(result.why, /ENOENT|spawn/i, 'the guard must return before spawn');
});

test('runAgent still sends a prompt under the limit to a non-claude binary as an argument', { skip: !WIN }, async () => {
  // The other side of the same guard: it must not refuse everything. A short prompt still goes as an
  // argument, so a missing binary now DOES surface as a spawn failure rather than a length message.
  const result = await runAgent('definitely-not-a-real-binary-9f3a2b -p', 'short', { root: process.cwd() });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.why, /cmd\.exe accepts about/);
});

test('runAgent feeds claude through stdin on win32, so a 9,000-character prompt arrives whole', { skip: !WIN }, async () => {
  const { dir, captured } = makeStubDir('ralph-agent-');
  const env = pathOnly(dir);
  assertClaudeResolvesToStub(dir, env);

  // Longer than CMD_LIMIT on purpose: if this ever went back onto the command line it would fail.
  const prompt = `${'y'.repeat(9000)}\nlast line`;
  let spawned = null;
  const result = await runAgent('claude -p --model sonnet', prompt, {
    root: process.cwd(),
    env,
    onSpawn: (child) => {
      spawned = child;
    },
  });

  assert.equal(result.ok, true, `the stub should have exited 0: ${result.why}`);
  assert.ok(spawned?.pid, 'onSpawn must receive the child, so Ctrl-C can kill it');

  const seen = JSON.parse(readFileSync(captured, 'utf8'));
  assert.equal(seen.stdin, prompt, 'the whole prompt must arrive through stdin, unmangled');
  assert.deepEqual(seen.argv, ['-p', '--model', 'sonnet'], 'the flags still go as arguments');
  assert.ok(
    !seen.argv.some((arg) => arg.includes('yyy')),
    'the prompt must not also be on the command line'
  );
  rmSync(dir, { recursive: true, force: true });
});

test('the agent child really receives RALPH_STAGE, through the win32 shell layer', { skip: !WIN }, async () => {
  // What the SessionStart gate now rests on. `runAgent` spawns with `shell: true` on win32, so the
  // chain is runner -> cmd.exe -> claude -> hook, and a variable that does not survive it turns the
  // memory bridge OFF for every iteration, silently: the hook exits 0 with no output, which is
  // indistinguishable from a hook that decided there was nothing to say.
  //
  // This pins the first two links. The last one — claude passing its environment to the hook it
  // spawns — cannot be reached without invoking the real binary, and is named as unverified.
  const { dir, captured } = makeStubDir('ralph-agent-env-');
  const env = { ...pathOnly(dir), RALPH_STAGE: 'tests', RALPH_TRACKER: 'loop/trackers/tests.md' };
  assertClaudeResolvesToStub(dir, env);

  const result = await runAgent('claude -p --model sonnet', 'short', { root: process.cwd(), env });
  assert.equal(result.ok, true, `the stub should have exited 0: ${result.why}`);

  const seen = JSON.parse(readFileSync(captured, 'utf8'));
  assert.equal(seen.stage, 'tests', 'RALPH_STAGE did not survive the trip to the agent process');
  assert.equal(seen.tracker, 'loop/trackers/tests.md');
  // And the agent must NOT be wearing the judge's marker, or the gate would turn away the one
  // session it exists to serve.
  assert.equal(seen.judge, null, 'the agent child must not carry RALPH_JUDGE');
  rmSync(dir, { recursive: true, force: true });
});

test('runAgent strips an inherited RALPH_JUDGE, so the memory bridge cannot be switched off from outside', { skip: !WIN }, async () => {
  // B6. `runJudge` sets `RALPH_JUDGE=1`; `runAgent` spread `process.env` and cleared nothing. Measured
  // with the variable exported in the operator's shell — the hook's own docstring invites hand-testing
  // with exactly these two — the AGENT child received `RALPH_JUDGE=1 RALPH_STAGE=tests`, and
  // `.claude/hooks/loop-memory.mjs` then produced 0 bytes instead of 902 characters of facts and
  // journal. It fails closed and silent: no artefact anywhere records that it happened.
  const { dir, captured } = makeStubDir('ralph-agent-nojudge-');
  const env = { ...pathOnly(dir), RALPH_STAGE: 'tests', RALPH_JUDGE: '1' };
  assertClaudeResolvesToStub(dir, env);

  const result = await runAgent('claude -p', 'short', { root: process.cwd(), env });
  assert.equal(result.ok, true, `the stub should have exited 0: ${result.why}`);

  const seen = JSON.parse(readFileSync(captured, 'utf8'));
  assert.equal(seen.judge, null, 'an inherited RALPH_JUDGE must not reach the agent child');
  assert.equal(seen.stage, 'tests', 'and the stage must still get through');
  rmSync(dir, { recursive: true, force: true });
});

test('runAgent strips every case variant of RALPH_JUDGE, because Windows env names are case-insensitive', { skip: !WIN }, async () => {
  // A JavaScript object's keys are case-SENSITIVE while the Windows environment is not, so deleting
  // only `RALPH_JUDGE` would let `ralph_judge=1` through unchanged — and the child would read it as
  // `RALPH_JUDGE`, which is exactly the gate the hook gets turned off by.
  const { dir, captured } = makeStubDir('ralph-agent-nojudge-case-');
  const env = { ...pathOnly(dir), RALPH_STAGE: 'tests', ralph_judge: '1' };
  assertClaudeResolvesToStub(dir, env);

  const result = await runAgent('claude -p', 'short', { root: process.cwd(), env });
  assert.equal(result.ok, true, result.why);
  assert.equal(JSON.parse(readFileSync(captured, 'utf8')).judge, null);
  rmSync(dir, { recursive: true, force: true });
});

test('neither wrapper crashes when the child exits without draining stdin, and neither calls it a success', { skip: !WIN }, async () => {
  // C2. `child.stdin` emits `'error'` when the child is gone, and an `'error'` event with no listener
  // is a hard crash. Measured on both wrappers against a stub that exits immediately: 32 KB and 64 KB
  // delivered, 128 KB died with an uncaught `write EOF` and took the whole runner with it. The judge
  // prompt already floors above 26 KB before the diff, and the failure modes that make `claude` exit
  // fast — auth, a bad flag, a rate limit — are exactly the ones that will not drain.
  const dir = mkdtempSync(join(tmpdir(), 'ralph-nodrain-'));
  writeFileSync(join(dir, 'stub.mjs'), "process.stdout.write('VERDICT: PASS\\n'); process.exit(0);\n");
  writeFileSync(join(dir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0stub.mjs" %*\r\n`);
  const env = pathOnly(dir);
  assertClaudeResolvesToStub(dir, env);

  const prompt = 'z'.repeat(256 * 1024);

  const agent = await runAgent('claude -p', prompt, { root: process.cwd(), env });
  assert.equal(agent.ok, false, 'a prompt that was not delivered is not a successful turn');
  assert.match(agent.why, /not delivered/i);

  // `runJudge` takes no env, so PATH is overridden on this process for the duration and restored.
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  let judged;
  try {
    judged = await runJudge('claude -p', prompt, { root: process.cwd() });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.equal(judged.ok, false);
  assert.match(judged.why, /not delivered/i);

  rmSync(dir, { recursive: true, force: true });
});

test('runJudge refuses an over-long prompt on win32 rather than throw ENAMETOOLONG out of the promise', async () => {
  // C1. `runAgent` has had this guard since a 9,970-character prompt died on cmd.exe; `runJudge` had
  // none, and its prompt is the bigger of the two — measured, the judge input floors at 26,195
  // characters for F-01 and 34,263 for F-02 BEFORE the diff. With a `JUDGE_CMD` that is not `claude`,
  // 26k came back as `exit code 1: The command line is too long.` and 34k threw `spawn ENAMETOOLONG`
  // as an unhandled rejection: a raw stack and exit 1, the code the runner documents for a hard stop.
  const result = await runJudge('definitely-not-a-real-binary-9f3a2b --output-format text', 'q'.repeat(34_263), {
    root: process.cwd(),
  });

  if (!WIN) {
    // Off win32 the prompt is not on a cmd.exe line at all, so there is nothing to refuse.
    assert.equal(result.ok, false);
    return;
  }
  assert.equal(result.ok, false);
  assert.equal(result.out, '', 'out must stay the empty string — the verdict-file fallback tests it');
  assert.match(result.why, /the prompt is 34263 characters/);
  assert.match(result.why, /only `claude` goes through stdin/);
  assert.doesNotMatch(result.why, /ENAMETOOLONG|spawn/i, 'the guard must return before spawn');
});

test('both wrappers refuse an empty command with a sentence rather than an ERR_INVALID_ARG_VALUE stack', async () => {
  // C5. `spawn('')` throws SYNCHRONOUSLY out of the promise executor — measured for both — so an
  // AGENT_CMD a shell expanded to nothing surfaced as an unhandled rejection and exit 1, after the
  // iteration counter, the journal header, the recorded base and the step inventory had already run.
  const agent = await runAgent('', 'short', { root: process.cwd() });
  assert.equal(agent.ok, false);
  assert.match(agent.why, /empty/i);
  assert.match(agent.why, /AGENT_CMD/);

  const judged = await runJudge('   ', 'short', { root: process.cwd() });
  assert.equal(judged.ok, false);
  assert.equal(judged.out, '', 'out must be the empty string, not undefined');
  assert.match(judged.why, /empty/i);
});

test('runJudge reports onSpawn and captures stdout as the verdict', async () => {
  // `node`, not `claude`: this exercises the argument path and the capture with a binary that cannot
  // cost anything. The script path must be whitespace-free because splitCommand splits on whitespace.
  const dir = mkdtempSync(join(tmpdir(), 'ralph-judge-'));
  const script = join(dir, 'judge.mjs');
  writeFileSync(script, "process.stdout.write('VERDICT: PASS\\nlooks right\\n');");
  if (/\s/.test(script)) {
    rmSync(dir, { recursive: true, force: true });
    return; // a temp path with a space cannot be expressed in a JUDGE_CMD string
  }

  let spawned = null;
  const result = await runJudge(`node ${script}`, 'a short prompt', {
    root: process.cwd(),
    onSpawn: (child) => {
      spawned = child;
    },
  });

  assert.equal(result.ok, true, result.why);
  assert.match(result.out, /^VERDICT: PASS/);
  assert.ok(spawned?.pid, 'onSpawn must receive the child, so Ctrl-C can kill it');
  rmSync(dir, { recursive: true, force: true });
});

test('runJudge marks its child, and does not wipe the environment doing it', async () => {
  // The negative gate in `.claude/hooks/loop-memory.mjs` is wired to this marker and to nothing else.
  // Measured: `claude -p` fires SessionStart, and this child inherits the runner's environment — so
  // without the marker the judge opens every session from iteration 2 onward with the agent's own
  // self-report injected ahead of its rubric, and no artefact anywhere records that it happened.
  const dir = mkdtempSync(join(tmpdir(), 'ralph-judge-env-'));
  const script = join(dir, 'judge.mjs');
  writeFileSync(
    script,
    'process.stdout.write(`RALPH_JUDGE=${process.env.RALPH_JUDGE}\\n` +\n' +
      '  `INHERITED=${process.env.RALPH_TEST_SENTINEL}\\n`);'
  );
  if (/\s/.test(script)) {
    rmSync(dir, { recursive: true, force: true });
    return; // a temp path with a space cannot be expressed in a JUDGE_CMD string
  }

  // A sentinel that exists ONLY in this process's environment, to prove the spread is doing work.
  // `PATH` cannot show that: measured, a bare `env: { RALPH_JUDGE: '1' }` still reaches the child
  // with PATH set — on win32 `shell: true` routes through cmd.exe, which re-supplies a base set, so
  // the child saw 15 variables instead of 94 and PATH was among them. An assertion on PATH would
  // therefore have passed against precisely the mistake it was written to catch.
  process.env.RALPH_TEST_SENTINEL = 'inherited';
  let result;
  try {
    result = await runJudge(`node ${script}`, 'p', { root: process.cwd() });
  } finally {
    delete process.env.RALPH_TEST_SENTINEL;
  }

  assert.equal(result.ok, true, result.why);
  assert.match(result.out, /RALPH_JUDGE=1/, 'the judge child must carry the marker the hook refuses on');
  // The spread is load-bearing, not style. A bare `env: { RALPH_JUDGE: '1' }` replaces the runner's
  // environment instead of adding to it, and `claude` is configured through that environment.
  assert.match(result.out, /INHERITED=inherited/, 'the marker must be added to the environment, not replace it');

  rmSync(dir, { recursive: true, force: true });
});

test('both spawn wrappers keep their options object optional', () => {
  // Both signatures gained `= {}` when `onSpawn` was added. Without it a two-argument call throws
  // `Cannot destructure property`, and neither call site is reached by any other test.
  assert.equal(runAgent.length, 2, 'runAgent must declare exactly the two required parameters');
  assert.equal(runJudge.length, 2, 'runJudge must declare exactly the two required parameters');
});

test('runJudge returns an empty out and a stated reason when it cannot spawn at all', async () => {
  // This is the input the runner's verdict-file fallback is built on: it writes
  // `judged.out || \`<the judge produced no output — ${judged.why}>\`', so `out` must be the empty
  // string and `why` must carry something a human can act on. A `why` of `undefined` here would put
  // the word "undefined" into the only artefact of a failed judge call.
  const result = await runJudge('definitely-not-a-real-binary-9f3a2b --output-format text', 'p', {
    root: process.cwd(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.out, '', 'out must be empty, not undefined — the fallback tests it for falsiness');
  assert.equal(typeof result.why, 'string');
  assert.ok(result.why.length > 0, 'the reason must survive to the caller');
  assert.doesNotMatch(result.why, /undefined/);
});

test('runJudge returns an empty out when the judge exits 0 having printed nothing', async () => {
  // The other way `out` comes back empty, and the one that is NOT a spawn failure: `ok` is true, so
  // the runner goes on to parse a verdict out of nothing. `parseVerdict('')` is REJECT by design;
  // what matters here is that `out` is the empty string so the artefact records the reason instead of
  // being zero bytes.
  const dir = mkdtempSync(join(tmpdir(), 'ralph-silent-'));
  const script = join(dir, 'silent.mjs');
  writeFileSync(script, 'process.exit(0);');
  if (/\s/.test(script)) {
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  const result = await runJudge(`node ${script}`, 'p', { root: process.cwd() });
  assert.equal(result.ok, true);
  assert.equal(result.out, '');
  assert.match(result.why, /exit code 0/);
  rmSync(dir, { recursive: true, force: true });
});

test('the target section tells a tests turn it may create a missing feature file', () => {
  // A flow added after stage 0 ran has no skeleton. `Features/` is inside the stage-1 fence, and
  // `check-tests.mjs` looks for the file AFTER the turn — so a turn that creates it passes. Without
  // this sentence the agent has no way to know that, and its prompt says "append", which reads as
  // "the file is there". The prompt itself is write-protected by .claude/settings.json, so the
  // instruction belongs in the section the runner generates.
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F01-01', group: 'F-01', title: 'a registered owner is visible', status: 'todo' },
    branch: 'feat/api-tests',
    findings: '',
  });
  assert.match(section, /create (it|the file) if it does not exist/i);
});

test('the same section still names the exact feature file to append to', () => {
  // The new sentence must not displace the path — that is what the turn acts on.
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F03-02', group: 'F-03', title: 't', status: 'todo' },
    branch: 'b',
    findings: '',
  });
  assert.match(section, /Features\/F03-pet-visit-flow\.feature/);
});

// ── The agent turn is watched AND priced ─────────────────────────────────────────────
//
// The interpreter is named `node` rather than `process.execPath`, and that is not cosmetic.
// `splitCommand` splits the command on whitespace, and on this machine `process.execPath` is
// `C:\Program Files\nodejs\node.exe` — so `${process.execPath} ${stub}` makes `bin` into
// `C:\Program`, and cmd.exe answers `'C:\Program' is not recognized as an internal or external
// command` with `{ ok: false, why: 'exit code 1' }`. Measured. `node` from PATH is the same
// interpreter and is what the `runJudge` stub tests above already use for the same reason. It is
// still a stub and still cannot cost anything: no `claude` is ever on the command line below.
const NODE = /\s/.test(process.execPath) ? 'node' : process.execPath;

test('runAgent returns the usage the stream reported, and relays the text it saw', async () => {
  // A stub that speaks the stream-json shape: one object per line, the result last. No `claude`
  // involved — this test must never be able to spend money.
  const stub = join(tmpdir(), `agent-stub-${process.pid}.mjs`);
  writeFileSync(
    stub,
    [
      "process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'writing the scenario' }] } }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33, cache_creation_input_tokens: 44 }, total_cost_usd: 0.5, duration_ms: 1234 }) + '\\n');",
    ].join('\n')
  );

  const relayed = [];
  const result = await runAgent(`${NODE} ${stub}`, 'the prompt', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });

  assert.equal(result.ok, true, result.why);
  assert.deepEqual(result.usage, {
    inputTokens: 11,
    outputTokens: 22,
    cacheReadTokens: 33,
    cacheWriteTokens: 44,
    costUsd: 0.5,
    durationMs: 1234,
  });
  assert.ok(
    relayed.some((line) => line.includes('writing the scenario')),
    `the operator must still see the turn; relayed:\n${relayed.join('\n')}`
  );
  rmSync(stub, { force: true });
});

test('runAgent still succeeds, with no usage, for a tool that does not speak the envelope', async () => {
  // AGENT_CMD is documented as pluggable. A tool that prints plain text must keep working, and must
  // report `usage: null` rather than zeroes — "nobody said" is not "it was free".
  const stub = join(tmpdir(), `agent-plain-${process.pid}.mjs`);
  writeFileSync(stub, "process.stdout.write('just some text\\n');");

  const relayed = [];
  const result = await runAgent(`${NODE} ${stub}`, 'p', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });

  assert.equal(result.ok, true, result.why);
  assert.equal(result.usage, null);
  assert.deepEqual(relayed, ['just some text'], 'a plain tool\'s output must not become silence');
  rmSync(stub, { force: true });
});

test('a character whose bytes are split across two chunks survives the relay', async () => {
  // The relay is `buffered += chunk`, and a Buffer added to a string decodes ON ITS OWN. A pipe splits
  // wherever the kernel happens to, so a two- or three-byte character straddling a boundary became
  // U+FFFD on both sides of it — silently, in the operator's only view of the turn.
  //
  // The stub writes ONE BYTE per event, a millisecond apart, so both multi-byte characters below are
  // guaranteed to be split. That is the whole point: a stub writing whole strings passes with or
  // without the decoder and would prove nothing.
  const stub = join(tmpdir(), `agent-utf8-${process.pid}.mjs`);
  writeFileSync(
    stub,
    `const text = '§ 7.1 — the route table';
const buf = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([10])]);
let i = 0;
const tick = () => {
  if (i >= buf.length) return;
  process.stdout.write(buf.subarray(i, i + 1));
  i += 1;
  setTimeout(tick, 1);
};
tick();
`
  );

  const relayed = [];
  const result = await runAgent(`${NODE} ${stub}`, 'p', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });

  assert.equal(result.ok, true, result.why);
  assert.deepEqual(relayed, ['§ 7.1 — the route table']);
  assert.ok(
    !relayed.join('').includes(String.fromCharCode(0xfffd)),
    `the relay produced a replacement character: ${JSON.stringify(relayed)}`
  );
  rmSync(stub, { force: true });
});

test('a tool result is relayed, trimmed from the head, and says how much it dropped', async () => {
  // The relay used to drop `user` events wholesale, so a tool call showed as `· Bash` with no answer
  // under it. Six lines in, four out, and the count of the two that were not shown.
  const stub = join(tmpdir(), `agent-tool-ok-${process.pid}.mjs`);
  writeFileSync(
    stub,
    [
      "const many = Array.from({ length: 6 }, (_, i) => 'out ' + (i + 1)).join('\\n');",
      "const event = { type: 'user', message: { content: [{ type: 'tool_result', content: many }] } };",
      "process.stdout.write(JSON.stringify(event) + '\\n');",
    ].join('\n')
  );

  const relayed = [];
  const result = await runAgent(`${NODE} ${stub}`, 'p', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });
  const out = relayed.join('\n');

  assert.equal(result.ok, true, result.why);
  assert.match(out, /out 1/, out);
  assert.match(out, /out 4/, out);
  assert.doesNotMatch(out, /out 5/, 'the budget is four lines, so the fifth must not be printed');
  assert.match(out, /2 more line\(s\)/, 'a trim that does not say it trimmed reads as the whole answer');
  rmSync(stub, { force: true });
});

test('a FAILED tool result is relayed from the tail, where a build or a test run puts its summary', async () => {
  // Deliberately the opposite end from a success: `dotnet build` and `dotnet test` both put the line
  // that explains the failure last, and the head of that output is `Determining projects to restore`.
  const stub = join(tmpdir(), `agent-tool-err-${process.pid}.mjs`);
  writeFileSync(
    stub,
    [
      "const many = Array.from({ length: 15 }, (_, i) => 'step ' + (i + 1)).join('\\n');",
      "const block = { type: 'tool_result', is_error: true, content: many };",
      "process.stdout.write(JSON.stringify({ type: 'user', message: { content: [block] } }) + '\\n');",
    ].join('\n')
  );

  const relayed = [];
  const result = await runAgent(`${NODE} ${stub}`, 'p', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });
  const out = relayed.join('\n');

  assert.equal(result.ok, true, result.why);
  assert.match(out, /step 15/, 'the last line is the one that explains a red build');
  assert.match(out, /step 4/, 'twelve lines of budget reach back to the fourth');
  assert.doesNotMatch(out, /step 3\b/, 'the three lines before the budget are dropped, not shown');
  assert.match(out, /3 earlier line\(s\) not shown/, out);
  rmSync(stub, { force: true });
});

test('a user event carrying no tool result stays silent, as it always did', async () => {
  // The change is scoped to `tool_result`. Anything else on a `user` event is bookkeeping, and adding
  // that to the relay would drown the part that matters.
  const stub = join(tmpdir(), `agent-tool-none-${process.pid}.mjs`);
  writeFileSync(
    stub,
    [
      "const event = { type: 'user', message: { content: [{ type: 'text', text: 'bookkeeping' }] } };",
      "process.stdout.write(JSON.stringify(event) + '\\n');",
    ].join('\n')
  );

  const relayed = [];
  const result = await runAgent(`${NODE} ${stub}`, 'p', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });

  assert.equal(result.ok, true, result.why);
  assert.deepEqual(relayed, []);
  rmSync(stub, { force: true });
});

test('an agent that exits non-zero is still a failed turn, usage or no usage', async () => {
  const stub = join(tmpdir(), `agent-fail-${process.pid}.mjs`);
  writeFileSync(stub, 'process.exit(3);');

  const result = await runAgent(`${NODE} ${stub}`, 'p', { root: process.cwd() });

  assert.equal(result.ok, false);
  assert.match(result.why, /exit code 3/);
  rmSync(stub, { force: true });
});
