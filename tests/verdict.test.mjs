// tests/verdict.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVerdict,
  findings,
  isWellFormed,
  isRunnerNote,
  VERDICTS,
  RUNNER_NOTE,
} from '../loop/verdict.mjs';

test('parseVerdict reads PASS from the first line', () => {
  assert.equal(parseVerdict('VERDICT: PASS\n'), 'PASS');
});

test('parseVerdict reads REJECT followed by findings', () => {
  const text = 'VERDICT: REJECT\n\n- [AC-F02-01 step 3] file.cs:87\n  AC demands exactly one.\n';
  assert.equal(parseVerdict(text), 'REJECT');
  // REJECT is also the malformed-input default, so asserting it alone would be satisfied by a parser
  // that ignored its input entirely. These two prove the input was actually read.
  assert.equal(isWellFormed(text), true);
  assert.match(findings(text), /AC demands exactly one/);
});

test('parseVerdict reads SPEC_UNCLEAR', () => {
  assert.equal(parseVerdict('VERDICT: SPEC_UNCLEAR\n\nStep 4 can be read two ways.'), 'SPEC_UNCLEAR');
});

test('parseVerdict tolerates leading blank lines and surrounding whitespace', () => {
  assert.equal(parseVerdict('\n\n   VERDICT:   PASS   \n'), 'PASS');
});

test('parseVerdict returns REJECT for a malformed verdict — never PASS', () => {
  assert.equal(parseVerdict('Looks good to me!'), 'REJECT');
  assert.equal(parseVerdict(''), 'REJECT');
  assert.equal(parseVerdict(null), 'REJECT');
  assert.equal(parseVerdict('VERDICT: APPROVED'), 'REJECT');
});

test('parseVerdict ignores a verdict line that is not first', () => {
  assert.equal(parseVerdict('Some preamble\nVERDICT: PASS'), 'REJECT');
});

test('VERDICTS lists exactly the three accepted values', () => {
  assert.deepEqual(VERDICTS, ['PASS', 'REJECT', 'SPEC_UNCLEAR']);
});

test('findings returns everything after the verdict line', () => {
  const text = 'VERDICT: REJECT\n\n- finding one\n- finding two\n';
  assert.equal(findings(text), '- finding one\n- finding two');
});

test('findings returns an empty string when there are none', () => {
  assert.equal(findings('VERDICT: PASS\n'), '');
});

test('findings returns the whole text when the verdict line is malformed', () => {
  assert.equal(findings('Looks good to me!'), 'Looks good to me!');
});

test('isWellFormed separates "the judge said REJECT" from "the judge said nonsense"', () => {
  // parseVerdict cannot tell these apart, and must not — both close the gate. The runner needs the
  // difference, because the second one means the judge is broken rather than the work.
  for (const good of ['VERDICT: PASS', 'VERDICT: REJECT\n\n- a finding', 'VERDICT: SPEC_UNCLEAR']) {
    assert.equal(isWellFormed(good), true, `${good} is well formed`);
    assert.equal(parseVerdict(good), good.split('\n')[0].replace('VERDICT: ', ''));
  }

  // Every one of these is a real LLM output habit, and every one currently reads as REJECT.
  for (const decorated of [
    '```\nVERDICT: PASS\n```',
    '**VERDICT: PASS**',
    '> VERDICT: PASS',
    '## VERDICT: PASS',
    'Here is my verdict.\n\nVERDICT: PASS',
    'VERDICT: PASS.',
    'VERDICT: SPEC UNCLEAR',
  ]) {
    assert.equal(parseVerdict(decorated), 'REJECT', `${JSON.stringify(decorated)} must close the gate`);
    assert.equal(
      isWellFormed(decorated),
      false,
      `${JSON.stringify(decorated)} must be reported as malformed, not as an honest REJECT`
    );
  }
});

test('isWellFormed does not treat a fenced example as the verdict', () => {
  // The reason the parser is NOT made tolerant of fences. A judge that quotes the rubric's format
  // block before answering would otherwise have its quoted example read as its answer — an
  // accidental PASS, the one outcome the asymmetry exists to prevent.
  const quotesTheRubric = '```\nVERDICT: PASS\nVERDICT: REJECT\n```\n\nVERDICT: REJECT\n\n- a real finding';
  assert.equal(parseVerdict(quotesTheRubric), 'REJECT');
  assert.equal(isWellFormed(quotesTheRubric), false);
});

// ── The runner's own note in a verdict file ───────────────────────────────────────────

test('isRunnerNote separates the runner\'s note from a judge verdict', () => {
  // B4. `loop/verdicts/<id>.md` has two authors: the judge, and the runner when the turn never
  // reached it. The next turn is told a REJECT means "fix the scenario" and a runner note means "the
  // turn did not finish", so the two must be distinguishable without guessing.
  assert.equal(isRunnerNote(`${RUNNER_NOTE}\n\ngate red at "check:tests"`), true);
  assert.equal(isRunnerNote('VERDICT: REJECT\n\n- [item 6] file.cs:87'), false);
  assert.equal(isRunnerNote('VERDICT: PASS\n'), false);
  assert.equal(isRunnerNote(''), false);
  assert.equal(isRunnerNote(null), false);
  assert.equal(isRunnerNote(undefined), false);
});

test('the runner note survives findings(), so its text reaches the agent whole', () => {
  // `findings()` returns everything after a well-formed verdict line, and the WHOLE text when the
  // first line is not one. The note's first line is deliberately not a verdict, so the reason — and
  // the marker itself — reach the prompt rather than being trimmed away as a header.
  const note = `${RUNNER_NOTE}\n\nIteration 2, row AC-F01-01:\n\ngate red at "check:tests"`;
  const text = findings(note);
  assert.match(text, /gate red at "check:tests"/);
  assert.match(text, /^RUNNER:/);
  assert.equal(parseVerdict(note), 'REJECT', 'and it must never parse as an accepting verdict');
});

test('RUNNER_NOTE is a single line, because it is matched as a prefix', () => {
  assert.ok(!RUNNER_NOTE.includes('\n'));
  assert.ok(RUNNER_NOTE.trim().length > 0);
});
