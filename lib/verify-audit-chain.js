import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { pathToFileURL } from "url";

export function buildHash(previousLogHash, userId, toolName, status, timestamp) {
  return createHash("sha256")
    .update(`${previousLogHash}${userId}${toolName}${status}${timestamp}`)
    .digest("hex");
}

export function verifyAuditChain(logs) {
  if (!Array.isArray(logs)) {
    return false;
  }

  const orderedLogs = [...logs].sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });

  let previousLogHash = "genesis";

  for (const log of orderedLogs) {
    if (
      !log ||
      typeof log.user_id !== "string" ||
      typeof log.tool_name !== "string" ||
      typeof log.status !== "string" ||
      typeof log.timestamp !== "string" ||
      typeof log.previous_log_hash !== "string" ||
      typeof log.current_log_hash !== "string"
    ) {
      return false;
    }

    const expectedHash = buildHash(
      previousLogHash,
      log.user_id,
      log.tool_name,
      log.status,
      log.timestamp,
    );

    if (log.previous_log_hash !== previousLogHash) {
      return false;
    }

    if (log.current_log_hash !== expectedHash) {
      return false;
    }

    previousLogHash = log.current_log_hash;
  }

  return true;
}

export async function verifyAuditLogsFile(inputPath) {
  const raw = await readFile(inputPath, "utf8");
  const logs = JSON.parse(raw);

  if (!Array.isArray(logs)) {
    throw new Error("Audit log file must contain a JSON array of log entries.");
  }

  return verifyAuditChain(logs);
}

export async function exportAuditLogsToFile(logs, outputPath) {
  await writeFile(outputPath, JSON.stringify(logs, null, 2), "utf8");
  return logs;
}

async function main() {
  const inputIndex = process.argv.indexOf("--file");
  const exportIndex = process.argv.indexOf("--export");

  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error(
      "Usage: node lib/verify-audit-chain.js --file <audit-logs.json> [--export <path>]",
    );
  }

  const inputPath = process.argv[inputIndex + 1];
  const exportPath =
    exportIndex !== -1 ? process.argv[exportIndex + 1] : undefined;

  const valid = await verifyAuditLogsFile(inputPath);

  if (exportPath) {
    const raw = await readFile(inputPath, "utf8");
    await exportAuditLogsToFile(JSON.parse(raw), exportPath);
    console.log(`Exported audit logs to ${exportPath}`);
  }

  console.log(valid ? "true" : "false");
  process.exitCode = valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
