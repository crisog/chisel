#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STOP_HOOK = path.join(REPO_ROOT, "hooks", "chisel-stop-hook.js");
const SESSION_END_HOOK = path.join(REPO_ROOT, "hooks", "chisel-session-end-hook.js");

function runNode(script, input) {
  const proc = spawnSync("node", [script], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    throw new Error(`Hook process failed (${script}): ${proc.stderr || proc.stdout}`);
  }
  const out = (proc.stdout || "").trim();
  return out ? JSON.parse(out) : {};
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chisel-hook-test-"));
  const git = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  if (git.status !== 0) {
    throw new Error(`git init failed: ${git.stderr}`);
  }
  return dir;
}

function writeState(repoDir, frontmatterLines) {
  const statePath = path.join(repoDir, ".claude", "chisel-loop.local.md");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    `---\n${frontmatterLines.join("\n")}\n---\n# Chisel Loop State\n`,
    "utf8"
  );
  return statePath;
}

function testStopAllowsWhenMissing() {
  const repo = makeTempRepo();
  const out = runNode(STOP_HOOK, {
    cwd: repo,
    session_id: "t-missing",
    hook_event_name: "Stop",
  });
  assert.strictEqual(out.decision, undefined);
}

function testStopBlocksWhenActive() {
  const repo = makeTempRepo();
  writeState(repo, [
    "active: true",
    'status: "running"',
    "iteration: 2",
    "max_iterations: 5",
    "latest_score: 3",
    'unresolved_ids: ["c1","c2"]',
  ]);

  const out = runNode(STOP_HOOK, {
    cwd: repo,
    session_id: "t-active",
    hook_event_name: "Stop",
  });

  assert.strictEqual(out.decision, "block");
  assert.match(out.reason, /Chisel Loop Still Active/);
}

function testStopAllowsTerminal() {
  const repo = makeTempRepo();
  writeState(repo, [
    "active: true",
    'status: "success"',
    "iteration: 3",
    "max_iterations: 5",
    "latest_score: 5",
    "unresolved_ids: []",
  ]);

  const out = runNode(STOP_HOOK, {
    cwd: repo,
    session_id: "t-success",
    hook_event_name: "Stop",
  });

  assert.strictEqual(out.decision, undefined);
}

function testStopBlocksMalformedState() {
  const repo = makeTempRepo();
  const statePath = path.join(repo, ".claude", "chisel-loop.local.md");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, "not-frontmatter", "utf8");

  const out = runNode(STOP_HOOK, {
    cwd: repo,
    session_id: "t-malformed",
    hook_event_name: "Stop",
  });

  assert.strictEqual(out.decision, "block");
  assert.match(out.reason, /Fail-Closed/);
}

function testStopAllowsCiMaxRetries() {
  const repo = makeTempRepo();
  writeState(repo, [
    "active: true",
    'status: "safety_ci_max_retries"',
    "iteration: 3",
    "max_iterations: 5",
    "latest_score: 5",
    "unresolved_ids: []",
    'ci_status: "failing"',
    'ci_failures: ["Frontend"]',
  ]);

  const out = runNode(STOP_HOOK, {
    cwd: repo,
    session_id: "t-ci-fail",
    hook_event_name: "Stop",
  });

  assert.strictEqual(out.decision, undefined);
}

function testStopBlocksShowsCiStatus() {
  const repo = makeTempRepo();
  writeState(repo, [
    "active: true",
    'status: "running"',
    "iteration: 2",
    "max_iterations: 5",
    "latest_score: 4",
    'unresolved_ids: ["c1"]',
    'ci_status: "failing"',
    'ci_failures: ["Frontend","Backend"]',
  ]);

  const out = runNode(STOP_HOOK, {
    cwd: repo,
    session_id: "t-ci-block",
    hook_event_name: "Stop",
  });

  assert.strictEqual(out.decision, "block");
  assert.match(out.reason, /CI:.*failing/);
  assert.match(out.reason, /Frontend/);
}

function testSessionEndCapturesCiFields() {
  const repo = makeTempRepo();
  writeState(repo, [
    "active: false",
    'status: "success"',
    "pr_number: 456",
    "iteration: 2",
    "max_iterations: 5",
    "latest_score: 5",
    "unresolved_ids: []",
    'ci_status: "passing"',
    "ci_failures: []",
  ]);

  runNode(SESSION_END_HOOK, {
    cwd: repo,
    session_id: "t-ci-end",
    hook_event_name: "SessionEnd",
  });

  const historyPath = path.join(repo, ".claude", "chisel", "runs", "456.json");
  const data = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  assert.strictEqual(data.events[0].ci_status, "passing");
  assert.deepStrictEqual(data.events[0].ci_failures, []);
}

function testSessionEndAppendsHistory() {
  const repo = makeTempRepo();
  writeState(repo, [
    "active: false",
    'status: "cancelled"',
    "pr_number: 123",
    "iteration: 1",
    "max_iterations: 5",
    "latest_score: 2",
    'unresolved_ids: ["x1"]',
  ]);

  const out = runNode(SESSION_END_HOOK, {
    cwd: repo,
    session_id: "t-end",
    hook_event_name: "SessionEnd",
  });
  assert.strictEqual(out.decision, undefined);

  const historyPath = path.join(repo, ".claude", "chisel", "runs", "123.json");
  assert.ok(fs.existsSync(historyPath), "SessionEnd should create run history");
  const data = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  assert.ok(Array.isArray(data.events));
  assert.strictEqual(data.events.length, 1);
  assert.strictEqual(data.events[0].event, "SessionEnd");
}

function main() {
  testStopAllowsWhenMissing();
  testStopBlocksWhenActive();
  testStopAllowsTerminal();
  testStopBlocksMalformedState();
  testStopAllowsCiMaxRetries();
  testStopBlocksShowsCiStatus();
  testSessionEndCapturesCiFields();
  testSessionEndAppendsHistory();
  process.stdout.write("All hook tests passed.\n");
}

main();
