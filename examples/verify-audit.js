// Example 3: Verify a tamper-evident audit chain.
// Run with:  node examples/verify-audit.js
import { verifyAuditChain, buildHash } from "../lib/verify-audit-chain.js";

// Build a small, valid audit chain the same way Grimdall records it.
function makeChain() {
  const entries = [
    { user_id: "u1", tool_name: "shell_execute", status: "allowed", timestamp: "2026-08-06T10:00:00.000Z" },
    { user_id: "u1", tool_name: "shell_execute", status: "blocked", timestamp: "2026-08-06T10:01:00.000Z" },
    { user_id: "u1", tool_name: "database_execute", status: "allowed", timestamp: "2026-08-06T10:02:00.000Z" },
  ];

  let previousHash = "genesis";
  return entries.map((entry, index) => {
    const currentLogHash = buildHash(
      previousHash,
      entry.user_id,
      entry.tool_name,
      entry.status,
      entry.timestamp,
    );
    const log = { ...entry, id: index + 1, previous_log_hash: previousHash, current_log_hash: currentLogHash };
    previousHash = currentLogHash;
    return log;
  });
}

const chain = makeChain();

console.log("Audit chain:", JSON.stringify(chain, null, 2));
console.log("Valid chain verified:", verifyAuditChain(chain));

// Tamper with the middle entry and show the chain no longer verifies.
const tampered = structuredClone(chain);
tampered[1] = { ...tampered[1], status: "allowed" };

console.log("Tampered chain verified:", verifyAuditChain(tampered));
