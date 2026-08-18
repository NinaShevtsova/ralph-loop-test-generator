// tests/check-spec.test.mjs
//
// The gate is proved two ways at once: it must ACCEPT the reference package, and it must REJECT a copy
// of that package mutated one way per check. Either half alone is worthless — a gate that only accepts
// is indistinguishable from `exit 0`, and a gate that only rejects is indistinguishable from `exit 1`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../scripts/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, '.claude/skills/spec-builder/check-spec.mjs');
const REFERENCE = join(ROOT, 'docs/specs/petclinic');

/** A throwaway copy of the reference package. Exact paths only — never a wildcard. */
function specCopy() {
  const root = mkdtempSync(join(tmpdir(), 'check-spec-'));
  const spec = join(root, 'spec');
  cpSync(REFERENCE, spec, { recursive: true });
  return spec;
}

/**
 * Cleanup must never replace a real assertion failure with a fault of its own.
 *
 * `discard` runs in a `finally`, so a throw here REPLACES the assertion error that sent us there — a
 * genuine gate regression would surface as an EBUSY in cleanup with the actual diff lost. On win32 a
 * recursive delete of a tree a just-exited child was reading transiently fails that way, and
 * `force: true` only ignores missing paths, it does not retry. A leaked temp directory is the cheaper
 * outcome.
 */
