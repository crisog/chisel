#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findStateFile,
  appendRunHistory,
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
    // Ignore.
  }
}

function log(sessionId, line) {
  ensureDir(path.join(LOG_ROOT, sessionId));
  const logPath = path.join(LOG_ROOT, sessionId, "session-end.log");
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    // Silent failure to avoid impacting SessionEnd.
  }
}

function output(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function main() {
  const input = parseInput(safeReadStdin());
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || "unknown";

  let stateResult;
  try {
    stateResult = findStateFile(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(sessionId, `findStateFile failed: ${msg}`);
    output({});
    return;
  }

  if (stateResult.mode === "missing" || stateResult.mode === "parse_error") {
    output({});
    return;
  }

  if (!stateResult.statePath || !stateResult.state) {
    output({});
    return;
  }

  try {
    const historyPath = appendRunHistory(
      stateResult.statePath,
      stateResult.state,
      "SessionEnd",
      sessionId
    );
    log(sessionId, `Session summary appended to ${historyPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(sessionId, `Failed to append run history: ${msg}`);
  }

  output({});
}

main();
