#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findStateFile,
  isTerminalStatus,
} = require("./lib/state");

const LOG_ROOT = path.join(os.homedir(), ".claude", "chisel");

function safeReadStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseInput(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    // Ignore logging directory creation failures.
  }
}

function log(sessionId, line) {
  ensureDir(path.join(LOG_ROOT, sessionId));
  const logPath = path.join(LOG_ROOT, sessionId, "crash.log");
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    // Silent failure to avoid breaking hook flow.
  }
}

function output(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function buildBlockReason(state, statePath, errorDetail = null) {
  const iter = Number(state.iteration || 0);
  const maxIter = Number(state.max_iterations || 0);
  const unresolvedCount = Array.isArray(state.unresolved_ids) ? state.unresolved_ids.length : 0;
  const score = state.latest_score == null ? "unknown" : String(state.latest_score);
  const status = state.status || "running";

  if (errorDetail) {
    return `# Chisel Gate Active (Fail-Closed)

Chisel found loop state but could not safely evaluate completion.

- State file: \`${statePath}\`
- Error: ${errorDetail}

Run \`/chisel:status\` to inspect current loop state.
If you need to exit immediately, run \`/chisel:cancel-loop --force\` and then exit again.`;
  }

  return `# Chisel Loop Still Active

Chisel blocked this exit because the refinement loop is still in progress.

- Status: \`${status}\`
- Iteration: \`${iter}/${maxIter || "?"}\`
- Latest score: \`${score}\`
- Unresolved comments: \`${unresolvedCount}\`
- State file: \`${statePath}\`

Continue with \`/chisel:run-loop\` or inspect details with \`/chisel:status\`.
To break out intentionally, run \`/chisel:cancel-loop\` and then exit again.`;
}

function main() {
  const input = parseInput(safeReadStdin());
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || "unknown";
  const eventName = input.hook_event_name || "Stop";

  log(sessionId, `Hook invoked: ${eventName} cwd=${cwd}`);

  let stateResult;
  try {
    stateResult = findStateFile(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(sessionId, `findStateFile failure: ${msg}`);
    output({
      decision: "block",
      reason: `# Chisel Gate Error\n\nChisel failed while checking loop state.\n\nError: ${msg}\n\nRun \`/chisel:cancel-loop --force\` if you need to bypass this gate.`,
    });
    return;
  }

  if (stateResult.mode === "missing") {
    output({});
    return;
  }

  if (stateResult.mode === "parse_error") {
    const errMsg = stateResult.error instanceof Error ? stateResult.error.message : String(stateResult.error);
    log(sessionId, `parse_error for ${stateResult.statePath}: ${errMsg}`);
    output({
      decision: "block",
      reason: buildBlockReason({ iteration: 0, max_iterations: 0, unresolved_ids: [], latest_score: null, status: "running" }, stateResult.statePath, errMsg),
    });
    return;
  }

  if (stateResult.mode === "inactive") {
    output({});
    return;
  }

  const state = stateResult.state || {};
  if (isTerminalStatus(state.status) || state.active !== true) {
    output({});
    return;
  }

  log(
    sessionId,
    `Blocking stop; status=${state.status || "running"} iteration=${state.iteration || 0}`
  );
  output({
    decision: "block",
    reason: buildBlockReason(state, stateResult.statePath),
  });
}

main();
