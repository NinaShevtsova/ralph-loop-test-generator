// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The small shared toolbox every check script uses: run a command and report honestly what
// happened, ask git a question, find the project folder, and print a pass/fail summary the
// same way everywhere.
//
// It is deliberately tiny. These helpers sit underneath the checks that decide whether the
// AI's work is accepted, and a check nobody can read in a minute is a check that gets
// switched off the first time it goes red.
//
// The recurring theme here is refusing to confuse "it failed" with "there was nothing":
// a git command that errors must not come back looking like an empty answer, because the
// checks above would read that as "nothing is wrong".
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/lib.mjs — the shared minimum for every gate script.
//
// Everything here is deliberately tiny. A gate must be readable in a minute: if understanding
// a check requires first learning a check framework, the check gets switched off at the first red.

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

// The default spawnSync maxBuffer is 1 MB, and exceeding it KILLS the child, sets status to null
// and turns a command that exited 0 into ok:false with truncated output. `dotnet test` with a few
// failing BDD scenarios crosses 1 MB, so the gate would call a passing suite red and hand the agent
// a log with no error in it. Measured: 3 MB of stdout + exit 0 came back ok=false, status=null.
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Repository root: one level above scripts/.
 *
 * CLAUDE_PROJECT_DIR is honoured only when it actually points at THIS repository. The variable can
 * name a different project — this machine has more than one — and every gate would then check the
 * wrong tree while looking perfectly healthy: check:scaffold would report all 39 files missing and
 * check:tests would parse a stranger's diff. The same variable is rejected outright in
 * .claude/hooks/loop-memory.mjs, where a shell expands it and mangles the path on Windows.
 */
export function repoRoot(importMetaUrl) {
  const derived = resolve(dirname(fileURLToPath(importMetaUrl)), '..');

  const declared = process.env.CLAUDE_PROJECT_DIR;
  if (declared) {
    const candidate = resolve(declared);
    if (existsSync(join(candidate, 'scripts', 'lib.mjs'))) return candidate;
  }

  return derived;
}

/**
 * How a script file was reached: `'cli'`, `'import'` or `'broken'`.
 *
 * The guard every one of these scripts needs — "act as a CLI only when this file IS the main
 * module" — is usually written as `import.meta.url === pathToFileURL(process.argv[1]).href`, and in
 * that shape it fails **silently**: the two disagree, the whole CLI body is skipped, and the process
 * exits 0 having done nothing. `runGate` grades a step on its exit code alone, so `sut reset` then
 * reports a database it never reset and design D-09 is switched off without a word.
 *
 * The two spellings disagree more easily than they look, and in BOTH directions. Measured here:
 *
 *   - through `subst Z:` to the repository, `import.meta.url` keeps the substituted drive
 *     (`file:///Z:/scripts/sut.mjs`) while `realpathSync.native` resolves it to `C:\...` — so a
 *     comparison against the native real path says "not the main module" for a file that is;
 *   - under an 8.3 short path — `C:\Users\N78A3~1.SHE\AppData\Local\Temp\...`, which is what
 *     `os.tmpdir()` returns on this machine — it is the other way round: `import.meta.url` and
 *     `fs.realpathSync` both KEEP `N78A3~1.SHE`, and only `realpathSync.native` expands it to
 *     `n.shevtsova`. `tests/ralph.test.mjs` builds its clone there, so a native-only comparison
 *     calls a perfectly healthy `node scripts/steps-inventory.mjs` broken.
 *
 * So neither spelling is canonical on its own, and the fix is not to pick one: it is to reduce BOTH
 * sides the same way and compare the results. Junctions, symlinks, subst drives and short paths then
 * all resolve to the same file and answer `'cli'` — measured through a junction and through `subst`,
 * the CLI runs normally.
 *
 * `'broken'` is what makes the remainder safe. If the two sides still disagree while `argv[1]` names
 * THIS file, something was invoked and could not be confirmed, and the caller must fail loudly
 * rather than fall through to the inert branch. Because that name check does not depend on any
 * realpath, `node <anything>/sut.mjs` can no longer end in a silent 0 by any route: it either does
 * the work or exits non-zero.
 *
 * An import — a test importing the module while `argv[1]` names some other file — still answers
 * `'import'` and stays silent, which `tests/sut.test.mjs` depends on.
 *
 * `realpath` is injectable so all three answers can be driven from a test.
 */
