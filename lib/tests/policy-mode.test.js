import assert from "assert/strict";
import test from "node:test";
import { buildAllowlistRule, compileAllowlistRules } from "../allowlist.js";
import { defaultPolicyRules, evaluatePolicy } from "../policy-engine.js";
import { inspectShellCommand } from "../policy.js";

test("allows scoped deletes like rm -rf ./build", () => {
  const result = evaluatePolicy(
    "shell_execute",
    { command: "rm -rf ./build" },
    defaultPolicyRules,
    { mode: "enforce" },
  );

  assert.equal(result.status, "allowed");
});

test("blocks dangerous root deletes like rm -rf /", () => {
  const result = evaluatePolicy(
    "shell_execute",
    { command: "rm -rf /" },
    defaultPolicyRules,
    { mode: "enforce" },
  );

  assert.equal(result.status, "blocked");
});

test("allowlisted commands stay allowed even if they match a block rule", () => {
  const allowlistRules = compileAllowlistRules([
    buildAllowlistRule("shell_execute", "^rm\\s+-rf\\s+/$"),
  ]);

  const result = evaluatePolicy(
    "shell_execute",
    { command: "rm -rf /" },
    defaultPolicyRules,
    { mode: "enforce", allowlistRules },
  );

  assert.equal(result.status, "allowed");
  assert.equal(result.reason, "allowlisted");
});

test("audit mode returns would_block instead of blocked", () => {
  const result = evaluatePolicy(
    "shell_execute",
    { command: "rm -rf /" },
    defaultPolicyRules,
    { mode: "audit" },
  );

  assert.equal(result.status, "would_block");
});

test("shell inspection respects the safer path-scoped delete rule", () => {
  const safeResult = inspectShellCommand("rm -rf ./build");
  const dangerousResult = inspectShellCommand("rm -rf /");

  assert.equal(safeResult.blocked, false);
  assert.equal(dangerousResult.blocked, true);
});