function discard(spec) {
  try {
    rmSync(dirname(spec), { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* keep the real failure */
  }
}

const gate = (spec, extra = []) => run(process.execPath, [SCRIPT, '--spec', spec, ...extra]);

/** Replace once in a file under the copy, asserting the target was actually there. */
function edit(spec, relative, from, to) {
  const path = join(spec, relative);
  const text = readFileSync(path, 'utf8');
  const count = text.split(from).length - 1;
  assert.equal(count, 1, `mutation target appears ${count} times in ${relative}, expected 1`);
  writeFileSync(path, text.replace(from, to));
}

test('the gate accepts the reference package', () => {
  const spec = specCopy();
  try {
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /OK — \d+ check\(s\)/);
  } finally {
    discard(spec);
  }
});

test('the gate refuses to run without --spec, and says so', () => {
  const result = run(process.execPath, [SCRIPT]);
  assert.equal(result.status, 2, result.out);
  assert.match(result.out, /--spec <dir> is required/);
});

test('the gate rejects a package missing a required file', () => {
  const spec = specCopy();
  try {
    rmSync(join(spec, 'README.md'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /README\.md: missing/);
  } finally {
    discard(spec);
  }
});

test('the gate refuses a flag with no value rather than treating it as absent', () => {
  // `--baseline` last on the command line used to yield null, which the append-only comparison reads
  // as "no baseline given" and skips — the gate then exits 0 having compared nothing, and an operator
  // who typed the flag believes it ran. Section 11 depends on this refusal.
  const withoutValue = run(process.execPath, [SCRIPT, '--spec']);
  assert.equal(withoutValue.status, 2, withoutValue.out);
  assert.match(withoutValue.out, /--spec needs a value/);

  const followedByFlag = run(process.execPath, [SCRIPT, '--spec', '--quiet']);
  assert.equal(followedByFlag.status, 2, followedByFlag.out);
  assert.match(followedByFlag.out, /--spec needs a value/);
});

test('the gate does not accept a directory in place of a contract file', () => {
  // Measured before `isFile()` existed: a directory named `openapi.json` satisfied the contract check
  // and the gate exited 0 on a package holding no contract at all.
  const spec = specCopy();
  try {
    rmSync(join(spec, 'contracts/openapi.yaml'));
    mkdirSync(join(spec, 'contracts/openapi.json'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /contracts\/: no \.yaml, \.yml or \.json file/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a flow file whose name is not F-NN-slug.md', () => {
  const spec = specCopy();
  try {
    cpSync(join(spec, 'flows/F-01-owner-lifecycle.md'), join(spec, 'flows/owners.md'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /owners\.md: not a flow file name/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a gap in the conventions section numbering', () => {
  const spec = specCopy();
  try {
    // §10 is the section the judge rubric cites most; renumbering it to §12 leaves a hole at 10.
    edit(spec, 'context-and-conventions.md', '## 10. Test data and environment strategy', '## 12. Test data and environment strategy');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /section numbering/);
    // The FOUND sequence, not just the digits `10` anywhere in the line. The message also prints an
    // `expected 1, 2, … 10, 11` list, so a bare /10/ is satisfied by the half of the message that is
    // identical whether the check passed or failed.
    assert.match(result.out, /section numbering is [\d, ]*12, 11/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC body with no Test plan row', () => {
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '| AC-F01-02 | `AC-F01-02: updated owner contacts are visible in the owner details and the owners list without a duplicate` | integration | green |\n',
      ''
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F01-02.*no Test plan row/s);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a Test plan row with no AC body', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '### AC-F03-04 —', '### AC-F03-99 —');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F03-04/);
  } finally {
    discard(spec);
  }
});

test('a CRLF checkout is parsed exactly like an LF one', () => {
  // `core.autocrlf` is on here with no `.gitattributes`, so a Windows clone yields CRLF files —
  // measured on a real `git checkout-index` tree: 219 CRLF, 0 bare LF. `parseFlow` normalises before
  // parsing anything.
  //
  // This compares the two runs rather than asserting a check count, so later sections do not have to
  // come back and edit it. It guards the normalisation against regression; it cannot yet FAIL without
  // it, because the one field CRLF actually breaks is the frontmatter, and nothing consumes that until
  // the `depends_on` section. The falsifiable half of this belongs there.
  const asLf = specCopy();
  const asCrlf = specCopy();
  try {
    for (const relative of [
      'README.md',
      'context-and-conventions.md',
      'flows/F-01-owner-lifecycle.md',
      'flows/F-02-owner-pet-lifecycle.md',
      'flows/F-03-pet-visit-flow.md',
    ]) {
      const path = join(asCrlf, relative);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
    }

    const lf = gate(asLf);
    const crlf = gate(asCrlf);
    const summary = (out) => out.trim().split('\n').at(-1);

    assert.equal(crlf.status, lf.status, crlf.out);
    assert.equal(summary(crlf.out), summary(lf.out));
  } finally {
    discard(asLf);
    discard(asCrlf);
  }
});

test('a fenced example neither invents a criterion nor truncates a body', () => {
  // Measured before fences were tracked: `### AC-F01-09` inside a YAML sample became a phantom
  // criterion, and a `## the body actually sent` line inside the same fence ended AC-F01-01's body 288
  // characters early — the endpoints below it vanished from the containment check, which reported ok.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**Step 3 — find the owner in the owners list**',
      '```yaml\n' +
        '### AC-F01-09 — an example, not a criterion\n' +
        '## the body actually sent\n' +
        'firstName: Anna\n' +
        '```\n\n' +
        '**Step 3 — find the owner in the owners list**'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('the gate rejects two Test plan rows for one criterion', () => {
  const spec = specCopy();
  try {
    const row = "| AC-F01-04 | `AC-F01-04: deregistering an owner removes their pet and that pet's visits` | integration | green |";
    edit(spec, 'flows/F-01-owner-lifecycle.md', row, `${row}\n| AC-F01-04 | \`AC-F01-04: an older wording of the same test\` | integration | green |`);
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F01-04 — more than one Test plan row/);
  } finally {
    discard(spec);
  }
});

test('a row quoted in prose outside the Test plan section is not a row', () => {
  // Measured while `planRows` scanned the whole file: this sentence alone made the gate read two rows
  // for AC-F01-01, and the two consumers disagreed about which name was real — `check-tests.mjs` takes
  // the first match, the append-only section keeps the last.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## Acceptance criteria',
      '## Acceptance criteria\n\nThis one was once called `AC-F01-01: an older wording of the name`.\n'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a duplicate AC id', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-02-owner-pet-lifecycle.md', '### AC-F02-04 —', '### AC-F02-03 —');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /duplicate/i);
    assert.match(result.out, /AC-F02-03/);
    // And it does not simultaneously certify the opposite. The pass line used to run unconditionally,
    // so this run printed `ok … none duplicated` for the very file the failure above names — counted
    // in the summary total, which is the arithmetic that had caught the missing pass in the first
    // place. A flow with a duplicate gets the failure and no `ok` about its ids.
    assert.doesNotMatch(result.out, /F-02-owner-pet-lifecycle\.md: \d+ AC id\(s\), none duplicated/);
    // The other flows are untouched, so their pass lines must survive — otherwise the fix would have
    // been to delete the pass rather than to condition it, and the check would go uncountable again.
    assert.match(result.out, /F-01-owner-lifecycle\.md: \d+ AC id\(s\), none duplicated/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a gap in the AC numbering of a flow', () => {
  const spec = specCopy();
  try {
    // AC-F01-03 becomes AC-F01-07 in both places, leaving 03 missing and 05..06 skipped.
    edit(spec, 'flows/F-01-owner-lifecycle.md', '### AC-F01-03 —', '### AC-F01-07 —');
    edit(spec, 'flows/F-01-owner-lifecycle.md', '| AC-F01-03 | `AC-F01-03:', '| AC-F01-07 | `AC-F01-07:');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /not contiguous|gap/i);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC id whose flow prefix is not the file it lives in', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '### AC-F03-03 —', '### AC-F02-33 —');
    edit(spec, 'flows/F-03-pet-visit-flow.md', '| AC-F03-03 | `AC-F03-03:', '| AC-F02-33 | `AC-F02-33:');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // The FAIL line, not the id alone: `/F-03/` matched the file name on nearly every ok line, and
    // the status is already 1 from the contiguity check firing on the same mutation.
    assert.match(result.out, /AC-F02-33 — the flow prefix does not match F-03/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC with no "Why this matters"', () => {
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      "**Why this matters:** the administrator adds a pet from the owner details, while the vet at the",
      'Removed on purpose, so the AC has no stated consequence.'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // Both halves in one FAIL line. Separately they are worthless: section 5's ok line reads
    // "<id> carries US, Why this matters, Given, When and Then", so on a green run the output holds
    // `Why this matters` twenty times and `AC-F02-01` once.
    assert.match(result.out, /AC-F02-01 is missing Why this matters/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC with no Given', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '**Given** an owner is registered (`ownerId`) with a pet added (`petId`); visit data is prepared per the', 'Preconditions omitted on purpose, in prose,');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // The FAIL line. `Given` appears in every ok line section 5 prints.
    assert.match(result.out, /AC-F03-01 is missing Given/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a flow document that declares no criteria', () => {
  // Measured before the guard existed: `numbers.every()` is true for an empty array and both set
  // comparisons are true for empty sets, so an AC-less flow file was green across the Test plan, id and
  // completeness checks at the same time — three sections reporting ok about nothing.
  const spec = specCopy();
  try {
    writeFileSync(
      join(spec, 'flows/F-04-empty-flow.md'),
      '---\ndepends_on: ["../context-and-conventions.md"]\n---\n\n' +
        '# Flow F-04 — declares nothing\n\n## Test plan\n\nNo criteria.\n'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /F-04-empty-flow\.md: declares no acceptance criteria/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC referencing a user story that does not exist', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '**US:** US-01, US-02, US-04', '**US:** US-01, US-99');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /US-99/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a user story no AC references', () => {
  const spec = specCopy();
  try {
    edit(spec, 'context-and-conventions.md', '**US-06 — No side effects', '**US-07 — No side effects');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /US-07/);
    assert.match(result.out, /no acceptance criterion/i);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a broken anchor inside one flow document', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '## Test data — owner', '## Test data for the owner');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // The FAIL line, not the slug alone. A green run prints `anchor #test-data--owner resolves` twice,
    // so a bare /test-data--owner/ is satisfied by the half of the output that is identical whether the
    // anchor resolved or not.
    assert.match(result.out, /anchor #test-data--owner resolves to no heading in this file/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a broken anchor pointing into another flow document', () => {
  const spec = specCopy();
  try {
    // F-01 and F-02 both link to this heading in F-03.
    edit(spec, 'flows/F-03-pet-visit-flow.md', '## Test data — visit', '## Test data — the visit');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // The CROSS-DOCUMENT FAIL line specifically. A green run prints `#test-data--visit resolves` three
    // times, and this mutation also breaks F-03's own same-document link — which the previous test
    // already covers — so anything looser passes without the cross-document half working at all.
    assert.match(
      result.out,
      /F-01-owner-lifecycle\.md: anchor \.\/F-03-pet-visit-flow\.md#test-data--visit resolves to no heading in F-03-pet-visit-flow\.md/
    );
  } finally {
    discard(spec);
  }
});

test('the gate rejects a depends_on path that does not exist', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-02-owner-pet-lifecycle.md', '"../contracts/openapi.yaml"', '"../contracts/missing.yaml"');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /missing\.yaml/);
  } finally {
    discard(spec);
  }
});

test('depends_on is still checked when the checkout uses CRLF', () => {
  // This is the falsifiable half of the CRLF guard added with the parsing layer. The frontmatter regex
  // anchors at string start with no `m` flag, so `---\r\n` never matched, `frontMatter` came back
  // empty, and this section emitted neither a fail nor an ok. Measured on a real `git checkout-index`
  // tree — which is what a Windows clone of this repository produces.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-02-owner-pet-lifecycle.md');
    const asCrlf = readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n');
    writeFileSync(path, asCrlf.replace('"../contracts/openapi.yaml"', '"../contracts/missing.yaml"'));

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /missing\.yaml/);
  } finally {
    discard(spec);
  }
});

test('a heading inside a fenced example does not satisfy an anchor', () => {
  // Measured before fences were tracked here: renaming the real heading while an example in the same
  // file contained that exact line left the gate printing `ok  anchor #test-data--owner resolves`.
  // GitHub renders a fenced line as text, so the anchor was dead in a browser and the gate approved it.
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '## Test data — owner', '## Owner test data');
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## API behavior used in this flow',
      '```markdown\n## Test data — owner\n```\n\n## API behavior used in this flow'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /anchor #test-data--owner resolves to no heading in this file/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a link to a document that does not exist', () => {
  // The cross-document check requires a `#`, so a link with no fragment was never examined at all —
  // including the reference's own three `](./F-0X-….md)` links.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      '[F-01](./F-01-owner-lifecycle.md)',
      '[F-01](./F-01-typo-lifecycle.md)'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /links to \.\/F-01-typo-lifecycle\.md, which does not exist/);
  } finally {
    discard(spec);
  }
});

test('the gate does not accept a directory as a depends_on target', () => {
  // The same hole section 1 closed with isFile(): existsSync is true for a directory.
  const spec = specCopy();
  try {
    rmSync(join(spec, 'contracts/openapi.yaml'));
    mkdirSync(join(spec, 'contracts/openapi.yaml'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /depends_on names \.\.\/contracts\/openapi\.yaml, which is not a file/);
  } finally {
    discard(spec);
  }
});

test('a depends_on the gate cannot read is refused, not reported as absent', () => {
  // The sentinel exists to stop this section falling silent. Printing "declares no depends_on" over a
  // YAML block sequence would replace silence with a false statement, which is worse.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-03-pet-visit-flow.md',
      'depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml"]',
      'depends_on:\n  - "../context-and-conventions.md"\n  - "../contracts/openapi.yaml"'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /has a depends_on entry this gate could not read/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC step whose endpoint is not in the flow behavior table', () => {
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**When** `GET /owners`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did',
      '**When** `GET /clinics`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /GET \/clinics/);
    // Anchored on the FAIL wording, not on the bare heading text. A passing run prints the heading in
    // slugified form only (section 7's anchor lines), so a looser pattern would still be green today
    // and would silently stop testing anything the first time an ok line quotes the table by name.
    assert.match(result.out, /absent from "API behavior used in this flow"/);
  } finally {
    discard(spec);
  }
});

test('a declaration inside a fenced example does not satisfy containment', () => {
  // Measured before `requestsIn` tracked fences: the gate printed `ok … (10 used)` and exited 0 while
  // the only declaration of `GET /clinics` sat inside a ```markdown example. GitHub renders that row as
  // text, so the generator reading the flow document sees no declaration at all.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**When** `GET /owners`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did',
      '**When** `GET /clinics`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did'
    );
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '| `POST /owners` | `201`, the body contains the created owner with an assigned `id` |',
      '| `POST /owners` | `201`, the body contains the created owner with an assigned `id` |\n\n```markdown\n| `GET /clinics` | `200` and an array of clinics |\n```\n'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /GET \/clinics — used in an AC step but absent from/);
  } finally {
    discard(spec);
  }
});

test('a fenced illustration inside a criterion is not one of its request steps', () => {
  // The mirror of the case above, and a false RED rather than a false green: an example showing a call
  // the criterion does NOT make was counted as a step, and the gate rejected a correct package.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**Step 3 — find the owner in the owners list**',
      '```http\nnot a step, only an illustration: `GET /clinics`\n```\n\n**Step 3 — find the owner in the owners list**'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a flow whose criteria name no request at all', () => {
  // Measured: stripping the backticks off every request in F-03's criteria left the gate at exit 0
  // printing `(0 used)`. Containment with nothing to compare is not containment.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-03-pet-visit-flow.md');
    const text = readFileSync(path, 'utf8');
    const bodiesAt = text.search(/^### AC-/m);
    const planAt = text.indexOf('## Test plan');
    writeFileSync(
      path,
      text.slice(0, bodiesAt) +
        text
          .slice(bodiesAt, planAt)
          .replace(/`(GET|POST|PUT|DELETE|PATCH)\s+(\/[^`]*?)`/g, '$1 $2') +
        text.slice(planAt)
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /F-03-pet-visit-flow\.md: no criterion names a request/);
  } finally {
    discard(spec);
  }
});

test('the reference package produces exactly the two known warnings', () => {
  // Both are deliberate, and pinning the COUNT is the point: a third warning means either a new smell
  // in the reference or a warning that has gone too loose to be worth reading.
  //
  //  - AC-F01-04 step 6 puts `GET /pets` and `GET /visits` under one When, and the judge accepted the
  //    scenario generated from it;
  //  - AC-F02-09 is the negative criterion whose second half asserts an absence in prose — "there is
  //    no pet with the unique name from Given in the list" — so it names no backticked field and the
  //    no-data-assertion heuristic fires on it. The criterion is correct; the heuristic is coarse, and
  //    that is why it warns instead of failing.
  const spec = specCopy();
  try {
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /OK — \d+ check\(s\), 2 warning\(s\)/);
    assert.match(result.out, /warn .*AC-F01-04.*more than one request/);
    assert.match(result.out, /warn .*AC-F02-09.*no named field/);
  } finally {
    discard(spec);
  }
});

test('a literal record id in an AC step warns without failing the gate', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '**When** `DELETE /owners/{ownerId}`\n**Then** code `204`; the response body is empty.', '**When** `DELETE /owners/1`\n**Then** code `204`; the response body is empty.');
    const result = gate(spec);
    // It is a warning: the endpoint check above fails on the same edit, so assert the warning is
    // present rather than asserting the exit code, which that other check owns.
    //
    // Both halves in ONE pattern. Split in two, the second is worthless: section 9's FAIL line on this
    // same mutation reads `DELETE /owners/1 — used in an AC step but absent from …`, so a bare
    // /DELETE \/owners\/1/ stays green with the literal-id warning deleted outright.
    assert.match(result.out, /warn .*AC-F01-03 names a literal record id in `DELETE \/owners\/1`/);
  } finally {
    discard(spec);
  }
});

test('--baseline accepts a package that only appended', () => {
  const spec = specCopy();
  const baseline = specCopy();
  try {
    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /baseline: \d+ pre-existing criteria unchanged/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('--baseline rejects a changed assertion in a pre-existing AC', () => {
  const spec = specCopy();
  const baseline = specCopy();
  try {
    // Weakening an existing criterion is the damage D-5 exists to catch.
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      '**Then** code `200`; the `pets` array contains exactly one element; it has `id` = `petId`, `name` and',
      '**Then** code `200`; the `pets` array is not empty; it has `id` = `petId`, `name` and'
    );
    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 1, result.out);
    // One FAIL line, not `/AC-F02-01/` and `/differs from the baseline/` separately: section 5 prints
    // `AC-F02-01 carries US, Why this matters, Given, When and Then` on every green run, so the id on
    // its own is satisfied by output that says the opposite of what this test claims.
    assert.match(result.out, /FAIL baseline: the body of AC-F02-01 differs from the baseline/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('--baseline rejects a pre-existing AC that disappeared', () => {
  const spec = specCopy();
  const baseline = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '### AC-F03-06 —', '### AC-F03-16 —');
    edit(spec, 'flows/F-03-pet-visit-flow.md', '| AC-F03-06 | `AC-F03-06:', '| AC-F03-16 | `AC-F03-16:');
    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 1, result.out);
    // Anchored on the whole FAIL line and without the `s` flag. `/AC-F03-06.*present in the baseline/s`
    // spans newlines, so it was satisfied by any ok line naming AC-F03-06 followed anywhere below by
    // the phrase — and this mutation makes F-03's numbering non-contiguous, so the exit code is 1 with
    // the removal check switched off entirely.
    assert.match(result.out, /FAIL baseline: AC-F03-06 is present in the baseline and gone from the package/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('a criterion with a single When warns, and the gate still passes', () => {
  // The fourth warning category had no test. Removing AC-F02-08's second step leaves it with one
  // request, which is the signature of a contract test — section 8A wants a chain of at least two.
  // It is a warning and not a failure, so the exit code must stay 0: a coarse heuristic that could
  // reject a package would be worse than no heuristic.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      "**Step 2 — attempt to open the same pet from the second owner's details**\n" +
        '**When** `GET /owners/{ownerId2}/pets/{petId}`\n' +
        '**Then** code `404`; the response body is empty.\n',
      ''
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /warn .*AC-F02-08 has a single When/);
  } finally {
    discard(spec);
  }
});

test('--baseline catches a renamed Test plan entry, which nothing else notices', () => {
  // This is section 11's only unique catch. Every other check passes on this mutation: the row is still
  // well formed, its id still matches a body, the numbering is intact. But the gate compares that name
  // against the generated scenario title, so changing it turns an already-accepted test red — and
  // without this comparison the spec would look untouched.
  const spec = specCopy();
  const baseline = specCopy();
  try {
    edit(
      spec,
      'flows/F-03-pet-visit-flow.md',
      'AC-F03-02: a visit from the clinic-wide log lands in the history of the same pet',
      'AC-F03-02: a visit recorded in the log reaches the same pet'
    );

    const withoutBaseline = gate(spec);
    assert.equal(withoutBaseline.status, 0, 'nothing but the baseline comparison sees this');

    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /the Test plan name of AC-F03-02 differs from the baseline/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('--baseline accepts a genuine append', () => {
  // Test 36 compares two identical copies, so the path this section exists to permit — adding new
  // criteria while leaving the old ones alone — was never exercised. An append-only guard that also
  // refused appends would be a guard against the wrong thing.
  const spec = specCopy();
  const baseline = specCopy();
  try {
    const path = join(spec, 'flows/F-03-pet-visit-flow.md');
    const text = readFileSync(path, 'utf8');

    const criterion = [
      '### AC-F03-07 — a recorded visit is readable both directly and through its pet',
      '',
      '**US:** US-05',
      "**Why this matters:** the vet opens the visit itself while the administrator opens the pet's",
      'history, and the two must agree about the same appointment.',
      '',
      '**Given** an owner is registered (`ownerId`) with a pet (`petId`) and a recorded visit (`visitId`)',
      '',
      '**Step 1 — open the visit record**',
      '**When** `GET /visits/{visitId}`',
      "**Then** code `200`; `petId` equals the pet's `petId`; `description` is the submitted value.",
      '',
      "**Step 2 — open the pet's visit history**",
      '**When** `GET /pets/{petId}`',
      '**Then** code `200`; the `visits` array contains the record with `id` = `visitId` and the same',
      '`description`.',
      '',
      '## Test plan',
    ].join('\n');

    const row =
      '| AC-F03-07 | `AC-F03-07: a recorded visit is readable directly and through its pet` |' +
      ' integration | green |';

    writeFileSync(
      path,
      text
        .replace('## Test plan', criterion)
        .replace(
          '| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet\'s remaining visits` | integration | green |',
          '| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet\'s remaining visits` | integration | green |\n' + row
        )
    );

    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /baseline: \d+ pre-existing criteria unchanged/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

// The `--list-checks` parity test moved into the Skill folder, to
// `.claude/skills/spec-builder/self-check.test.mjs`. It reads nothing but the gate and
// `references/spec-layout.md`, and the guarantee it provides is one both of those documents claim in
// prose — so it has to travel with them. `tests/skill-hygiene.test.mjs` imports it into this run.

test('a byte-order mark does not make depends_on vanish', () => {
  // The same defect as CRLF, in the one place the CRLF fix did not reach: `﻿` at offset 0 defeats
  // the frontmatter regex, which anchors at string start with no `m` flag. The frontmatter came back
  // empty and the sentinel then printed `declares no depends_on` over a package that declared some —
  // the exact falsehood that sentinel exists to prevent. A BOM is what a Windows editor writes.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-02-owner-pet-lifecycle.md');
    const withStaleDependency = readFileSync(path, 'utf8').replace(
      '"../contracts/openapi.yaml"',
      '"../contracts/missing.yaml"'
    );
    writeFileSync(path, '﻿' + withStaleDependency);

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /missing\.yaml/);
  } finally {
    discard(spec);
  }
});

test('a directory named like a required file is refused, not crashed on', () => {
  // Measured before isFile() reached here: section 1 printed `ok  … present`, then the conventions read
  // threw an uncaught EISDIR out of the middle of the run — exit 1 with a stack trace and no verdict
  // line at all. A gate that crashes cannot tell the loop "the check failed" from "the checker broke".
  const spec = specCopy();
  try {
    rmSync(join(spec, 'context-and-conventions.md'));
    mkdirSync(join(spec, 'context-and-conventions.md'));

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /context-and-conventions\.md: missing, or not a file/);
    assert.match(result.out, /check-spec FAIL/, 'a verdict line, not a stack trace');
    assert.doesNotMatch(result.out, /EISDIR/);
  } finally {
    discard(spec);
  }
});

test('a sibling link written without ./ is still checked', () => {
  // `](F-01-owner-lifecycle.md)` is the ordinary way to write a sibling link, and requiring `./` meant
  // a bare one — naming a file that does not exist — was examined by none of the three link scans.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      '[F-01](./F-01-owner-lifecycle.md)',
      '[F-01](F-01-typo-lifecycle.md)'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /links to F-01-typo-lifecycle\.md, which does not exist/);
  } finally {
    discard(spec);
  }
});

