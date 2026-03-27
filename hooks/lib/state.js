const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const STATE_REL_PATH = path.join(".claude", "chisel-loop.local.md");
const TERMINAL_STATUSES = new Set([
  "success",
  "safety_max_iterations",
  "safety_no_progress",
  "safety_review_failed",
  "safety_ci_max_retries",
  "cancelled",
]);

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function formatScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return JSON.stringify(value);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("State file missing frontmatter delimiters");
  }

  const fm = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx < 0) {
      throw new Error(`Malformed frontmatter line: ${line}`);
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    fm[key] = parseScalar(value);
  }
  return { frontmatter: fm, body: match[2] || "" };
}

function serializeFrontmatter(obj, body = "") {
  const lines = ["---"];
  for (const [key, value] of Object.entries(obj)) {
    lines.push(`${key}: ${formatScalar(value)}`);
  }
  lines.push("---");
  if (body && body.length > 0) {
    lines.push(body.replace(/^\n+/, ""));
  }
  return `${lines.join("\n")}\n`;
}

function readStateFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseFrontmatter(content);
}

function writeStateFile(filePath, state, body = "# Chisel Loop State\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeFrontmatter(state, body), "utf8");
}

function getImmediateGitRoot(cwd) {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function getParentSuperproject(cwd) {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-superproject-working-tree"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout && result.stdout.trim()) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function getGitHierarchy(cwd) {
  const roots = [];
  let dir = cwd;
  let depth = 0;

  while (depth < 20) {
    const root = getImmediateGitRoot(dir);
    if (!root) break;
    roots.push(root);
    const parent = getParentSuperproject(root);
    if (!parent || parent === root) break;
    dir = parent;
    depth += 1;
  }

  if (roots.length === 0) {
    roots.push(cwd);
  }
  return roots;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || ""));
}

function findStateFile(cwd) {
  const roots = getGitHierarchy(cwd);
  const checkedPaths = [];
  let parseErrorPath = null;
  let parseError = null;
  let firstExistingPath = null;
  let firstExistingState = null;

  for (const root of roots) {
    const statePath = path.join(root, STATE_REL_PATH);
    checkedPaths.push(statePath);
    if (!fs.existsSync(statePath)) continue;

    try {
      const parsed = readStateFile(statePath);
      if (!firstExistingPath) {
        firstExistingPath = statePath;
        firstExistingState = parsed.frontmatter;
      }
      if (parsed.frontmatter.active === true) {
        return {
          mode: "active",
          statePath,
          state: parsed.frontmatter,
          body: parsed.body,
          checkedPaths,
          roots,
        };
      }
    } catch (err) {
      if (!parseErrorPath) {
        parseErrorPath = statePath;
        parseError = err;
      }
    }
  }

  if (parseErrorPath) {
    return {
      mode: "parse_error",
      statePath: parseErrorPath,
      error: parseError,
      checkedPaths,
      roots,
    };
  }

  if (firstExistingPath) {
    return {
      mode: "inactive",
      statePath: firstExistingPath,
      state: firstExistingState,
      checkedPaths,
      roots,
    };
  }

  return {
    mode: "missing",
    statePath: path.join(roots[0], STATE_REL_PATH),
    checkedPaths,
    roots,
  };
}

function appendRunHistory(statePath, state, eventName, sessionId) {
  const stateDir = path.dirname(statePath);
  const runsDir = path.join(stateDir, "chisel", "runs");
  fs.mkdirSync(runsDir, { recursive: true });

  const pr = state.pr_number ? String(state.pr_number) : "unknown";
  const historyPath = path.join(runsDir, `${pr}.json`);
  let data = {
    repo: state.repo || null,
    pr_number: state.pr_number || null,
    events: [],
  };

  if (fs.existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        data = {
          repo: parsed.repo || data.repo,
          pr_number: parsed.pr_number || data.pr_number,
          events: Array.isArray(parsed.events) ? parsed.events : [],
        };
      }
    } catch {
      // Keep fresh default when file is corrupt.
    }
  }

  data.events.push({
    event: eventName,
    session_id: sessionId || null,
    at: new Date().toISOString(),
    status: state.status || null,
    iteration: state.iteration ?? null,
    max_iterations: state.max_iterations ?? null,
    latest_score: state.latest_score ?? null,
    unresolved_count: Array.isArray(state.unresolved_ids) ? state.unresolved_ids.length : null,
    unresolved_ids: Array.isArray(state.unresolved_ids) ? state.unresolved_ids : [],
    ci_status: state.ci_status || null,
    ci_failures: Array.isArray(state.ci_failures) ? state.ci_failures : [],
  });

  fs.writeFileSync(historyPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return historyPath;
}

module.exports = {
  STATE_REL_PATH,
  isTerminalStatus,
  parseFrontmatter,
  readStateFile,
  writeStateFile,
  findStateFile,
  appendRunHistory,
};
