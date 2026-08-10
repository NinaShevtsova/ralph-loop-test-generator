// scripts/steps-inventory.mjs — the inventory that makes step reuse structural.
//
// Design §4.4: an iteration does not remember the previous one, so reuse cannot rest on the agent
// recalling a wording it used twelve turns ago. The runner regenerates loop/STEPS.md before every
// iteration and PROMPT.tests.md names it as mandatory reading. The similarity score below is the
// deterministic half of the same mechanism: >=0.90 fails the gate, 0.65..0.90 goes to the judge.
//
// 0.65, not 0.70. The canonical reworded near-duplicate — `an owner is registered` against `a pet
// owner is registered` — measures 0.67, so a 0.70 floor would have kept the very case the band
// exists for out of the judge's hands.
//
//   node scripts/steps-inventory.mjs           write loop/STEPS.md
//   node scripts/steps-inventory.mjs --print   write it and echo it

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './lib.mjs';

export const KINDS = ['Given', 'When', 'Then', 'StepDefinition'];

// Reqnroll accepts the plain, the verbatim and (C# 11) the raw string form, and a step attribute is
// not obliged to be alone in its brackets.
//
// The earlier form anchored on `\[` and required `\)\]`, so a step sharing its attribute list with
// anything else was INVISIBLE. Measured: `[Given("a new owner is registered"), Scope(Tag = "F01")]`
// returned []. `Scope` is a first-class Reqnroll attribute and `[Binding]`-scoped step classes are
// idiomatic, so this is not an exotic spelling. A file written that way vanished from loop/STEPS.md
// *and* from the duplicate gate in check-tests.mjs, while its section 5 still printed an
// unconditional green `0 step(s) compared` — a green produced by a parser that saw nothing.
//
//   - `(?<=[\[,])` is a LOOKBEHIND, not a consuming `[\[,]`. A consuming prefix would swallow the
//     comma that separates two step attributes, so `[Given("a"), Given("b")]` would yield only the
//     first. It matches after `[` and after `,`, which covers both positions in a list.
//   - `(?=\s*[,\]])` is a lookahead for the same reason, and it is what keeps a bare method call
//     `foo(a, Given("x"))` — preceded by a comma, followed by `)` — out of the inventory.
//   - the raw-string branch comes FIRST, because `"` would otherwise match the opening quote of `"""`
//     and capture the empty string.
const ATTRIBUTE = new RegExp(
  String.raw`(?<=[\[,])\s*(${KINDS.join('|')})\s*\(\s*` +
    String.raw`(?:"""+([\s\S]*?)"""+|@?"((?:[^"\\]|\\.)*)")` +
    String.raw`\s*\)(?=\s*[,\]])`,
  'g'
);

/** Every step attribute in one C# source file, in file order. */
export function extractSteps(source) {
  return [...(source ?? '').matchAll(ATTRIBUTE)].map((m) => ({
    kind: m[1],
    // A raw string is trimmed and the quoted forms are not. C# 11 strips the common indentation of a
    // multi-line raw string, so its capture carries leading newline and indentation that are not part
    // of the step sentence; a quoted literal's whitespace, by contrast, is exactly what Reqnroll
    // matches on and must survive untouched.
    text: m[2] === undefined ? m[3] : m[2].trim(),
  }));
}

/**
 * Words that carry no meaning for "is this the same sentence": articles, copulas, conjunctions.
 *
 * Deliberately SMALL, and it does not contain the prepositions `to`, `from`, `in` or `of`. An
 * earlier version dropped those and then SORTED the remaining tokens. Between them, those two
 * choices scored `the pet is added to the owner` against `the owner is added to the pet` at exactly
 * **1.0**, so a genuinely new step was hard-failed at the gate as a duplicate. Seven of ten measured
 * direction-reversed pairs scored 1.0. On an API whose entire domain is relationships between
 * owners, pets and visits, that was going to fire, not lurk.
 *
 * `has` and `have` were once excluded alongside them, on the stated grounds that they "encode
 * direction". That grounds was measurably wrong. Direction is separated by the BIGRAM half and by
 * `isReordering`, not by the stop list — measured with both words treated as stop words, all six
 * direction-reversed pairs in tests/steps-inventory.test.mjs still score exactly what they scored
 * before (0.50, 0.67, 0.70, 0.875, 0.9167, 0.9286) and all six are still `isReordering`, so none
 * becomes hard-failable. What the exclusion did cost was the reuse mechanism's single most likely
 * input: `been` was a stop word and `has` was not, so a perfect-tense rewording gained a token the
 * original lacked and lost on it.
 *
 * | pair | before | after |
 * |---|---|---|
 * | `an owner is registered` / `an owner has been registered` | 0.33 | 1.00 |
 * | `the owner is deleted` / `the owner has been deleted` | 0.33 | 1.00 |
 *
 * The hard fail is 0.90 and the judge's review band starts at 0.65, so at 0.33 the commonest
 * rewording an LLM produces was not merely permitted — it never reached the judge as data either.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'and', 'or', 'that', 'this', 'it', 'its', 'their',
]);

/**
 * A sentence reduced to its content words, **in order**.
 *
 * Numbers and quoted strings are dropped alongside `{int}`/`{string}` parameters, so a
 * parameterised step definition and the concrete Gherkin line that uses it normalise to the same
 * thing. Without that, `the owner details show exactly {int} pets` and the line
 * `the owner details show exactly 1 pets` scored 0.83 and the use counter never counted a single
 * parameterised step — the most-reused ones.
 */
