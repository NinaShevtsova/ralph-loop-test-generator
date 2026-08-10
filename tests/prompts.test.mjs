// tests/prompts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const read = (name) => readFileSync(join(ROOT, 'loop', name), 'utf8');

test('the scaffold prompt tells the agent the turn is cold and state lives on disk', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /one turn/i);
  assert.match(text, /on disk/i);
});

test('the scaffold prompt forbids writing done and requires review', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /`review`/);
  assert.ok(/never.*`done`|`done`.*runner/is.test(text), 'must state that only the runner writes done');
});

test('the scaffold prompt names the gate commands', () => {
  const text = read('PROMPT.scaffold.md');
  for (const command of ['scripts/check-scaffold.mjs', 'dotnet build', 'npm run sut -- reset', 'dotnet test']) {
    assert.ok(text.includes(command), `missing gate command: ${command}`);
  }
  // The scope flag is the whole point: an unscoped manifest check is red until the last row, and the
  // runner reads a red gate as a reason to stop. A prompt that omits it teaches the agent to run a
  // check that cannot pass.
  //
  // And it must be the ROW scope, the same one the runner's post-turn gate uses. `--through-wave`
  // here would send the agent to a check that demands its siblings' files: on the live run that cost
  // an iteration, the agent correctly refused to commit against a red gate, and the only ways out it
  // could see were to build another task's files or to stop.
  assert.match(text, /check-scaffold\.mjs --through-row/);
  assert.ok(
    !/check-scaffold\.mjs --through-wave/.test(text),
    'the agent must self-check at the scope the runner grades it at, and the wave scope is not it'
  );
});

test('the scaffold prompt asks for one TASK per turn, not one wave', () => {
  // The runner refuses a turn that advances any row but its target (`forbiddenStatusWrites`), and the
  // judge grades a diff that must belong to one row. A prompt still saying "build every task in that
  // wave" contradicts both, and the agent obeying it deadlocks the row the judge was asked about.
  const text = read('PROMPT.scaffold.md');
  assert.ok(/one task per turn/i.test(text), 'the prompt must state the one-task rule');
  assert.ok(
    !/Build \*\*every task in that wave\*\*/.test(text),
    'the wave-per-turn instruction is what the one-row rule replaced'
  );
  assert.ok(/judge/i.test(text) && /diff/i.test(text), 'and must say why: the judge grades a diff');
});

test('both prompts explain the rework state the runner sends them', () => {
  // The runner writes `rework` and appends judge findings stage-agnostically, so a prompt that never
  // mentions it hands the agent an input it has no instruction for.
  for (const file of ['PROMPT.scaffold.md', 'PROMPT.tests.md']) {
    const text = read(file);
    assert.match(text, /rework/, `${file} never mentions rework`);
    assert.ok(/findings/.test(text), `${file} never mentions the judge's findings`);
  }
});

test('the scaffold prompt carries the blocked escape hatch', () => {
  assert.match(read('PROMPT.scaffold.md'), /`blocked`/);
});

test('the scaffold prompt requires a journal entry even on a turn with no progress', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /JOURNAL\.md/);
  assert.match(text, /no progress/i);
});

test('the scaffold prompt forbids push and branch switching', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /git push/);
  assert.ok(/checkout|switch/.test(text), 'must forbid branch switching');
});
test('the tests prompt forbids reading the openapi contract — D-16', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /openapi\.yaml/);
  assert.ok(/do not read|forbidden|never read/i.test(text), 'must forbid reading the contract');
});

test('the tests prompt makes the step inventory mandatory reading', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /loop\/STEPS\.md/);
  assert.ok(/before writing any step|mandatory/i.test(text), 'STEPS.md must be mandatory reading');
});

test('the tests prompt requires exactly one scenario per turn', () => {
  assert.match(read('PROMPT.tests.md'), /exactly one/i);
});

test('the tests prompt names the fence: only Features, StepDefinitions, Data', () => {
  const text = read('PROMPT.tests.md');
  for (const dir of ['Features/', 'StepDefinitions/', 'Data/']) {
    assert.ok(text.includes(dir), `missing fenced directory: ${dir}`);
  }
});

test('the tests prompt forbids done and requires review', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /`review`/);
  assert.ok(/never.*`done`|`done`.*runner/is.test(text), 'must state that only the runner writes done');
});

