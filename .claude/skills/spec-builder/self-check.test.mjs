// .claude/skills/spec-builder/self-check.test.mjs — the Skill's guarantees about itself.
//
//   node --test <path-to-this-skill>/self-check.test.mjs
//
// TRAVELS WITH THE SKILL, and that is the whole reason it is here rather than in the repository's
// `tests/`. `references/spec-layout.md` states that a test holds it level with the gate, and
// `references/validation.md` tells an author not to restate a check anywhere else BECAUSE that
// document is pinned to the code. Both sentences were false the moment the folder was copied: the
// test enforcing them lived outside it, so a copied Skill claimed a guarantee that nothing provided.
//
// Everything here is resolved from this file's own directory and reads nothing outside it. What stays
// in the repository's `tests/` is what is genuinely about the repository: the fixtures built from the
// one reference package, and the rule forbidding that package's vocabulary in these instruction files.
//
// Node's test runner skips dot-directories, so `node --test` at a repository root will not find this
// file on its own. `tests/skill-hygiene.test.mjs` imports it for exactly that reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)));
const REFERENCES = join(SKILL, 'references');
const GATE = join(SKILL, 'check-spec.mjs');

/** Every markdown file the Skill ships, relative to the Skill folder. */
function instructionFiles() {
  const files = [];
  if (existsSync(join(SKILL, 'SKILL.md'))) files.push('SKILL.md');
  if (existsSync(REFERENCES)) {
    for (const name of readdirSync(REFERENCES).filter((f) => f.endsWith('.md')).sort()) {
      files.push(`references/${name}`);
    }
  }
  return files;
}

test('spec-layout.md documents every format the gate enforces', () => {
  // Prose describing formats drifts from the code checking them. `--list-checks` prints the gate's own
  // inventory of check kinds; the reference document must name each one, so adding a check without
  // documenting it turns this red. It is the only thing tying the document to the code.
  //
  // No `--spec` is passed: this asks the gate about itself, and requiring a package here would make
  // the tie conditional on having one to hand.
  const listed = execFileSync(process.execPath, [GATE, '--list-checks'], { encoding: 'utf8' });

  const titles = listed
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // The floor is the number the gate actually runs, not a token minimum. Set below that, it is
  // satisfied by a CHECKS array with two thirds of its entries deleted — and the parity assertion
  // below would then certify a document that describes two thirds of the gate.
  assert.ok(titles.length >= 25, `expected at least 25 checks, got ${titles.length}`);

  const document = readFileSync(join(REFERENCES, 'spec-layout.md'), 'utf8');
  const undocumented = titles.filter((title) => !document.includes(title));
  assert.deepEqual(undocumented, [], 'checks the gate runs but spec-layout.md does not mention');
});

test('nothing in the Skill ships unfinished', () => {
  // A placeholder in a file a model reads is worse than a missing file: the model follows it. "TBD" in
  // a rule about assertions produces a criterion with a hole where the assertion should be.
  const UNFINISHED = [/\bTBD\b/, /\bTODO\b/, /\bFIXME\b/, /\bXXX\b/, /\.\.\.\s*$/, /<fill in[^>]*>/i];

  const files = instructionFiles();
  assert.ok(files.length > 0, 'no instruction files found; has the Skill folder moved?');

  const offences = [];
  for (const relative of files) {
    // Fenced blocks are skipped, as they are in every scan `check-spec.mjs` performs. These files owe
    // BAD examples — a criterion with a hole where an assertion belongs, an unanswered question — and
    // the natural way to show one is a fenced sample containing the very vocabulary this gate refuses.
    // Without this the gate rejects a correct file for illustrating the thing it is warning about.
    let fenced = false;

    readFileSync(join(SKILL, relative), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/^\s*```/.test(line)) {
          fenced = !fenced;
          return;
        }
        if (fenced) return;

        for (const pattern of UNFINISHED) {
          if (pattern.test(line)) offences.push(`${relative}:${index + 1} ${line.trim().slice(0, 60)}`);
        }
      });
  }

  assert.deepEqual(offences, [], 'unfinished text in files a model reads as instructions');
});

test('SKILL.md and references/ agree about which files exist', () => {
  // Both directions. A `references/` file SKILL.md never names is never loaded, so its rules do not
  // reach the model that needs them — the most expensive kind of dead code, because it looks alive. A
  // SKILL.md line naming a file that does not exist sends the model looking for guidance it will not
  // find, mid-task.
  if (!existsSync(join(SKILL, 'SKILL.md'))) {
    assert.fail('SKILL.md does not exist, so nothing can invoke this Skill');
  }

  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  const named = new Set([...skill.matchAll(/references\/([a-z0-9-]+\.md)/g)].map((m) => m[1]));
  const present = new Set(
    existsSync(REFERENCES) ? readdirSync(REFERENCES).filter((f) => f.endsWith('.md')) : []
  );

  // Both assertions below compare sets, and two empty sets are equal — so with `references/` emptied
  // this test would report ok having compared nothing, which is the failure mode the rest of this
  // suite exists to refuse. A Skill whose detail lives nowhere is not a Skill with sound
  // cross-references; it is one with nothing to look anything up in.
  assert.ok(present.size > 0, 'references/ holds no .md files, so there is nothing to cross-check');

  const missing = [...named].filter((name) => !present.has(name));
  assert.deepEqual(missing, [], 'SKILL.md names reference files that do not exist');

  const unloaded = [...present].filter((name) => !named.has(name));
  assert.deepEqual(unloaded, [], 'reference files SKILL.md never loads, so nothing reads them');
});

test('every markdown table row of the Skill is one physical line', () => {
  // GFM ends a table at the first line that is not a row, so a row wrapped across two lines truncates
  // the table there and renders the remainder as loose text. Measured in `references/ac-rules.md`: the
  // six-category table lost its last two rows — including the one distinguishing a record's own route
  // from a cascade — while the file still read correctly in a plain-text diff, which is where it was
  // reviewed.
  const offences = [];
  for (const relative of instructionFiles()) {
    let fenced = false;

    readFileSync(join(SKILL, relative), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/^\s*```/.test(line)) {
          fenced = !fenced;
          return;
        }
        if (fenced) return;

        const trimmed = line.trim();
        if (trimmed.startsWith('|') && !trimmed.endsWith('|')) {
          offences.push(`${relative}:${index + 1} ${trimmed.slice(0, 60)}`);
        }
      });
  }

  assert.deepEqual(offences, [], 'table rows that do not close, so the table ends early when rendered');
});
