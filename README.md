# Chisel

Chisel is a Claude Code plugin for autonomous PR refinement driven by automated review.

Instead of treating local checks as the final evaluator, Chisel assumes the strongest critic is an external PR review system (Greptile). It runs parallel agents that self-correct against review feedback without needing you to babysit each PR.

## How it works

1. Make a change
2. Open or update a PR
3. Trigger automated review
4. Fix findings and CI failures
5. Repeat until all gates pass or a safety stop fires

## Success gate

All three must be true:

- Greptile confidence score `5/5`
- Zero unresolved Greptile-generated comments
- All GitHub required checks passing

## Safety stops

- Max iterations reached
- No progress across consecutive iterations
- Review pipeline failure
- CI failures not auto-fixable after 2 consecutive attempts

## Commands

- `/chisel:run-loop [--pr N] [--max-iterations N]` -- start the loop
- `/chisel:status [--pr N]` -- check active run state
- `/chisel:cancel-loop [--force]` -- stop an active loop
- `/chisel:help` -- show usage info

## Install

### From the official marketplace

```
/plugin install chisel
```

### From GitHub

```
/plugin marketplace add crisog/chisel
/plugin install chisel@chisel-dev
```

## Requirements

- `git`
- `gh` CLI authenticated (`gh auth status`)
- `GREPTILE_API_KEY` environment variable set (get one at [app.greptile.com](https://app.greptile.com) under Settings > Organization > API Keys)
- `node` available (for hook runtime)

The Greptile MCP server is bundled with the plugin and configured automatically on install.

## State files

- Loop state: `.claude/chisel-loop.local.md` (at git root)
- Run history: `.claude/chisel/runs/<pr>.json`

## Tests

```bash
./tests/run-tests.sh
```
