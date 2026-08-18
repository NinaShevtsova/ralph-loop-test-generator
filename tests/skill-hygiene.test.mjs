// tests/skill-hygiene.test.mjs
//
// The Skill's guarantees about itself now live INSIDE the Skill, at
// `.claude/skills/spec-builder/self-check.test.mjs`, so they survive the folder being copied into
// another project — which is the whole point of them: `references/spec-layout.md` and
// `references/validation.md` both rest on "a test enforces this", and a test outside the folder makes
// that sentence false everywhere except here.
//
// This file exists only so `node --test` finds them. Node's runner skips dot-directories, so nothing
// under `.claude/` is discovered on its own; importing the file registers its tests in this run.
//
// The fixture tests built from the one reference package, and the rule forbidding that package's
// vocabulary in the instruction files, stay in `tests/check-spec.test.mjs`. They are about this
// repository rather than about the Skill.
import '../.claude/skills/spec-builder/self-check.test.mjs';
