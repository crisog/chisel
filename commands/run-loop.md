---
description: Run Chisel's autonomous GitHub + Greptile refinement loop
argument-hint: [--pr N] [--max-iterations N]
---

# Chisel Run Loop

Run the PR refinement loop until success criteria or a safety stop is reached.

## Parse Arguments

Arguments: `$ARGUMENTS`

- `--pr N`: optional PR number. If omitted, detect PR from current branch and create one if missing.
- `--max-iterations N`: optional iteration cap. Default is `5`.

If the arguments are malformed, stop and ask for corrected values.

## State Contract

Loop state file path:

- `{GIT_ROOT}/.claude/chisel-loop.local.md`

Frontmatter keys (required):

- `active`: boolean
- `repo`: `owner/repo`
- `pr_number`: integer
- `branch`: string
- `base_sha`: string
- `iteration`: integer
- `max_iterations`: integer
- `target_score`: integer (default `5`)
- `latest_score`: number or `null`
- `unresolved_ids`: JSON array of strings
- `status`: one of `running`, `success`, `safety_max_iterations`, `safety_no_progress`, `safety_review_failed`, `cancelled`
- `backup_branch`: string
- `started_at`: ISO timestamp
- `updated_at`: ISO timestamp

## Step 1: Preflight

1. Verify git repo:
   ```bash
   git rev-parse --is-inside-work-tree
   ```
2. Verify GitHub auth:
   ```bash
   gh auth status
   ```
3. Verify branch and repository metadata:
   ```bash
   git rev-parse --abbrev-ref HEAD
   gh repo view --json nameWithOwner,defaultBranchRef
   ```
4. Verify Greptile MCP is reachable by listing merge requests for the current repo (small limit).

If any preflight check fails, stop with the precise remediation and do not write active loop state.

## Step 2: Ensure PR and Initialize Loop State

1. Resolve git root:
   ```bash
   git rev-parse --show-toplevel
   ```
2. Ensure branch is pushed:
   ```bash
   git push -u origin HEAD
   ```
3. Resolve PR number:
   - If `--pr` is provided, use it.
   - Else try:
     ```bash
     gh pr view --json number,url,state,headRefName,baseRefName
     ```
   - If no PR exists, create one:
     ```bash
     gh pr create --fill
     ```
4. Create a rollback anchor branch:
   ```bash
   git branch "chisel/backup/pr-<PR>-<YYYYmmdd-HHMMSS>" "$(git rev-parse HEAD)"
   ```
5. Write the state file with `active: true`, `iteration: 0`, `status: running`.

## Step 3: Iterative Refinement

Repeat until terminal status:

1. Increment `iteration`.
2. Trigger review:
   - Use Greptile MCP `trigger_code_review` for this PR.
3. Poll review status:
   - Use `list_code_reviews`.
   - Wait between polls (`sleep 15`).
   - Timeout if review does not finish within a practical window.
4. Fetch latest review data:
   - Use `get_merge_request` to read confidence/metadata.
   - Use `list_merge_request_comments` with:
     - `greptileGenerated=true`
     - `addressed=false`
5. Compute unresolved IDs from comments (stable per iteration).
6. Success check:
   - If confidence is `5` and unresolved count is `0`, set:
     - `status: success`
     - `active: false`
     - write summary
     - stop.
7. Safety checks:
   - If review fails/terminal error: `status: safety_review_failed`, `active: false`, stop.
   - If `iteration >= max_iterations`: `status: safety_max_iterations`, `active: false`, stop.
   - If unresolved IDs did not change from previous iteration: `status: safety_no_progress`, `active: false`, stop.
8. Fix pass:
   - Resolve actionable findings in code.
   - Run best-effort project checks.
   - Create exactly one commit:
     ```text
     chisel: resolve greptile findings (iter N/MAX)
     ```
   - Push branch.
9. Attempt GitHub thread resolution for fixed findings:
   - Use `gh api graphql` `resolveReviewThread` only for high-confidence matches (same file + overlapping lines + missing from latest unresolved set).
   - If mapping is ambiguous, skip and report.
10. Update state file (`latest_score`, `unresolved_ids`, `updated_at`) and continue.

## Step 4: Terminal Report

When loop ends (success or safety stop):

1. Keep state file but set `active: false`.
2. Write a concise run summary:
   - PR URL
   - final status
   - iterations used
   - last score
   - unresolved comment IDs
   - backup branch name
3. Tell the user next action:
   - `success`: ready for human review/merge
   - safety stop: explicit blockers and suggested manual follow-up
