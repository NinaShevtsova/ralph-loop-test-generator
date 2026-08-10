// tests/lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  brokenInvocationMessage,
  git,
  gitTry,
  invocation,
  repoRoot,
  run,
  Verdict,
} from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);

// ── repoRoot ──────────────────────────────────────────────────────────────────

test('repoRoot resolves one level above scripts/', () => {
  assert.ok(existsSync(join(ROOT, 'package.json')), `no package.json in ${ROOT}`);
  assert.ok(existsSync(join(ROOT, 'scripts', 'lib.mjs')));
});

test('repoRoot ignores CLAUDE_PROJECT_DIR when it does not point at this repository', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpdir();
  try {
    assert.equal(repoRoot(import.meta.url), ROOT);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});

// ── invocation (review item C8) ───────────────────────────────────────────────
//
// The defect: a gate step that exits 0 having done nothing. `runGate` grades a step on its exit code
// alone, so `node scripts/sut.mjs reset` falling through to the inert branch reported a reset that
// never happened, and design D-09 — the clean database that makes a red test mean "the test is bad"
// — was switched off in silence. Measured on this machine with `Z:` substituted to the repository:
// `node Z:\scripts\sut.mjs bogus` printed nothing and exited 0, while the same command through the
// real path printed the usage error and exited 2.
//
// The realpath is injected here so all three answers are driven without a subst drive. Forward
// slashes throughout: `path.win32.basename` accepts both separators, `path.posix.basename` does not,
// and a backslash literal would make these tests answer differently on the two platforms.

const SUT = join(ROOT, 'scripts', 'sut.mjs');
const SUT_URL = pathToFileURL(SUT).href;

/** A realpath that rewrites the paths in `map` and passes everything else through. */
const realpathThrough = (map) => (path) => map[path] ?? path;

test('invocation answers cli when the typed path resolves to this module', () => {
  // The subst case as it must now behave for a HEALTHY tree: whatever was typed, both sides reduce
  // to the same file, so the CLI runs.
  const realpath = realpathThrough({ '/mounted/scripts/sut.mjs': SUT, [SUT]: SUT });
  assert.equal(invocation(SUT_URL, '/mounted/scripts/sut.mjs', realpath), 'cli');
});

test('invocation reduces BOTH sides, so a mount and a short path are still the same file', () => {
  // Two measured environments, and they break a one-sided comparison in OPPOSITE directions. Under
  // `subst`, `import.meta.url` keeps the substituted drive and only the real path resolves it. Under
  // an 8.3 path — `os.tmpdir()` is `C:\Users\N78A3~1.SHE\AppData\Local\Temp` on this machine, and
  // `tests/ralph.test.mjs` builds its clone there — `import.meta.url` and `fs.realpathSync` both keep
  // the short name and only `realpathSync.native` expands it. Comparing the module URL against the
  // native real path of argv[1] therefore calls a healthy `node scripts/steps-inventory.mjs` broken:
  // measured, that is exactly what happened, and the clone's gate went red.
  // `resolve` first, so the two sides start from the same spelling on both platforms — a bare
  // `/mounted/...` becomes `C:\mounted\...` on win32 the moment it goes through a file URL.
  const substituted = resolve('/mounted/scripts/sut.mjs');
  const behindIt = resolve('/real/scripts/sut.mjs');
  const mount = realpathThrough({ [substituted]: behindIt });
  assert.equal(invocation(pathToFileURL(substituted).href, substituted, mount), 'cli');

  const eightThree = resolve('/vol/SHORT~1/steps.mjs');
  const longName = resolve('/vol/a-very-long-name/steps.mjs');
  const expand = realpathThrough({ [eightThree]: longName });
  assert.equal(invocation(pathToFileURL(eightThree).href, eightThree, expand), 'cli');
});

test('invocation answers cli for a genuine direct execution, with the real realpath', () => {
  // Exercises the default argument too — the branch every gate invocation actually takes.
  assert.equal(invocation(SUT_URL, SUT), 'cli');
});