export function normalize(sentence) {
  return (sentence ?? '')
    .toLowerCase()
    .replace(/\{[^}]*\}/g, ' ')       // Gherkin parameters: {int} {word} {string}
    .replace(/"[^"]*"/g, ' ')         // the concrete value a {string} parameter matches
    .replace(/'[^']*'/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b\d+\b/g, ' ')         // the concrete value an {int} parameter matches
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(' ');
}

const tokensOf = (sentence) => normalize(sentence).split(' ').filter(Boolean);

/**
 * Overlap of two token sets, divided by the LARGER — so a short sentence fully contained in a long
 * one does not score 1.0. This half notices *rewording* and is blind to order.
 */
function unigramOverlap(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const shared = [...setA].filter((word) => setB.has(word)).length;
  return shared / Math.max(setA.size, setB.size);
}

/**
 * Dice coefficient over adjacent token pairs. This half is the one that notices *order*, and it is
 * why a reversed relationship is no longer indistinguishable from a rewording.
 */
function bigramOverlap(a, b) {
  const pairsOf = (list) => list.slice(1).map((word, index) => `${list[index]} ${word}`);
  const pairsA = pairsOf(a);
  const pairsB = pairsOf(b);

  // A one-word sentence has no pairs. Falling back to the set overlap keeps `owner` vs `owner` at 1
  // instead of producing a meaningless 0.
  if (pairsA.length === 0 && pairsB.length === 0) return unigramOverlap(a, b);
  if (pairsA.length === 0 || pairsB.length === 0) return 0;

  const remaining = [...pairsB];
  let shared = 0;
  for (const pair of pairsA) {
    const at = remaining.indexOf(pair);
    if (at !== -1) {
      shared += 1;
      remaining.splice(at, 1);
    }
  }
  return (2 * shared) / (pairsA.length + pairsB.length);
}

/**
 * How alike two step sentences are, 0..1: the mean of the set overlap and the ordered-pair overlap.
 *
 * Neither half works alone. Set overlap on its own cannot tell a reversed relationship from a
 * rewording — both score 1.0. Pair overlap on its own scores a legitimate reordering at 0, missing
 * real duplicates. The mean gives, measured:
 *
 * | pair | score | gate |
 * |---|---|---|
 * | `an owner is registered` / `the owner is registered` | 1.00 | fails, correctly a duplicate |
 * | `an owner is registered` / `a pet owner is registered` | 0.67 | judge's band |
 * | `the pet is added to the owner` / `the owner is added to the pet` | 0.67 | judge's band, not blocked |
 * | `the pet is deleted` / `the pet is not deleted` | 0.33 | clearly different |
 *
 * The last two rows are the point. Under the old measure the reversal scored 1.00 and was hard
 * blocked, while the negation scored 0.67 — the same as a genuine reworded duplicate, so no
 * threshold could separate them. `not` is not a stop word, and the pair overlap punishes it twice.
 */
export function similarity(a, b) {
  const a_ = tokensOf(a);
  const b_ = tokensOf(b);
  if (a_.length === 0 && b_.length === 0) return 1;
  return (unigramOverlap(a_, b_) + bigramOverlap(a_, b_)) / 2;
}