test('a criterion heading one character off is refused, not ignored', () => {
  // Measured before this check existed: an appended `### AC-F03-7 —` with no US line and no Test plan
  // row left the gate byte-identical to the untouched reference. acBodies opened no body for it, so
  // nothing demanded a row, nothing read its parts, and the numbering saw no hole. It silently never
  // became a test.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-03-pet-visit-flow.md');
    const text = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      text.replace(
        '## Test plan',
        '### AC-F03-7 — one digit short, and invisible to everything\n\nNo parts, no row.\n\n## Test plan'
      )
    );

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F03-7 — not the shape AC-Fxx-yy/);
  } finally {
    discard(spec);
  }
});

/** The mutation both halves of the next test share: a criterion appended with `###  ` — two spaces. */
const appendTwoSpaceCriterion = (spec) =>
  edit(
    spec,
    'flows/F-03-pet-visit-flow.md',
    '## Test plan',
    '###  AC-F03-07 — two spaces after the hashes, and otherwise complete\n\n' +
      '**US:** US-05\n' +
      '**Why this matters:** it exists to be parsed, and nothing else about it is wrong.\n\n' +
      '**Given** the common precondition of this flow\n\n' +
      '**Step 1 — read the log**\n' +
      '**When** `GET /visits`\n' +
      '**Then** code `200`; each entry carries an `id`.\n\n' +
      '**Step 2 — read the same record through the pet**\n' +
      '**When** `GET /pets/{petId}`\n' +
      '**Then** code `200`; the `visits` array carries the same `id`.\n\n' +
      '## Test plan'
  );