test('invocation answers broken when the typed path names this file but is a different file', () => {
  // The residual, and the reason the silent exit 0 is now unreachable: whatever any realpath does,
  // a command that names `sut.mjs` and cannot be confirmed as `sut.mjs` gets a refusal rather than
  // the inert branch. This used to be indistinguishable from an import.
  assert.equal(invocation(SUT_URL, '/mounted/scripts/sut.mjs', (p) => p), 'broken');
});

test('invocation answers import when argv[1] names some other file', () => {
  // This is the case the whole guard exists for, and it must stay silent: `tests/sut.test.mjs`
  // imports `scripts/sut.mjs`, and a `cli` answer there would run docker inside the test runner.
  assert.equal(invocation(SUT_URL, '/mounted/tests/sut.test.mjs', (p) => p), 'import');
  assert.equal(invocation(SUT_URL, '/mounted/loop/ralph.mjs', (p) => p), 'import');
});

test('invocation treats a missing argv[1] as an import rather than as a broken invocation', () => {
  // `node -e`, `node --eval`, the REPL: there is no entry path at all, and nothing was invoked.
  for (const entry of [undefined, '', null, 0]) {
    assert.equal(invocation(SUT_URL, entry, (p) => p), 'import');
  }
});

test('invocation calls a realpath failure broken only when this file was the one named', () => {
  // A realpath that throws proves nothing either way, so the name on the command line decides. Named
  // — someone tried to run this script and it cannot be confirmed, which is a refusal. Not named —
  // an import, and silence.
  const throws = () => {
    throw new Error('ENOENT: no such file or directory');
  };
  assert.equal(invocation(SUT_URL, '/gone/scripts/sut.mjs', throws), 'broken');
  assert.equal(invocation(SUT_URL, '/gone/tests/sut.test.mjs', throws), 'import');
});

test('invocation compares the file name case-insensitively on win32 only', () => {
  // `node scripts\SUT.mjs` names the same file on Windows and a different one on Linux.
  const expected = process.platform === 'win32' ? 'broken' : 'import';
  assert.equal(invocation(SUT_URL, '/mounted/scripts/SUT.mjs', (p) => p), expected);
});

test('brokenInvocationMessage names the typed path AND the real path, because the pair is the fault', () => {
  // Either path alone looks correct. It is the disagreement that has to reach the operator, so the
  // diagnosis is worthless if it prints only one of them.
  const message = brokenInvocationMessage(SUT_URL, SUT, 'the database was not reset');
  assert.ok(message.includes(SUT), 'the typed path must be named');
  assert.ok(message.includes(SUT_URL), 'and the module url it disagreed with');
  assert.match(message, /real path/);
  assert.match(message, /the database was not reset/, 'the consequence must survive');
  assert.match(message, /^sut\.mjs: /, 'every line is prefixed with the script that is refusing');
});

test('brokenInvocationMessage still produces a diagnosis when the typed path cannot be resolved', () => {
  // The refusal must never itself throw: an unresolvable path is precisely one of the states that
  // gets here, and a crash would replace the diagnosis with a stack trace.
  const message = brokenInvocationMessage(SUT_URL, '/no/such/scripts/sut.mjs');
  assert.match(message, /could not be resolved/);
  assert.match(message, /refusing to run/);
});

// ── run ───────────────────────────────────────────────────────────────────────

test('run returns ok:true and captures stdout', () => {
  const result = run(process.execPath, ['-e', 'console.log("hello")']);
  assert.equal(result.ok, true);
  assert.match(result.out, /hello/);
});

test('run returns ok:false for a non-zero exit and never throws', () => {
  const result = run(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 3);
});

test('run returns ok:false for a missing binary instead of throwing', () => {
  const result = run('definitely-not-a-real-binary-xyz', []);
  assert.equal(result.ok, false);
});

test('run reports a command that succeeded with 3 MB of stdout as ok:true', () => {
  // The default spawnSync maxBuffer is 1 MB: exceeding it KILLS the child, sets status to null and
  // yields ok:false for a command that exited 0. Measured before the fix: a child that wrote 3 MB
  // and exited 0 came back ok=false, status=null, out truncated at 1114112 bytes. `dotnet test`
  // with a few failing BDD scenarios crosses 1 MB easily, so the gate would have called a passing
  // suite red and handed the agent a truncated log with no error in it.
  const result = run(process.execPath, [
    '-e',
    'process.stdout.write("x".repeat(3*1024*1024)); process.exit(0)',
  ]);
  assert.equal(result.ok, true, 'a command that exited 0 must be ok regardless of output size');
  assert.equal(result.status, 0);
  assert.equal(result.out.length, 3 * 1024 * 1024);
});