test('the tests prompt names the AC commit trailer', () => {
  assert.match(read('PROMPT.tests.md'), /AC:\s*AC-F/);
});

test('the tests prompt forbids Scenario Outline', () => {
  assert.match(read('PROMPT.tests.md'), /Scenario Outline/);
});

test('the tests prompt requires the gate to run the whole suite', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /dotnet test/);
  assert.ok(/whole suite|all scenarios|every scenario/i.test(text), 'must require the full suite');
});

// ── B1: the gate is ordered before the commit, and the prompt says why ────────────────
//
// These assert the ORDERING and the REASON, not that the words appear. The mutation review replaced
// the whole of this file with a nine-line bag of the tokens its tests grep for and all 278 tests
// still passed; a keyword pin on a prompt proves the vocabulary is present, not that any instruction
// survives.

test('the tests prompt runs check-tests.mjs BEFORE the commit, in that order on the page', () => {
  // `check-tests.mjs` reads the union of the working tree and everything committed since `--base`,
  // which defaults to `HEAD`. Uncommitted, that union is exactly the turn's own files — measured, the
  // agent's pre-commit run exits 0 with 15 checks. The prompt's step 4 also forbids committing with a
  // red gate, so an ordering that put the check after the commit would leave the agent's only legal
  // moves `blocked` or disobedience.
  const text = read('PROMPT.tests.md');
  const gate = text.indexOf('scripts/check-tests.mjs');
  const commit = text.indexOf('commit **once**');
  assert.ok(gate !== -1, 'the prompt must name the gate command');
  assert.ok(commit !== -1, 'the prompt must name the commit step');
  assert.ok(gate < commit, 'the gate command must be ordered before the commit, not after it');
});

test('the tests prompt says the gate reads the working tree, so the agent knows why the order matters', () => {
  // A bare ordering is a rule to be broken under pressure; the reason is what survives a rewrite. And
  // an agent that re-runs the same command after committing sees `the turn changed nothing since
  // HEAD` — a red gate on a correct turn — with nothing to tell it that is not a verdict on its work.
  const text = read('PROMPT.tests.md');
  assert.ok(
    /before the commit, not after/i.test(text),
    'the prompt must say the check runs before the commit'
  );
  assert.ok(/working tree/i.test(text), 'and that the check reads the working tree');
  assert.ok(
    /changed nothing since/i.test(text),
    'and what the same command answers once the work is committed'
  );
});

test('the tests prompt still forbids committing with a red gate', () => {
  // The other half of the ordering: the check is worth nothing if a red result may be committed over.
  assert.ok(/committing with a red gate/i.test(read('PROMPT.tests.md')));
});

// ── T1: the tests prompt pinned by structure, not by vocabulary ───────────────
//
// The mutation review replaced the whole of `loop/PROMPT.tests.md` — 177 lines — with a nine-line bag
// of the tokens its tests grep for, and the suite stayed green. Every assertion above except the
// three B1 ones is `assert.match(text, /token/)`: it proves a word is somewhere in the file, which a
// bag of words satisfies exactly.
//
// What follows pins what a bag cannot have: the sections and their order, the gate commands in the
// order they must be run and inside the section that runs them, the fence as a list of directories
// with the excluded ones named, the forbidden list as a list under its own heading, and the two
// worked examples — which have to parse, and which the agent copies verbatim.

/** The prompt with its line endings normalised; the working copy is CRLF on Windows. */
const prompt = (name) => read(name).replace(/\r\n/g, '\n');

