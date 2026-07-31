---
name: subagent-driven-development
description: "Use when executing implementation plans with independent tasks in the current session. Dispatches fresh subagent per task with two-stage review."
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

- Have implementation plan with independent tasks
- Want to stay in this session (vs. executing-plans for parallel session)
- Tasks are mostly independent

## The Process

For each task in the plan:

1. **Dispatch implementer subagent** with full task text + project context
2. **Handle implementer status:**
   - **DONE:** Proceed to spec compliance review
   - **DONE_WITH_CONCERNS:** Read concerns, address if needed, then review
   - **NEEDS_CONTEXT:** Provide missing context and re-dispatch
   - **BLOCKED:** Assess blocker and either provide context, use more capable approach, or break into smaller pieces
3. **Dispatch spec reviewer** — confirms code matches spec, nothing missing, nothing extra
4. **If spec issues found:** Implementer fixes → re-review until approved
5. **Dispatch code quality reviewer** — checks implementation quality
6. **If quality issues found:** Implementer fixes → re-review until approved
7. **Mark task complete**

After all tasks:
- Dispatch final code reviewer for entire implementation
- Run full verification: `npx playwright test`

## Model Selection

- **Mechanical tasks** (isolated functions, clear specs, 1-2 files): fast approach
- **Integration tasks** (multi-file coordination, debugging): standard approach
- **Architecture/design/review tasks**: most thorough approach

## Advantages

**vs. Manual execution:**
- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Subagent can ask questions (before AND during work)

**Quality gates:**
- Self-review catches issues before handoff
- Two-stage review: spec compliance, then code quality
- Review loops ensure fixes actually work
- Spec compliance prevents over/under-building

## Red Flags

**Never:**
- Start implementation on main/master branch without explicit user consent
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace actual review (both are needed)
- **Start code quality review before spec compliance is approved** (wrong order)

**If subagent asks questions:**
- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer fixes them
- Reviewer reviews again
- Repeat until approved