/**
 * Whether two sentences are the same words in a different order.
 *
 * The gate must never hard-fail such a pair, however high the score, and this is the one place in
 * the harness where a deterministic check **declines to rule**. The reason is not a tuning problem
 * that a better measure would fix:
 *
 * `the count of pets exceeds the count of owners` against `the count of owners exceeds the count of
 * pets` scores 0.9167 — the two sides are anagrams so the set half is exactly 1.0, and the swap
 * disturbs one adjacent pair out of six. Measured, five of five pairs in that family cleared 0.90
 * and were hard-blocked as duplicates while being opposite assertions.
 *
 * And it gets worse as the sentence grows, under any local measure. A longer repeated frame means
 * more untouched pairs, so the score rises towards 1.0; an LCS ratio behaves the same way. That is
 * not a flaw in the arithmetic — two long sentences differing by one swapped word genuinely ARE
 * nearly identical as text. Only meaning separates them, and meaning is the judge's job.
 *
 * So a reordering is always reported and never blocked. That direction is deliberate: a false
 * negative costs some vocabulary bloat, which rubric item 23 asks the judge to catch anyway, while a
 * false positive hard-fails work that is correct.
 */
export function isReordering(a, b) {
  const a_ = tokensOf(a);
  const b_ = tokensOf(b);
  if (a_.length !== b_.length || a_.length === 0) return false;
  // Compares the NORMALISED tokens, so this rejects more than literally identical sentences: every
  // article, copula and tense variant that collapses to the same tokens is caught here and never
  // reaches the sort. That is the class of real duplicates, and it must stay blockable — if this
  // guard were narrower, the reordering exemption would swallow them and the mechanism would go
  // quiet, doing more harm than the bug it fixes.
  if (a_.join(' ') === b_.join(' ')) return false;
  return [...a_].sort().join(' ') === [...b_].sort().join(' ');
}

/** loop/STEPS.md — grouped by kind, alphabetical inside a group. */
export function renderInventory(entries) {
  const lines = [
    '# Step inventory',
    '',
    '> Generated by `scripts/steps-inventory.mjs` before every iteration. **Read this before',
    '> writing any step.** A step that already exists here must be reused, not reworded — a',
    '> near-duplicate fails the gate (design §4.4).',
    '',
  ];

  if (entries.length === 0) {
    lines.push('_No step definitions exist yet — this is the first iteration that writes one._', '');
    return lines.join('\n');
  }

  for (const kind of KINDS) {
    const group = entries
      .filter((entry) => entry.kind === kind)
      .sort((x, y) => x.text.localeCompare(y.text));
    if (group.length === 0) continue;

    lines.push(`## ${kind}`, '', '| Sentence | File | Used by scenarios |', '|---|---|---|');
    for (const entry of group) {
      lines.push(`| \`${entry.text}\` | ${entry.file} | ${entry.uses} |`);
    }
    lines.push('');
  }

  lines.push(`**Total:** ${entries.length} step definitions.`, '');
  return lines.join('\n');
}

/** Every `.cs` file under `dir`, recursively, in stable order. */
function csFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.cs')) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

/** Every `.feature` file under `dir`, recursively, in stable order. */
function featureFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.feature')) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

const PROJECT = 'framework/src/PetClinic.ApiTests';

/** Collects every step with its file and how many scenario lines reference it. */
export function collectInventory(root) {
  const stepsDir = join(root, PROJECT, 'StepDefinitions');
  const featuresDir = join(root, PROJECT, 'Features');

  const featureText = featureFiles(featuresDir)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  // A use is a Gherkin line whose content words match the step's. Counting exact substrings would
  // miss every parameterised step, and those are exactly the most-reused ones.
  const gherkinLines = featureText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(Given|When|Then|And|But)\s+/.test(line))
    .map((line) => normalize(line.replace(/^(Given|When|Then|And|But)\s+/, '')));

  return csFiles(stepsDir).flatMap((file) =>
    extractSteps(readFileSync(file, 'utf8')).map((step) => ({
      ...step,
      file: relative(join(root, PROJECT), file).split('\\').join('/'),
      uses: gherkinLines.filter((line) => similarity(line, step.text) >= 0.9).length,
    }))
  );
}

const executedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  const root = repoRoot(import.meta.url);
  const target = join(root, 'loop', 'STEPS.md');
  const markdown = renderInventory(collectInventory(root));

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);

  console.log(`steps-inventory: wrote ${relative(root, target)}`);
  if (process.argv.includes('--print')) console.log(`\n${markdown}`);
}