/** Lines paired with whether they sit inside a fenced code block. */
function linesWithFenceState(text) {
  let inside = false;
  return text.split('\n').map((line) => {
    if (/^\s*```/.test(line)) {
      inside = !inside;
      return { line, fenced: true };
    }
    return { line, fenced: inside };
  });
}

/** The `## ` headings, in document order, ignoring anything inside a fence. */
function headings(text) {
  return linesWithFenceState(text)
    .filter(({ line, fenced }) => !fenced && /^## /.test(line))
    .map(({ line }) => line.slice(3).trim());
}

/** The body of one `## ` section, up to the next one. Fenced content is kept. */
function section(text, heading) {
  const rows = linesWithFenceState(text);
  const start = rows.findIndex(({ line, fenced }) => !fenced && line.trim() === `## ${heading}`);
  assert.notEqual(start, -1, `the prompt has no "## ${heading}" section`);
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i += 1) {
    if (!rows[i].fenced && /^## /.test(rows[i].line)) {
      end = i;
      break;
    }
  }
  return rows
    .slice(start + 1, end)
    .map(({ line }) => line)
    .join('\n');
}

const SECTIONS = [
  'Read first, in this order',
  'What one turn produces',
  'Writing the scenario',
  'Protocol of the turn',
  'The fence',
  'Statuses you may write',
  'Forbidden',
  'Last step of the turn — record what happened',
];

test('the tests prompt keeps its sections, in the order the turn runs', () => {
  // The order is the turn: read, produce, write, gate and commit, then the constraints, then the
  // journal. A prompt reordered so the fence and the forbidden list arrive before the agent knows
  // what it is producing is a different instruction, and every keyword assertion above survives it.
  assert.deepEqual(headings(prompt('PROMPT.tests.md')), SECTIONS);
});

test('no section of the tests prompt is a stub', () => {
  // The nine-line bag of tokens dies here first. The smallest real section is "Statuses you may
  // write" at 453 characters, so 300 is a floor no genuine section approaches.
  const text = prompt('PROMPT.tests.md');
  for (const heading of SECTIONS) {
    const body = section(text, heading).trim();
    assert.ok(body.length >= 300, `section "${heading}" is ${body.length} characters — that is a stub`);
  }
});

/**
 * The gate, in the order the prompt must present it. Matched line by line, so punctuation around a
 * command does not decide whether the test passes.
 */
const GATE_ORDER = [
  { name: 'sut reset', matches: (line) => line.includes('npm run sut -- reset') },
  { name: 'dotnet build', matches: (line) => line.includes('dotnet build framework/ApiTests.sln') },
  {
    name: 'dotnet test --filter',
    matches: (line) => line.includes('dotnet test framework/ApiTests.sln --filter'),
  },
  {
    name: 'dotnet test (whole suite)',
    matches: (line) =>
      line.includes('dotnet test framework/ApiTests.sln') &&
      !line.includes('--filter') &&
      /whole suite/i.test(line),
  },
  {
    name: 'check-tests.mjs',
    matches: (line) => line.includes('node scripts/check-tests.mjs --ac'),
  },
];

test('the tests prompt names all five gate commands, in order, inside the protocol section', () => {
  // Naming the commands somewhere is not the instruction; the ORDER is. D-09 puts the reset first so
  // that a red test means "the test is bad" rather than "the previous turn left rubbish", and the
  // whole-suite run has to come after the filtered one or the agent never sees its scenario alone.
  // A prompt with the same five commands in any other order teaches a different turn.
  const protocol = section(prompt('PROMPT.tests.md'), 'Protocol of the turn').split('\n');
  let previous = -1;
  for (const step of GATE_ORDER) {
    const at = protocol.findIndex((line, i) => i > previous && step.matches(line));
    assert.notEqual(at, -1, `the protocol does not name "${step.name}" after the step before it`);
    previous = at;
  }

  // And the commit comes after the whole gate, which is the B1 ordering seen from the section.
  const commit = protocol.findIndex((line) => line.includes('commit **once**'));
  assert.ok(commit > previous, 'the commit must follow every gate command, not sit among them');
});

test('the tests prompt says WHY the reset comes first, not merely that it does', () => {
  // A bare ordering is the first thing dropped under pressure. This is also the sentence that stops
  // the agent "fixing" a red count assertion that is red because the database is dirty — which is
  // the exact repair D-09 exists to prevent.
  // Whitespace is collapsed first: these sentences wrap in the source, and a test that failed on a
  // reflowed paragraph would be pinning the line width rather than the instruction.
  const protocol = section(prompt('PROMPT.tests.md'), 'Protocol of the turn').replace(/\s+/g, ' ');
  assert.match(protocol, /Do this \*\*first\*\*/);
  assert.match(protocol, /§10\.3/, 'and cite the rule it comes from');
  assert.match(protocol, /the test is bad/i);
  assert.match(protocol, /previous turn left rubbish/i);
  assert.match(protocol, /the spec tells you not to weaken/i);
});

test('the tests prompt states the fence as three writable directories and names what is out', () => {
  // "Features/ appears in the file" is satisfied by a token bag. The instruction is that these three
  // are the ONLY writable paths and that everything else in the framework belongs to stage 0 — and
  // that the correct move when the framework is genuinely short is `blocked`, not an edit.
  const fence = section(prompt('PROMPT.tests.md'), 'The fence');
  for (const dir of [
    'framework/src/PetClinic.ApiTests/Features/',
    'framework/src/PetClinic.ApiTests/StepDefinitions/',
    'framework/src/PetClinic.ApiTests/Data/',
  ]) {
    assert.ok(fence.includes(dir), `the fence section must list ${dir}`);
  }
  assert.match(fence, /\*\*only\*\*/, 'the fence is a closed list, and must say so');
  for (const excluded of ['Config/', 'Http/', 'Models/', 'Services/', 'Support/', 'Hooks/', 'csproj']) {
    assert.ok(fence.includes(excluded), `the fence section must name ${excluded} as out of bounds`);
  }
  assert.match(fence, /do not make it/i, 'and forbid the framework change outright');
  assert.match(fence, /`blocked`/, 'while naming the escalation that replaces it');
});

/**
 * The bullets of a section, each folded back into one string. A bullet that wraps onto a
 * continuation line is still one rule, and splitting on newlines would hide the half of every rule
 * that says why.
 */
function bulletsOf(text) {
  const bullets = [];
  for (const line of text.split('\n')) {
    if (/^- /.test(line)) bullets.push(line.slice(2));
    else if (bullets.length > 0 && /^\s+\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else if (line.trim() === '') continue;
  }
  return bullets.map((bullet) => bullet.replace(/\s+/g, ' ').trim());
}

/** Each prohibition the Forbidden list owns, and the specific it must carry. */
const PROHIBITIONS = [
  [/more than one scenario/i, /counts them/i],
  [/weakening an assertion/i, /escalate/i],
  [/changing an existing step definition/i, /already-accepted/i],
  [/rewording an existing step/i, /reusing it/i],
  [/Thread\.Sleep/, /ReadinessProbe/],
  [/\[Ignore\]/, /Assert\.Pass/],
  [/literal record ids/i, /§10\.1/i],
  [/absolute count/i, /§10\.4/i],
  [/committing with a red gate/i],
  [/git push/, /git checkout/],
];

test('the tests prompt keeps its forbidden list a list, under its own heading, with the specifics', () => {
  // Every one of these is a defect the gate or the judge caught during the run, written down so the
  // next turn does not have to be caught by it. Scattered through a token bag they are vocabulary;
  // as bullets under "Forbidden" they are the rules of the turn.
  const forbidden = section(prompt('PROMPT.tests.md'), 'Forbidden');
  const bullets = bulletsOf(forbidden);
  assert.ok(bullets.length >= 10, `the forbidden list has ${bullets.length} bullets, expected 10 or more`);

  for (const patterns of PROHIBITIONS) {
    const owner = bullets.find((bullet) => patterns.every((p) => p.test(bullet)));
    assert.ok(owner, `no bullet in Forbidden states ${patterns.map(String).join(' with ')}`);
  }

  // The three edit targets the stage may not touch, which is the fence restated as a prohibition.
  assert.match(forbidden, /docs\/specs\/petclinic\//);
  assert.match(forbidden, /loop\/rubrics\//);
  assert.match(forbidden, /scripts\//);
});

test('the tests prompt defines the statuses it may write and reserves done for the runner', () => {
  // `done` in the agent's hands is the progress metric in the agent's hands. This is the sentence
  // that keeps the twenty accepted rows meaning what they say.
  const statuses = section(prompt('PROMPT.tests.md'), 'Statuses you may write');
  assert.match(statuses, /`review`/);
  assert.match(statuses, /green/i, 'review must be defined as the end of a green turn');
  assert.match(statuses, /`blocked`/);
  assert.ok(
    /ambiguous AC|missing framework capability/i.test(statuses),
    'blocked must be defined by what earns it, or it becomes the easy way out of a hard AC'
  );
  assert.match(statuses, /never write `done`/i);
  assert.ok(/independent judge/i.test(statuses) && /PASS/.test(statuses), 'and say who does write it');
});

test('the tests prompt tells the agent to write the BARE status word, and what breaks otherwise', () => {
  // Measured during the run: a status cell holding `` `review` `` makes the whole row invisible to
  // the tracker parser, and the loop then believes the acceptance criterion does not exist.
  const protocol = section(prompt('PROMPT.tests.md'), 'Protocol of the turn');
  assert.match(protocol, /bare word/i);
  assert.match(protocol, /No backticks/i);
  assert.match(protocol, /invisible to the tracker parser/i);
});

/** The contents of the first fenced block of the given language. */
function fenced(text, language) {
  const match = new RegExp('```' + language + '\\n([\\s\\S]*?)```').exec(text);
  assert.ok(match, `the prompt has no \`\`\`${language} example`);
  return match[1];
}

test('the tests prompt shows exactly one tagged scenario, in domain language', () => {
  // This example is copied. If it ever showed two scenarios, a Scenario Outline, or a step line
  // carrying a path or a status code, the copy would be the defect — and the gate would catch it one
  // turn later as the agent's fault.
  const text = prompt('PROMPT.tests.md');
  const example = fenced(text, 'gherkin');

  const scenarios = example.split('\n').filter((line) => /^\s*Scenario:/.test(line));
  assert.equal(scenarios.length, 1, 'exactly one scenario, because that is what a turn produces');
  assert.ok(!/Scenario Outline/.test(example), 'and never the parameterised form');
  assert.match(example, /@AC-F\d\d-\d\d @US-\d\d/, 'both tags, in the order the gate reads them');
  assert.match(scenarios[0], /Scenario: AC-F\d\d-\d\d /, 'the title is prefixed with the AC id');

  const steps = example.split('\n').filter((line) => /^\s*(Given|When|Then|And) /.test(line));
  assert.ok(steps.length >= 4, 'the example must show a Given/When/Then chain, not a single line');
  for (const step of steps) {
    assert.ok(!/\b(GET|POST|PUT|DELETE)\b/.test(step), `HTTP verb in a step line: ${step.trim()}`);
    assert.ok(!/\b[1-5]\d\d\b/.test(step), `status code in a step line: ${step.trim()}`);
    assert.ok(!/\/\w+/.test(step), `path in a step line: ${step.trim()}`);
  }

  // And the prose has to forbid what the example silently avoids.
  assert.match(text, /No `Scenario Outline` and no `Examples`/);
  assert.match(text, /§10\.8/);
});

test('the tests prompt data example parses, is keyed by an AC id, and holds no expectations', () => {
  // Rubric item 15 pushes every value into these files, so this example is the shape of the one
  // writable data surface in the fence. A status code or a path here teaches the agent to put
  // expectations in the data file, where no literal-id check ever looks.
  const text = prompt('PROMPT.tests.md');
  const data = JSON.parse(fenced(text, 'json'));

  const keys = Object.keys(data);
  assert.equal(keys.length, 1, 'one AC per block, because a turn writes one scenario');
  assert.match(keys[0], /^AC-F\d\d-\d\d$/);

  const leaves = [];
  const walk = (value) => {
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
    else leaves.push(value);
  };
  walk(data);
  assert.ok(leaves.length >= 5, 'the example must show real base values');
  for (const leaf of leaves) {
    assert.equal(typeof leaf, 'string', `a non-string value in the data example: ${leaf}`);
    assert.ok(!/^\//.test(leaf), `a path in the data example: ${leaf}`);
    assert.ok(!/^[1-5]\d\d$/.test(leaf), `a status code in the data example: ${leaf}`);
  }

  assert.match(text, /\*\*base\*\* values only/, 'and the prose must say the values are base values');
  assert.match(text, /UniqueData/, 'naming what adds the unique suffix at runtime');
  assert.match(text, /Never put expected values, status codes or paths in JSON/);
});

test('the tests prompt journal template keeps all four fields, and demands one on a dead turn', () => {
  // The journal is the only thing that crosses a turn boundary besides git and the tracker, and a
  // turn that made no progress is the one whose note the next turn most needs.
  const last = section(prompt('PROMPT.tests.md'), 'Last step of the turn — record what happened');
  for (const field of ['**Did:**', '**Tripped on:**', '**Steps added:**', '**For the next turn:**']) {
    assert.ok(last.includes(field), `the journal template dropped ${field}`);
  }
  assert.match(last, /\*\*Append\*\*/, 'appended, never rewritten — it is the previous turns talking');
  assert.match(last, /no progress/i);
  assert.match(last, /trust the facts/i, 'and the self-report must lose to the measured facts');
});
