import assert from "assert/strict";
import test from "node:test";
import { suggestRemediation } from "../remediation-engine.js";

test("suggests a safer alternative for rm -rf", () => {
  const result = suggestRemediation("shell_execute", {
    command: "rm -rf /",
  });

  assert.match(result, /trash/i);
  assert.match(result, /rm -rf \.\/build\//i);
});

test("suggests a safer alternative for chmod 777", () => {
  const result = suggestRemediation("shell_execute", {
    command: "chmod 777 /var/www",
  });

  assert.match(result, /chmod 755/i);
  assert.match(result, /chmod 644/i);
});

test("returns the generic fallback for unknown commands", () => {
  const result = suggestRemediation("shell_execute", {
    command: "echo hello",
  });

  assert.equal(
    result,
    "Break this action into smaller, reviewable steps and request human approval for the risky part.",
  );
});
