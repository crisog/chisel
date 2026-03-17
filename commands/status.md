---
description: Show Chisel loop status from state and run history
argument-hint: [--pr N]
---

# Chisel Status

Inspect the current loop state and latest run summary.

## Steps

1. Determine git root:
   ```bash
   git rev-parse --show-toplevel
   ```
2. Read state file if present:
   - `{GIT_ROOT}/.claude/chisel-loop.local.md`
3. Read run history if present:
   - `{GIT_ROOT}/.claude/chisel/runs/<PR>.json`
4. If state file does not exist, report:
   - `No active Chisel loop state found in this repository.`

## Output Format

Return:

- `active`
- `status`
- `repo`
- `pr_number`
- `iteration / max_iterations`
- `latest_score`
- `unresolved_count`
- `updated_at`
- `backup_branch`
- latest terminal summary from run history (if available)