export function invocation(moduleUrl, entry, realpath = realpathSync.native) {
  if (typeof entry !== 'string' || entry === '') return 'import';

  // The strongest identity available for a path, falling back rather than throwing: `realpath`
  // needs the file to exist, and "it is gone" is a state this function has to survive.
  const identity = (path) => {
    for (const attempt of [() => realpath(path), () => resolve(path)]) {
      try {
        const value = attempt();
        if (value) return process.platform === 'win32' ? value.toLowerCase() : value;
      } catch {
        /* try the next one */
      }
    }
    return '';
  };

  let own;
  try {
    own = fileURLToPath(moduleUrl);
  } catch {
    return 'import';
  }

  const mine = identity(own);
  const theirs = identity(entry);
  if (mine !== '' && mine === theirs) return 'cli';

  // Case-insensitively on win32, where `node scripts\SUT.mjs` names the same file.
  const typed = basename(entry);
  const name = basename(own);
  const named =
    process.platform === 'win32' ? typed.toLowerCase() === name.toLowerCase() : typed === name;

  return named ? 'broken' : 'import';
}

/**
 * The diagnosis for a `'broken'` invocation. Names the typed path and the real path, because those
 * two disagreeing IS the fault and neither one alone shows it.
 *
 * `consequence` is the caller's one line about what silently did not happen — the reason this is
 * worth a non-zero exit rather than a shrug.
 */
export function brokenInvocationMessage(moduleUrl, entry, consequence = '') {
  const own = basename(fileURLToPath(moduleUrl));
  let real;
  try {
    real = realpathSync.native(entry);
  } catch (error) {
    real = `<could not be resolved: ${error?.message ?? error}>`;
  }

  return [
    `${own}: refusing to run — invoked as a command, but Node did not resolve this file as the main module.`,
    `${own}:   typed path   ${entry}`,
    `${own}:   real path    ${real}`,
    `${own}:   module url   ${moduleUrl}`,
    `${own}: the file Node loaded and the file the command named do not reduce to the same path.`,
    `${own}: junctions, symlinks, subst drives and 8.3 short paths are reconciled before this point,`,
    `${own}: so what is left is a path that does not exist or points into a different checkout.`,
    ...(consequence ? [`${own}: ${consequence}`] : []),
  ].join('\n');
}

/**
 * Runs a command and returns { ok, out, stdout, stderr, status }. Never throws — its consumers are
 * gates, and a crashed gate is worse than a red one: the loop then cannot tell "the check failed"
 * from "the checker broke".
 */
