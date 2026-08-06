import assert from "assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/grimdall.js", import.meta.url));

function runInit(dir, extraArgs = []) {
  return execFileSync(process.execPath, [BIN, "init", "--yes", "--stack", "node", ...extraArgs], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("grimdall init writes config, wrappers, and setup guide", () => {
  const dir = mkdtempSync(join(tmpdir(), "grimdall-cli-"));

  runInit(dir, ["--endpoint", "https://example.com/api/execute"]);

  for (const file of [
    "grimdall.config.json",
    join("grimdall-examples", "node", "github-tool-wrapper.ts"),
    join("grimdall-examples", "python", "github_tool_wrapper.py"),
    join("grimdall-examples", "langgraph", "grimdall_guard.py"),
    join("grimdall-examples", "claude-code", "grimdall-guard.js"),
    ".env.grimdall.example",
    "GRIMDALL_SETUP.md",
  ]) {
    assert.ok(existsSync(join(dir, file)), `expected ${file} to be written`);
  }

  const config = JSON.parse(readFileSync(join(dir, "grimdall.config.json"), "utf8"));
  assert.equal(config.endpoint, "https://example.com/api/execute");
  assert.ok(Array.isArray(config.policies) && config.policies.length > 0);
});

test("grimdall init --dry-run does not write files", () => {
  const dir = mkdtempSync(join(tmpdir(), "grimdall-cli-dry-"));

  runInit(dir, ["--endpoint", "https://example.com/api/execute", "--dry-run"]);

  assert.ok(!existsSync(join(dir, "grimdall.config.json")));
});
