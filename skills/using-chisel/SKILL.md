---
name: using-chisel
description: Use when the user wants to create/update a PR, run a GitHub review loop, or fix Greptile findings until quality gates pass.
---

# Using Chisel

Chisel is a PR refinement loop:

1. Prepare branch and PR
2. Trigger automated review
3. Fix findings
4. Push updates
5. Repeat until gate passes or safety stop

## Rules

- Prefer `/chisel:run-loop` for end-to-end execution.
- Use `/chisel:status` to inspect active run state.
- Use `/chisel:cancel-loop` as the explicit escape hatch.
- Respect stop gates: do not claim completion while loop state is `active: true` and `status` is non-terminal.

## Exit Gate

Default success criteria:

- Greptile confidence score is `5/5`
- Unresolved Greptile-generated comments are `0`

Safety stops:

- Max iterations reached
- No progress across consecutive iterations
- Review run failed or cannot complete

## Preflight

Before loop execution:

- Confirm repository is a git worktree.
- Confirm `gh` authentication is valid.
- Confirm Greptile MCP tools are available.

If a preflight check fails, do not start the loop state file.
