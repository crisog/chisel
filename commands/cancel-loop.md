---
description: Cancel an active Chisel loop and release stop-hook gating
argument-hint: [--force]
---

# Cancel Chisel Loop

Deactivate the loop state so stop hooks allow session exit.

## Steps

1. Resolve git root:
   ```bash
   git rev-parse --show-toplevel
   ```
2. Locate state file:
   - `{GIT_ROOT}/.claude/chisel-loop.local.md`
3. If state file is missing:
   - Output `No active Chisel loop state file found.`
   - Stop.
4. Update frontmatter:
   - `active: false`
   - `status: cancelled`
   - `updated_at: <now ISO>`
5. Preserve all other fields.
6. Confirm cancellation and provide current status.

Use `--force` when a stop hook is blocking due to internal hook error.
