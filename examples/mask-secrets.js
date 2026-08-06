// Example 2: Mask secrets before they reach a policy endpoint or log.
// Run with:  node examples/mask-secrets.js
import { redactSensitiveArguments } from "../packages/grimdall-node/src/index.js";

const raw = {
  apiKey: "sk-abcdefghijklmnopqrstuvwxyz1234567890",
  email: "alice@example.com",
  Authorization: "Bearer 0123456789abcdefghijklmnopqrstuvwxyz",
  githubToken: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
  command: "deploy --region us-east-1",
  nested: {
    phone: "+1 (555) 123-4567",
    safe: "plain text",
  },
};

const masked = redactSensitiveArguments(raw);

console.log("Raw arguments:  ", JSON.stringify(raw, null, 2));
console.log("Masked arguments:", JSON.stringify(masked, null, 2));