test('a criterion heading with two spaces after ### is not silently dropped', () => {
  // The neighbouring test's defect one character further on, and it was the WORSE of the two: the
  // malformed-heading check accepted `\s+` while `acBodies` required exactly one space, so this heading
  // was certified `well-formed` and opened no body at all.
  //
  // Measured on the reference package with the old gate: exit 0, 80 checks, and AC-F03-07 named
  // nowhere in the output. No Test plan row was demanded of it, its five parts were never read, its
  // endpoints were never containment-checked, and the numbering saw no hole because the id was never
  // counted. That silence is what this half pins — the criterion is now parsed, so the missing row is
  // reported.
  const spec = specCopy();
  try {
    appendTwoSpaceCriterion(spec);
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F03-07 — no Test plan row/);
  } finally {
    discard(spec);
  }
});

test('a criterion heading with two spaces after ### is otherwise ordinary', () => {
  // The other half: once the row is there the criterion is complete, so the whitespace itself must not
  // be an error. A fix that tightened `acBodies` instead of loosening it would pass the test above and
  // fail here, and the pair is what pins the direction the two readings were reconciled in.
  const spec = specCopy();
  try {
    appendTwoSpaceCriterion(spec);
    edit(
      spec,
      'flows/F-03-pet-visit-flow.md',
      "| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet's remaining visits` | integration | green |",
      "| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet's remaining visits` | integration | green |\n" +
        '| AC-F03-07 | `AC-F03-07: two spaces after the hashes, and otherwise complete` | integration | green |'
    );

    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /AC-F03-07 carries US, Why this matters, Given, When and Then/);
  } finally {
    discard(spec);
  }
});