test('run exposes stdout and stderr separately as well as merged', () => {
  const result = run(process.execPath, [
    '-e',
    'process.stdout.write("OUT"); process.stderr.write("ERR");',
  ]);
  assert.equal(result.stdout, 'OUT');
  assert.equal(result.stderr, 'ERR');
  assert.equal(result.out, 'OUTERR');
});

test('run surfaces a reason when the process never started', () => {
  // Without this, a bad cwd produced a red step with a completely EMPTY log — the worst outcome
  // for a blind loop, which then cannot tell a failed check from a broken checker.
  const result = run(process.execPath, ['-e', 'console.log(1)'], { cwd: join(tmpdir(), 'no-such-dir-zz') });
  assert.equal(result.ok, false);
  assert.ok(result.out.trim().length > 0, 'a failure must never come back with an empty log');
});

test('run does not fabricate an output line for a command that succeeded', () => {
  // spawnSync sets `error` even on SUCCESS: when `input` exceeds the OS pipe buffer and the child
  // exits without draining stdin, it reports EOF while status stays 0. Measured threshold: 65537
  // bytes. Appending the error message there would put a line the command never printed into `out`,
  // the field every gate parses — and for a command that printed nothing, `out` would be entirely
  // fabricated.
  const result = run(process.execPath, ['-e', 'process.stdout.write("VERDICT: PASS")'], {
    input: 'x'.repeat(70 * 1024),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
  assert.equal(result.out, 'VERDICT: PASS');
  assert.ok(!result.out.includes('run:'), 'a successful command must not gain a fabricated line');
});

test('run returns instead of throwing when the arguments are malformed', () => {
  // "Never throws" is this module's headline promise, and its consumers are gates that must not
  // crash. spawnSync validates argument TYPES by throwing rather than by returning an error.
  const result = run(process.execPath, '-e "1"');
  assert.equal(result.ok, false);
  assert.ok(result.out.length > 0);
});

test('run retries through a shell on Windows so .cmd shims resolve', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only behaviour');
  // npm is a .cmd shim: without the fallback this returns status null with ENOENT. This test is
  // what stops the fallback from being deleted as dead code.
  const result = run('npm', ['-v']);
  assert.equal(result.ok, true, 'npm -v must resolve through the shell fallback');
  assert.match(result.out, /\d+\.\d+\.\d+/);
});

// ── git ───────────────────────────────────────────────────────────────────────

test('git returns the empty string for a failing command, never its error text', () => {
  // Measured before the fix: this exact call returned 187 characters of "fatal: ambiguous argument
  // 'HEAD~99'..." which a caller doing .split('\n') parsed as THREE plausible filenames.
  const out = git(ROOT, 'diff', '--name-only', 'HEAD~99999', 'HEAD');
  assert.equal(out, '');
});

test('gitTry reports the failure and keeps the error text out of the value', () => {
  const failed = gitTry(ROOT, 'diff', '--name-only', 'HEAD~99999', 'HEAD');
  assert.equal(failed.ok, false);
  assert.equal(failed.out, '');
  assert.match(failed.error, /fatal/i);

  const ok = gitTry(ROOT, 'rev-parse', '--abbrev-ref', 'HEAD');
  assert.equal(ok.ok, true);
  assert.ok(ok.out.length > 0);
  assert.equal(ok.error, '');
});

test('git preserves the leading status column of `status --porcelain`', () => {
  // The real test for trimEnd()-not-trim(). The previous version asserted
  // `out === out.trimEnd()`, which is a tautology — it passed identically whether git() used
  // trimEnd() or trim(), i.e. it went green on the exact regression it was named after.
  // An unstaged edit to a tracked file reports as `" M path"`, so the leading space is the thing
  // that must survive. Built in a throwaway repo so this test never touches the real working tree.
  const sandbox = mkdtempSync(join(tmpdir(), 'lib-git-'));
  try {
    run('git', ['-C', sandbox, 'init', '-q']);
    writeFileSync(join(sandbox, 'tracked.txt'), 'one\n');
    run('git', ['-C', sandbox, 'add', '-A']);
    run('git', [
      '-C', sandbox,
      '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
      'commit', '-qm', 'seed', '--no-verify',
    ]);
    writeFileSync(join(sandbox, 'tracked.txt'), 'two\n');

    const out = git(sandbox, 'status', '--porcelain');
    assert.ok(out.startsWith(' M'), `expected a leading space then M, got ${JSON.stringify(out)}`);
    assert.ok(!out.endsWith('\n'), 'the trailing newline must be trimmed');
    // A caller slicing off the two-character status code plus its separator must get the whole path.
    assert.equal(out.slice(3), 'tracked.txt');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ── Verdict ───────────────────────────────────────────────────────────────────

/** Runs a snippet against the real Verdict in a child, because report() calls process.exit(). */
const verdictExit = (body) =>
  run(process.execPath, [
    '--input-type=module',
    '-e',
    `const { Verdict } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/lib.mjs')).href)});\n${body}`,
  ]);

test('Verdict.report exits 0 when every check passed', () => {
  const result = verdictExit('const v = new Verdict("t"); v.check(true, "good", "bad"); v.report();');
  assert.equal(result.status, 0);
  assert.match(result.out, /OK — 1 check/);
});

test('Verdict.report exits 1 when any check failed', () => {
  // The single most dangerous untested thing in the harness: an inverted comparison here would
  // make every red gate report green to the loop.
  const result = verdictExit(
    'const v = new Verdict("t"); v.check(true, "good", "bad"); v.check(false, "good", "the problem"); v.report();'
  );
  assert.equal(result.status, 1);
  assert.match(result.out, /the problem/);
  assert.match(result.out, /FAIL — 1 problem/);
});

test('Verdict.report exits 1 when no checks ran at all', () => {
  // A gate that checked NOTHING is not a passing gate. An early return or a lost manifest would
  // otherwise print a green light produced by a broken checker.
  const result = verdictExit('new Verdict("t").report();');
  assert.equal(result.status, 1);
  assert.match(result.out, /no checks ran/i);
});

// ── The git contract the runner's "did the agent leave work behind?" test rests on ────
//
// After a turn the runner asks `git status --porcelain --untracked-files=normal -- framework` and
// treats any output as "the agent left work in the working tree that the gate graded and the judge
// will never see". Three properties make that question answerable, and none of them is obvious:
// a MODIFIED tracked file must be reported, a BRAND-NEW untracked file must be reported, and ignored
// build output must not be. `git diff HEAD` satisfies only the first — measured — which is why it was
// rejected. This pins all three against real git rather than against a belief about it.

/** A throwaway repository with one commit, a .gitignore, and a `framework/` tree. */
function gitSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ralph-porcelain-'));
  const project = join(dir, 'framework', 'src', 'Api');
  mkdirSync(join(project, 'bin'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'framework/**/bin/\n');
  writeFileSync(join(dir, 'outside.txt'), 'not under framework\n');
  writeFileSync(join(project, 'Committed.cs'), 'committed\n');
  const q = (...args) => run('git', ['-C', dir, ...args]);
  q('init');
  q('config', 'user.email', 'sandbox@local');
  q('config', 'user.name', 'sandbox');
  q('add', '-A');
  q('commit', '-m', 'base');
  return { dir, project };
}

const leftBehind = (dir) =>
  gitTry(dir, 'status', '--porcelain', '--untracked-files=normal', '--', 'framework');

test('the left-behind probe is silent when the turn committed everything', () => {
  const { dir } = gitSandbox();
  const result = leftBehind(dir);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.out, '', 'a clean framework/ must produce no output, or every turn fails');
  rmSync(dir, { recursive: true, force: true });
});

test('the left-behind probe is silent when framework/ does not exist yet', () => {
  // Stage 0 iteration 1: nothing has been built. A pathspec matching nothing must not be an error, or
  // the loop would stop before it started — the failure class that has bitten this task twice.
  const dir = mkdtempSync(join(tmpdir(), 'ralph-empty-'));
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  for (const args of [['init'], ['config', 'user.email', 's@l'], ['config', 'user.name', 's'], ['add', '-A'], ['commit', '-m', 'base']]) {
    run('git', ['-C', dir, ...args]);
  }
  const result = leftBehind(dir);
  assert.equal(result.ok, true, `a pathspec matching nothing must not fail: ${result.error}`);
  assert.equal(result.out, '');
  rmSync(dir, { recursive: true, force: true });
});

test('the left-behind probe reports a modified tracked file AND an untracked new one', () => {
  const { dir, project } = gitSandbox();
  writeFileSync(join(project, 'Committed.cs'), 'committed\nedited\n');
  writeFileSync(join(project, 'BrandNew.cs'), 'never committed\n');

  const out = leftBehind(dir).out;
  assert.match(out, /Committed\.cs/, 'a modified tracked file must be reported');
  assert.match(out, /BrandNew\.cs/, 'an untracked new file must be reported — this is the whole point');

  // The rejected alternative, kept as a live comparison so the reason survives: `git diff HEAD` sees
  // only tracked paths, so a brand-new step-definition file left uncommitted passes it.
  const viaDiff = gitTry(dir, 'diff', '--name-only', 'HEAD', '--', 'framework').out;
  assert.match(viaDiff, /Committed\.cs/);
  assert.doesNotMatch(viaDiff, /BrandNew\.cs/, 'if diff HEAD ever sees untracked files, revisit the choice');

  rmSync(dir, { recursive: true, force: true });
});

test('the left-behind probe ignores build output and anything outside framework/', () => {
  const { dir, project } = gitSandbox();
  writeFileSync(join(project, 'bin', 'Api.dll'), 'binary\n');
  writeFileSync(join(dir, 'outside.txt'), 'edited outside the fence\n');
  // The tracker is the file the agent is TOLD to leave uncommitted, and it lives outside framework/.
  mkdirSync(join(dir, 'loop', 'trackers'), { recursive: true });
  writeFileSync(join(dir, 'loop', 'trackers', 'tests.md'), 'uncommitted on purpose\n');

  const out = leftBehind(dir).out;
  assert.equal(out, '', `nothing outside framework/ may count as work left behind, got:\n${out}`);
  rmSync(dir, { recursive: true, force: true });
});

test('the left-behind probe still sees untracked files when git is configured to hide them', () => {
  // `status.showUntrackedFiles=no` is an ordinary setting, and a global template can carry it. Without
  // the explicit flag the `??` line disappears and the probe silently degrades to the `diff HEAD`
  // version it replaced — passing exactly the brand-new uncommitted file it exists to catch.
  const { dir, project } = gitSandbox();
  run('git', ['-C', dir, 'config', 'status.showUntrackedFiles', 'no']);
  writeFileSync(join(project, 'BrandNew.cs'), 'never committed\n');

  assert.match(leftBehind(dir).out, /BrandNew\.cs/, 'the flag must override the config');
  // And the config really is in force, so this test cannot pass for the wrong reason.
  assert.doesNotMatch(
    gitTry(dir, 'status', '--porcelain', '--', 'framework').out,
    /BrandNew\.cs/,
    'without the flag the config should hide it — if not, this test proves nothing'
  );
  rmSync(dir, { recursive: true, force: true });
});

test('the UNSCOPED porcelain probe also needs the flag — it is the judge read-only proof', () => {
  // `statusBefore` / `statusAfter` around the judge call use the unscoped form. Under
  // `status.showUntrackedFiles=no` the bare command returns empty for a tree holding an untracked file,
  // so a judge that CREATED a file left both sides equal and was certified read-only — the unprovable
  // green the design refuses. This is the same blindness as the scoped probe, one directory wider.
  const { dir, project } = gitSandbox();
  run('git', ['-C', dir, 'config', 'status.showUntrackedFiles', 'no']);

  const before = gitTry(dir, 'status', '--porcelain', '--untracked-files=normal');
  assert.equal(before.ok, true, before.error);
  assert.equal(before.out, '', 'the sandbox starts clean');

  // What a judge that is not read-only would do.
  writeFileSync(join(project, 'JudgeScratch.txt'), 'the judge wrote this\n');

  const after = gitTry(dir, 'status', '--porcelain', '--untracked-files=normal');
  assert.notEqual(after.out, before.out, 'creating a file must change the probe, or read-only is unprovable');
  assert.match(after.out, /JudgeScratch\.txt/);

  // And the bare form really is blind here, so this test cannot pass for the wrong reason.
  assert.equal(
    gitTry(dir, 'status', '--porcelain').out,
    '',
    'without the flag the config hides it — if not, this test proves nothing'
  );
  rmSync(dir, { recursive: true, force: true });
});

test('a baseline of porcelain lines separates a new stray from what was already there', () => {
  // The runner records `framework/` at startup and subtracts that set from the post-turn probe, so an
  // operator running with --allow-dirty keeps their own edits without losing the check. This pins the
  // subtraction against real git output rather than against a belief about its format.
  const { dir, project } = gitSandbox();
  const probe = () =>
    gitTry(dir, 'status', '--porcelain', '--untracked-files=normal', '--', 'framework')
      .out.split('\n')
      .filter((line) => line.trim() !== '');

  // The operator's own uncommitted edit, present before the loop starts.
  writeFileSync(join(project, 'Committed.cs'), 'committed\noperator edit\n');
  const baseline = new Set(probe());
  assert.equal(baseline.size, 1);

  // Nothing new yet: the operator's line must not be reported as the turn's work.
  assert.deepEqual(
    probe().filter((line) => !baseline.has(line)),
    [],
    'the operator’s own edit must not be blamed on the agent'
  );

  // Now the turn leaves a brand-new file behind. A different line, so the subtraction sees it.
  writeFileSync(join(project, 'LeftBehind.cs'), 'never committed\n');
  const strays = probe().filter((line) => !baseline.has(line));
  assert.equal(strays.length, 1);
  assert.match(strays[0], /LeftBehind\.cs/);
  assert.doesNotMatch(strays.join('\n'), /Committed\.cs/);

  rmSync(dir, { recursive: true, force: true });
});

test('a staged-but-uncommitted file is a different porcelain line, so staging cannot hide it', () => {
  // `git add` without a commit changes `??` to `A `, which is NOT the line the baseline recorded — so
  // an agent that stages its work and forgets to commit is still caught. Worth pinning: if git ever
  // reported the same line for both, the baseline would filter the stray out.
  const { dir, project } = gitSandbox();
  writeFileSync(join(project, 'Staged.cs'), 'new\n');
  const untracked = gitTry(dir, 'status', '--porcelain', '--untracked-files=normal', '--', 'framework').out;
  run('git', ['-C', dir, 'add', '--', 'framework']);
  const staged = gitTry(dir, 'status', '--porcelain', '--untracked-files=normal', '--', 'framework').out;

  assert.match(untracked, /^\?\? /, 'an untracked file reports as ??');
  assert.match(staged, /^A {2}/, 'a staged file reports as A');
  assert.notEqual(untracked, staged, 'staging must change the line, or a baseline could mask it');
  rmSync(dir, { recursive: true, force: true });
});

test('the per-row diff base file is gitignored, so it cannot pollute the probes beside it', () => {
  // `loop/verdicts/<id>.base` records the commit a turn started from, and it sits in the directory the
  // judge read-only probes measure. If it were ever tracked or unignored, writing it would look like
  // the judge modifying the repository — and the left-behind probe would see it too.
  for (const id of ['AC-F01-01', 'S14']) {
    const check = run('git', ['-C', ROOT, 'check-ignore', `loop/verdicts/${id}.base`]);
    assert.equal(check.status, 0, `loop/verdicts/${id}.base must be gitignored, got status ${check.status}`);
  }
  // And the directory itself is still kept, or a fresh clone would not have it.
  assert.equal(run('git', ['-C', ROOT, 'check-ignore', 'loop/verdicts/.gitkeep']).status, 1);
});