export function run(cmd, args, options = {}) {
  const spawnOptions = { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...options };

  // spawnSync validates argument TYPES by throwing rather than by returning an error, so the
  // never-throws promise needs a real guard, not just a hope that every caller passes an array.
  const attempt = (extra) => {
    try {
      return spawnSync(cmd, args, { ...spawnOptions, ...extra });
    } catch (error) {
      return { status: null, stdout: '', stderr: '', error };
    }
  };

  let result = attempt();
  const firstError = result.error;

  // npm and most npm-installed CLIs on Windows are `.cmd` shims: without a shell they do not
  // start at all. Plain `.exe` binaries (git in particular) must go direct — a shell re-parses
  // the arguments and mangles, for example, a commit message containing spaces.
  //
  // The retry additionally requires ENOENT/EINVAL, so a process killed by a signal or a timeout
  // (status null, but error ETIMEDOUT) is never re-run: no command with side effects executes twice.
  if (
    process.platform === 'win32' &&
    options.shell === undefined &&
    result.status === null &&
    ['ENOENT', 'EINVAL'].includes(result.error?.code)
  ) {
    const retried = attempt({ shell: true });
    // When the retry fails too, the FIRST error is the accurate one. A non-existent `cwd` makes
    // both spawns fail with ENOENT, and the retry's message names `cmd.exe` — a binary the caller
    // never asked for — so the loop would read "cmd.exe is missing" instead of "that directory
    // does not exist". The whole point of surfacing the error is to give a blind agent something
    // actionable, and a confidently wrong diagnosis is worse than a vague one.
    result = retried.status === null && firstError ? { ...retried, error: firstError } : retried;
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const merged = `${stdout}${stderr}`;

  return {
    ok: result.status === 0,
    // Without result.error a failure returns a red step with an EMPTY log — nothing to read,
    // nothing to fix, which for a blind loop is the worst possible outcome.
    //
    // Gated on the FAILURE, not on `result.error` alone. spawnSync also sets `error` on a
    // SUCCESSFUL command: when `input` exceeds the OS pipe buffer and the child exits without
    // draining stdin, it reports EOF while `status` stays 0. Measured threshold: 65537 bytes.
    // Appending there would inject a line the command never printed into `out` — the very field
    // every gate parses — and for a command that printed nothing, `out` would be entirely
    // fabricated.
    out:
      result.status !== 0 && result.error
        ? `${merged}${merged ? '\n' : ''}run: ${result.error.message}`
        : merged,
    stdout,
    stderr,
    status: result.status,
  };
}

/**
 * git inside the repository root, with the success flag kept.
 *
 * Returns STDOUT only. `run()` merges stdout and stderr, so returning the merged value would hand
 * git's own error text back as if it were data: measured, `git diff --name-only HEAD~99 HEAD`
 * yields 187 characters of "fatal: ambiguous argument…" that a caller doing `.split('\n')` parses
 * as THREE plausible-looking filenames. `HEAD~1` failing is not exotic — a root commit or a shallow
 * clone produces it. Appending stderr also contaminates SUCCESSFUL commands, because git writes its
 * `warning:` lines there.
 */
export function gitTry(root, ...args) {
  const result = run('git', ['-C', root, ...args]);
  return {
    ok: result.ok,
    out: result.ok ? result.stdout.trimEnd() : '',
    error: result.ok ? '' : result.out.trim(),
  };
}

/**
 * git inside the repository root. The value on success, the empty string on failure.
 *
 * Use `gitTry` instead wherever an empty result and a failure must not look the same.
 *
 * trimEnd(), NOT trim(). In `git status --porcelain` the first two characters of a line are the
 * status code, and for an unstaged edit that looks like `" M path"`. A full trim() would eat the
 * leading space of the FIRST line, and anyone slicing `line.slice(3)` would get a path missing
 * its first character: `.claude/…` becomes `claude/…`.
 */
export function git(root, ...args) {
  return gitTry(root, ...args).out;
}

/** Collects check results and prints them identically in every gate. */
export class Verdict {
  constructor(title) {
    this.title = title;
    this.ok = [];
    this.fails = [];
  }

  check(condition, good, bad) {
    if (condition) this.ok.push(good);
    else this.fails.push(bad);
    return condition;
  }

  pass(message) {
    this.ok.push(message);
  }

  fail(message) {
    this.fails.push(message);
  }

  /** Prints the summary and exits with the right code. Never returns. */
  report({ quiet = false } = {}) {
    if (!quiet) for (const line of this.ok) console.log(`  ok  ${line}`);
    for (const line of this.fails) console.error(`  FAIL ${line}`);

    console.log('');

    // A gate that checked NOTHING is not a passing gate. An early return, a lost manifest or an
    // empty file list would otherwise print a green light produced by a broken checker — the one
    // outcome this entire design exists to prevent.
    if (this.ok.length === 0 && this.fails.length === 0) {
      console.error(`${this.title} FAIL — no checks ran at all; the gate itself is broken.`);
      process.exit(1);
    }

    if (this.fails.length > 0) {
      console.error(`${this.title} FAIL — ${this.fails.length} problem(s).`);
      process.exit(1);
    }
    console.log(`${this.title} OK — ${this.ok.length} check(s).`);
    process.exit(0);
  }
}