test('a well-formed heading that opens no body is reported, not passed over', () => {
  // The tripwire between the gate's two readings of a criterion heading. It cannot be provoked through
  // a package while the two agree — that is the point of it — so the guard itself is what is asserted:
  // it runs once per flow document and says so, which is the only way a check that is vacuous by
  // construction can be confirmed to be running at all.
  const spec = specCopy();
  try {
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    const confirmations = result.out.match(/every well-formed criterion heading opened a body/g) ?? [];
    assert.equal(confirmations.length, readdirSync(join(spec, 'flows')).length, result.out);
  } finally {
    discard(spec);
  }
});

test('a heading outside ASCII yields a working anchor rather than an empty one', () => {
  // `slug` used `\w`, which is ASCII-only, so every non-ASCII letter was deleted. Two consequences,
  // both measured, and this exercises the one that produces a FALSE GREEN: two headings differing only
  // outside ASCII collapsed onto the same slug, so a link into either was reported as resolving while
  // one of them is dead in a browser. The Skill is meant to prepare a package for any project, and an
  // ASCII-only anchor rule quietly excludes most of them.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-01-owner-lifecycle.md');
    const text = readFileSync(path, 'utf8');
    // One table renamed into another script, and every link to it renamed to the anchor a renderer
    // builds. Under the old slug both sides became `test-data--`, so the link resolved to a heading it
    // does not name.
    writeFileSync(
      path,
      text
        .replaceAll('#test-data--owner', '#test-data--заявка')
        .replace('## Test data — owner', '## Test data — заявка')
    );

    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /anchor #test-data--заявка resolves/);
  } finally {
    discard(spec);
  }
});

