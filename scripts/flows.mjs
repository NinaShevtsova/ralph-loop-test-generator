// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The tests are organised into three "flows" — three user journeys through the API. This
// file is the single place that knows which flows exist and how to build every file name
// that belongs to one: its specification document, its feature file, its data file.
//
// It exists because the same three formulas used to be written out by hand in five
// different files. When one of them was fixed, the other four kept their old version, and
// nothing noticed. Now every caller asks this file instead, and a test checks that nobody
// has quietly written out a fourth copy.
// ══════════════════════════════════════════════════════════════════════════════════════

// flows.mjs — the test project, the flow groups, and every path derived from them.
//
// Kept here rather than in loop/config.mjs because scripts/ must not import from loop/: the gate CLIs
// are a layer below the runner and run standalone. The runner reaches down; the gates do not reach up.

export const FLOW_GROUPS = {
  'F-01': 'F01-owner-lifecycle',
  'F-02': 'F02-owner-pet-lifecycle',
  'F-03': 'F03-pet-visit-flow',
};

/**
 * `AC-F02-03` -> `F-02`. The tag is the only link between an acceptance criterion and its flow.
 *
 * Deliberately unvalidated — it is string arithmetic, and `flowGroupOfAc('garbage')` returns `F-rb`.
 * A caller taking an id from the command line must test the result against `FLOW_GROUPS` itself and
 * report it in its own voice. Letting `flowSlug` throw instead turns a mistyped `--ac` from an exit 2
 * with a sentence into an exit 1 with a stack trace.
 */
export const flowGroupOfAc = (acId) => `F-${acId.slice(4, 6)}`;

export const flowSlug = (group) => mustKnow('flowSlug', group);

/**
 * The test project. Spelled out here and nowhere else — `scripts/check-tests.mjs` had its own copy,
 * which is the same duplication this file exists to end, one directory up from the paths it builds.
 */
export const PROJECT = 'framework/src/PetClinic.ApiTests';

/**
 * The runner's own bookkeeping — state it writes and never commits.
 *
 * Named here because three modules need to agree on it: `loop/config.mjs` points each stage at one,
 * `scripts/checks.mjs` exempts them from the stage-1 diff fence, and both must mean the same files.
 * This file is where a path stops being spelled out twice.
 */
export const SCAFFOLD_TRACKER = 'loop/trackers/scaffold.md';
export const TESTS_TRACKER = 'loop/trackers/tests.md';
export const RUNNER_STATE = [SCAFFOLD_TRACKER, TESTS_TRACKER];

/**
 * The run summaries, which are COMMITTED and therefore reach the same fence the trackers do.
 *
 * A directory rather than a list of exact paths, because the name carries the run's timestamp and no
 * check can know it in advance. That is a wider exemption than `RUNNER_STATE` and it is kept as
 * narrow as a prefix can be: `loop/rubrics/`, `loop/verdicts/` and the two prompts stay fenced, and a
 * turn still has no business committing any of them.
 *
 * The runner writes a row here after every iteration and never commits — it contains no `git commit`
 * at all — so an agent running `git add -A` sweeps the file into its own commit exactly as it already
 * does with the tracker. Without this, every turn after the first would be refused for touching a
 * file no agent wrote.
 */
export const RUNS_DIR = 'loop/runs/';

/** All three repository-relative, so a caller joins them onto its own root. */
export const flowDocPath = (group) =>
  `docs/specs/petclinic/flows/${group}-${mustKnow('flowDocPath', group).slice(4)}.md`;

export const featurePath = (group) => `${PROJECT}/Features/${mustKnow('featurePath', group)}.feature`;

export const dataPath = (group) => `${PROJECT}/Data/${mustKnow('dataPath', group)}.json`;

function mustKnow(caller, group) {
  const slug = FLOW_GROUPS[group];
  if (!slug) {
    throw new Error(
      `${caller}: "${group}" is not a known flow — expected one of ${Object.keys(FLOW_GROUPS).join(', ')}`
    );
  }
  return slug;
}
