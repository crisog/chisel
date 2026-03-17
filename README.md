# Chisel

Chisel is a Claude Code plugin for PR refinement driven by automated review.

Instead of treating local checks as the final evaluator, Chisel assumes the strongest critic is an external PR review system (Greptile in v1).

## Loop

1. Make a change
2. Open or update a PR
3. Wait for automated review
4. Fix findings
5. Repeat until the target score or confidence is reached

Chisel uses automated PR review as the gate between iterations.

## v1 Focus

- Claude Code plugin
- GitHub PR workflow (`gh`)
- Greptile MCP review tools
- Stop-hook gates (`Stop`, `SubagentStop`) to prevent premature loop exits

Default success gate:

- Greptile confidence score `5/5`
- Zero unresolved Greptile-generated comments

Default safety stops:

- Max iterations reached
- No progress across consecutive iterations
- Review pipeline failure

## Commands

- `/chisel:run-loop [--pr N] [--max-iterations N]`
- `/chisel:status [--pr N]`
- `/chisel:cancel-loop [--force]`
- `/chisel:help`

## Local Install (Development Marketplace)

1. Add this repo as a marketplace:
   ```bash
   /plugin marketplace add /Users/crisog/Code/Personal/chisel
   ```
2. Install Chisel:
   ```bash
   /plugin install chisel@chisel-dev
   ```
3. Restart Claude Code.

## Requirements

- `git`
- `gh` CLI authenticated (`gh auth status`)
- Greptile MCP configured in Claude Code
- `node` available (for stop/session-end hook runtime)

## State Files

- Loop state: `.claude/chisel-loop.local.md` (at git root)
- Run history: `.claude/chisel/runs/<pr>.json`

## Tests

```bash
./tests/run-tests.sh
```

## Example Flow

```text
generate -> create PR -> wait for review -> fix findings -> repeat
```