test('an anchor matching two headings is refused rather than reported as resolving', () => {
  // The other half of the same defect, and the one that stays reachable now that slugs keep their
  // letters: a fragment matching more than one heading reaches the first and leaves the rest
  // unreachable, so a criterion can link to a table and silently be sent to a different one.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-01-owner-lifecycle.md');
    const text = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      text.replace('## Test plan', '## Test data — owner\n\nA second table under the same heading.\n\n## Test plan')
    );

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /anchor #test-data--owner matches 2 headings in this file/);
  } finally {
    discard(spec);
  }
});

test('a fenced US line does not stand in for the criterion it illustrates', () => {
  // Section 6 read the `**US:**` line from the RAW body while section 5, one loop above, read the same
  // body with fences removed. `.exec` takes the first match, so a fenced illustration of the reference
  // line became the criterion's reference and the real one was never seen — measured: BOTH traceability
  // checks failed at once on a correct package, one for a dangling id and one for the story it orphaned.
  const spec = specCopy();
  try {
    // The fence sits INSIDE AC-F01-01's body and BEFORE its real reference line, which is what makes
    // the first match the wrong one.
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**US:** US-01, US-02, US-04',
      'The shape of the reference line, for illustration:\n\n' +
        '```markdown\n**US:** US-99\n```\n\n' +
        '**US:** US-01, US-02, US-04'
    );

    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.doesNotMatch(result.out, /US-99/);
  } finally {
    discard(spec);
  }
});

