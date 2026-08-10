// loop/verdict.mjs — pure reading of a judge verdict file.
//
// The contract is one line, because the runner acts on it mechanically (design §6.6):
//
//   VERDICT: PASS | REJECT | SPEC_UNCLEAR
//
// A malformed verdict resolves to REJECT, never to PASS. That follows the rubric's asymmetry: a
// wrongly rejected scenario costs one iteration, a wrongly accepted one ships a lie into the
// deliverable AND is copied by later iterations as approved style. A judge that produced garbage
// has told us nothing, and "nothing" must not open the gate.

export const VERDICTS = ['PASS', 'REJECT', 'SPEC_UNCLEAR'];

/**
 * The first line of a `loop/verdicts/<id>.md` the RUNNER wrote because the turn never reached the
 * judge — a red gate, or work that was never committed.
 *
 * That file is the only place the next iteration looks for "why is my row in rework": `ralph.mjs`
 * reads it through `findings()` and `targetSection` puts the text in the prompt. Before this marker
 * existed the runner's own failures went to `console.error` and nowhere else, so a turn that
 * committed nothing was handed the PREVIOUS judge call's findings under the heading "These are the
 * problems an independent judge found. Fix all of them" — measured, three iterations running, with
 * no mention anywhere of the real reason.
 *
 * A marker rather than a heuristic, because the two cases call for different work and the agent must
 * not have to guess which it is holding: a rejection means the scenario is wrong, a runner note means
 * the turn did not finish. `findings()` returns the whole text of a file whose first line is not a
 * verdict, so this line reaches the agent as well.
 */
export const RUNNER_NOTE = 'RUNNER: this turn was never graded — it did not get past the runner.';

/** Whether a verdict file is the runner's own note rather than a judge verdict. */
export function isRunnerNote(text) {
  return (text ?? '').trimStart().startsWith(RUNNER_NOTE);
}

const LINE = new RegExp(String.raw`^VERDICT:\s*(${VERDICTS.join('|')})\s*$`);

/** The verdict, or `'REJECT'` if the first non-empty line is not a well-formed verdict. */
export function parseVerdict(text) {
  const lines = (text ?? '').split('\n');
  const first = lines.find((line) => line.trim().length > 0)?.trim() ?? '';
  const m = LINE.exec(first.replace(/\s+/g, ' ').trim());
  return m ? m[1] : 'REJECT';
}

/**
 * Whether the first non-empty line really was a well-formed verdict.
 *
 * `parseVerdict` deliberately cannot distinguish "the judge said REJECT" from "the judge said
 * something unparseable", because both must close the gate. But the RUNNER needs the difference: a
 * judge that decorates its first line — a markdown fence, `**bold**`, a blockquote marker, all
 * ordinary LLM output habits — has a genuine PASS read as REJECT. One occurrence costs an iteration.
 * A judge that decorates *consistently* can never accept anything, and the loop would grind to its
 * iteration ceiling emitting rework after rework with nothing wrong with the work.
 *
 * The fix is NOT to make the parser tolerant. Skipping a leading fence would let a judge that quotes
 * the rubric's format block before answering have its quoted example read as its verdict — an
 * accidental PASS, which is the one outcome the asymmetry exists to prevent. So parsing stays strict
 * and the runner uses this to say so loudly instead.
 */
export function isWellFormed(text) {
  const lines = (text ?? '').split('\n');
  const first = lines.find((line) => line.trim().length > 0)?.trim() ?? '';
  return LINE.test(first.replace(/\s+/g, ' ').trim());
}

/** Everything after the verdict line — or the whole text when the verdict is malformed. */
export function findings(text) {
  const raw = (text ?? '').trim();
  const lines = raw.split('\n');
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index === -1) return '';

  const first = lines[index].replace(/\s+/g, ' ').trim();
  if (!LINE.test(first)) return raw;

  return lines.slice(index + 1).join('\n').trim();
}
