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
- `ci_status`: one of `pending`, `passing`, `failing`, `unknown`
- `ci_failures`: JSON array of strings (failed check names)
- `status`: one of `running`, `success`, `safety_max_iterations`, `safety_no_progress`, `safety_review_failed`, `safety_ci_max_retries`, `cancelled`
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
5. Write the state file with `active: true`, `iteration: 0`, `status: running`, `ci_status: unknown`, `ci_failures: []`.

## Step 3: Iterative Refinement

Repeat until terminal status:

1. Increment `iteration`.
2. Ensure a review exists for the current HEAD:
   - First, check for an existing review:
     ```
     list_code_reviews(name, remote, defaultBranch, prNumber=<PR>)
     ```
   - If a review with status `PENDING`, `REVIEWING_FILES`, or `GENERATING_SUMMARY` exists, **do not trigger a new one** — skip to step 3 and wait for it.
   - If a review with status `COMPLETED` exists and its results are for the current HEAD commit (check the most recent review's timestamp is after the last push), **skip to step 4** and use those results directly.
   - Otherwise (no review, or only `FAILED`/`SKIPPED` reviews), trigger a new one:
     ```
     trigger_code_review(name, remote, prNumber=<PR>)
     ```
3. Poll review status:
   - Use `list_code_reviews` filtered by `prNumber`.
   - Wait between polls (`sleep 15`).
   - Timeout if review does not finish within a practical window.
4. Fetch latest review data:
   - Use `get_merge_request` to read confidence/metadata.
   - Use `list_merge_request_comments` with:
     - `greptileGenerated=true`
     - `addressed=false`
5. Compute unresolved IDs from comments (stable per iteration).
6. **CI gate** — check GitHub required checks:
   - Run:
     ```bash
     gh pr checks <PR> --json name,state,conclusion --jq '[.[] | select(.state != "")]'
     ```
   - Wait for all checks to reach a terminal state (not `pending`/`queued`/`in_progress`). Poll with `sleep 30`, timeout after 10 minutes.
   - Classify:
     - `passing`: all checks succeeded or skipped.
     - `failing`: one or more checks failed. Record failed check names in `ci_failures`.
   - Update state: `ci_status`, `ci_failures`.
7. **CI fix pass** — if `ci_status` is `failing`:
   - For each failed check, fetch logs:
     ```bash
     gh pr checks <PR> --json name,state,conclusion,link --jq '[.[] | select(.conclusion == "failure")]'
     ```
   - For each failed run, extract actionable errors:
     ```bash
     gh run view <RUN_ID> --log-failed 2>&1 | tail -80
     ```
   - Parse the failure output for lint errors, type errors, or build errors.
   - Fix the identified issues in code.
   - Create exactly one commit:
     ```text
     chisel: fix CI failures (iter N/MAX)
     ```
   - Push branch.
   - Re-poll CI (same logic as step 6). If CI still fails after 2 consecutive CI fix attempts within the same iteration, set `status: safety_ci_max_retries`, `active: false`, stop.
   - Once CI passes, continue to step 8.
8. Success check — **all three conditions must be true**:
   - Greptile confidence is `5`.
   - Unresolved Greptile comment count is `0`.
   - `ci_status` is `passing`.
   - If all met, set `status: success`, `active: false`, write summary, stop.
9. Safety checks:
   - If review fails/terminal error: `status: safety_review_failed`, `active: false`, stop.
   - If `iteration >= max_iterations`: `status: safety_max_iterations`, `active: false`, stop.
   - If unresolved IDs did not change from previous iteration AND `ci_status` is `passing`: `status: safety_no_progress`, `active: false`, stop.
10. Greptile fix pass:
    - Resolve actionable Greptile findings in code.
    - Run best-effort project checks locally if available.
    - Create exactly one commit:
      ```text
      chisel: resolve greptile findings (iter N/MAX)
      ```
    - Push branch.
11. Attempt GitHub thread resolution for fixed findings:
    - Use `gh api graphql` `resolveReviewThread` only for high-confidence matches (same file + overlapping lines + missing from latest unresolved set).
    - If mapping is ambiguous, skip and report.
12. Update state file (`latest_score`, `unresolved_ids`, `ci_status`, `ci_failures`, `updated_at`) and continue.

## Step 4: Terminal Report

When loop ends (success or safety stop):

1. Keep state file but set `active: false`.
2. Write a concise run summary:
   - PR URL
   - final status
   - iterations used
   - last score
   - CI status and any failed check names
   - unresolved comment IDs
   - backup branch name
3. Tell the user next action:
   - `success`: ready for human review/merge
   - `safety_ci_max_retries`: CI failures could not be auto-fixed; show failed checks and suggest manual intervention
   - other safety stop: explicit blockers and suggested manual follow-up