test('single-digit user story numbers are refused, not silently ignored', () => {
  // One consistent editorial choice, internally coherent, and both traceability checks went empty:
  // `ok  user stories: every reference resolves (0 referenced)`. This is the empty-collection family
  // sections 2, 3 and 9 each guard explicitly.
  const spec = specCopy();
  try {
    for (const relative of [
      'context-and-conventions.md',
      'flows/F-01-owner-lifecycle.md',
      'flows/F-02-owner-pet-lifecycle.md',
      'flows/F-03-pet-visit-flow.md',
    ]) {
      const path = join(spec, relative);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/US-0(\d)/g, 'US-$1'));
    }

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /user stories: none found in the shape/);
  } finally {
    discard(spec);
  }
});

test('a Test plan row that exists only inside a fence is not a row', () => {
  // Measured: deleting a real row while a fenced "the row format, for reference" example held it left
  // the gate green. planRows was the one row, heading or request scan that did not filter fences.
  const spec = specCopy();
  try {
    const row =
      "| AC-F01-02 | `AC-F01-02: updated owner contacts are visible in the owner details and the owners list without a duplicate` | integration | green |";
    edit(spec, 'flows/F-01-owner-lifecycle.md', row + '\n', '');
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## Test plan',
      '## Test plan\n\nThe row format, for reference:\n\n```markdown\n' + row + '\n```\n'
    );

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F01-02 — no Test plan row/);
  } finally {
    discard(spec);
  }
});

test('a criterion whose steps are all fenced does not carry its five parts', () => {
  // Measured: `ok  … AC-F03-07 carries US, Why this matters, Given, When and Then` on a criterion with
  // no visible step at all, because PARTS tested the raw body.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-03-pet-visit-flow.md');
    const text = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      text
        .replace(
          '## Test plan',
          '### AC-F03-07 — every step hidden inside an example\n\n' +
            '**US:** US-05\n' +
            '**Why this matters:** it does not, this criterion is a probe.\n\n' +
            '```markdown\n' +
            '**Given** an owner is registered\n' +
            '**When** `GET /visits/{visitId}`\n' +
            '**Then** code `200`.\n' +
            '```\n\n## Test plan'
        )
        .replace(
          "| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet's remaining visits` | integration | green |",
          "| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet's remaining visits` | integration | green |\n" +
            '| AC-F03-07 | `AC-F03-07: every step hidden inside an example` | integration | green |'
        )
    );

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F03-07 is missing Given, When, Then/);
  } finally {
    discard(spec);
  }
});

test('a fenced section heading does not hijack the section it names', () => {
  // The mirror direction, and a false RED: a "how this document is laid out" note holding
  // `## API behavior used in this flow` and `## Test plan` inside a fence made the gate emit two
  // failures on a correct package — every declaration lost, every criterion suddenly rowless.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## What the flow verifies',
      'The sections of this document, in order:\n\n' +
        '```markdown\n## API behavior used in this flow\n## Acceptance criteria\n## Test plan\n```\n\n' +
        '## What the flow verifies'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('a fenced example of a numbered section is not a section', () => {
  // Section 2 was the last scan in this file to read its file raw, while the user-story scan of the
  // same file went through `unfenced`. Measured: an illustration of the numbering inside a ```markdown
  // block made the gate report `section numbering is 1, 2, 1 — expected 1, 2, 3` on an otherwise
  // untouched package — a conventions file failing for documenting the addressing scheme it is
  // required to keep.
  const spec = specCopy();
  try {
    const path = join(spec, 'context-and-conventions.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n\`\`\`markdown\n## 1. Scope\n\`\`\`\n`);

    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('a subheading inside a section does not truncate the rows below it', () => {
  // `section` used to end at ANY `### `, which closed one hole and opened a smaller one beside it: a
  // `## ` section is entitled to a subheading, and every row under one became invisible. Measured — a
  // behavior table split this way reported its own declared endpoint as `used in an AC step but absent
  // from "API behavior used in this flow"`, sending the author to look for a row four lines above the
  // criterion. The boundary is now a criterion heading rather than any subheading.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '| `GET /owners` |',
      '### Reads used only in the setup\n\n| Request | Response |\n|---|---|\n| `GET /owners` |'
    );

    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('a byte-order mark on a link target does not hide its first heading', () => {
  // The BOM was stripped inside `parseFlow` only, so the two other files this gate opens inherited the
  // defect. Measured on this one: with the conventions file saved as UTF-8-with-BOM its `# ` title was
  // invisible to the heading scan, and a correct link onto it was reported as resolving to no heading.
  // `Out-File` and `Set-Content -Encoding utf8` both write that BOM, which is what makes it ordinary
  // rather than exotic.
  const spec = specCopy();
  try {
    const conventions = join(spec, 'context-and-conventions.md');
    const title = readFileSync(conventions, 'utf8').split('\n')[0];
    assert.ok(title.startsWith('# '), `conventions do not open with a title: ${title}`);
    const fragment = title
      .slice(2)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');

    writeFileSync(conventions, `﻿${readFileSync(conventions, 'utf8')}`);
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## What the flow verifies',
      `See [the conventions](../context-and-conventions.md#${fragment}).\n\n## What the flow verifies`
    );

    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /anchor \.\.\/context-and-conventions\.md#.+ resolves/);
  } finally {
    discard(spec);
  }
});

test('the Skill instructs without naming the reference project domain', () => {
  // The design forbids the reference project's vocabulary anywhere in the Skill, in writing — and it
  // went wrong twice anyway: eighteen mentions in `spec-layout.md`, and a plan that twice accused the
  // wrong flow document of a gap. The pull is structural rather than careless. The reference package is
  // the only spec package that exists, so a hand reaching for an example reaches for it.
  //
  // The line is who reads the file. `check-spec.mjs`'s comments cite the reference constantly and must:
  // they record what was measured and why each check exists, and nothing that writes a package ever
  // reads them. The files below ARE what a model reads to learn how to write one, and an example there
  // becomes the entities it reaches for.
  //
  // Extend FORBIDDEN if the reference package ever changes domain. A list that silently describes a
  // package nobody uses any more is the one way this check can go quiet.
  const FORBIDDEN = [
    /\bowners?\b/i,
    /\bpets?\b/i,
    /\bpettypes?\b/i,
    /\bvisits?\b/i,
    /\bpetclinic\b/i,
    /\bvets?\b/i,
  ];

  const skill = join(ROOT, '.claude/skills/spec-builder');
  const referencesDir = join(skill, 'references');

  const instructions = [
    ...(existsSync(join(skill, 'SKILL.md')) ? ['SKILL.md'] : []),
    ...(existsSync(referencesDir)
      ? readdirSync(referencesDir)
          .filter((name) => name.endsWith('.md'))
          .map((name) => `references/${name}`)
      : []),
  ];

  // A check that found no files to read would pass while measuring nothing — the failure mode this
  // whole suite exists to refuse.
  assert.ok(instructions.length > 0, 'no instruction files found; has the Skill folder moved?');

  const offences = [];
  for (const relative of instructions) {
    readFileSync(join(skill, relative), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const pattern of FORBIDDEN) {
          const hit = pattern.exec(line);
          if (hit) offences.push(`${relative}:${index + 1} names "${hit[0]}"`);
        }
      });
  }

  assert.deepEqual(
    offences,
    [],
    'the reference project domain appears in files a model reads as instructions — replace the ' +
      'example with one from an unrelated domain; the rule it illustrates comes from the reference, ' +
      'the entities in it must not'
  );
});
