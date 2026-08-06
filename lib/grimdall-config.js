import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const DEFAULT_CONFIG = {
  mode: "audit",
  allowlist: [],
};

let cachedConfig = null;

function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("[config] Failed to read Grimdall config:", {
      filePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function findConfigPath() {
  try {
    const candidates = [
      path.resolve(process.cwd(), "grimdall.config.json"),
      path.resolve(process.cwd(), "grimdall", "grimdall.config.json"),
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  } catch {
    // Serverless environments may not expose a writable filesystem.
    return null;
  }
}

export function loadGrimdallConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = findConfigPath();
  const parsed = configPath ? readJsonFile(configPath) : null;

  const envMode =
    typeof process.env.GRIMDALL_MODE === "string"
      ? process.env.GRIMDALL_MODE.toLowerCase()
      : "";

  cachedConfig = {
    ...DEFAULT_CONFIG,
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    mode:
      envMode === "enforce" || envMode === "audit"
        ? envMode
        : parsed && typeof parsed.mode === "string" && parsed.mode.toLowerCase() === "enforce"
          ? "enforce"
          : "audit",
    allowlist: Array.isArray(parsed?.allowlist) ? parsed.allowlist : [],
    configPath,
  };

  return cachedConfig;
}

export function getGrimdallMode() {
  return loadGrimdallConfig().mode;
}

export function saveGrimdallConfig(patch) {
  const configPath =
    findConfigPath() ?? path.resolve(process.cwd(), "grimdall.config.json");
  const existing = readJsonFile(configPath) ?? {};

  const next = {
    ...existing,
    ...patch,
  };

  let persisted = false;

  try {
    writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", "utf8");
    persisted = true;
  } catch (error) {
    // Serverless filesystems are read-only; keep the config in memory.
    console.error(
      "[config] Config file not writable (serverless); keeping config in memory.",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (persisted) {
    cachedConfig = null;
    return loadGrimdallConfig();
  }

  cachedConfig = {
    ...DEFAULT_CONFIG,
    ...next,
    mode:
      typeof next.mode === "string" && next.mode.toLowerCase() === "enforce"
        ? "enforce"
        : "audit",
    allowlist: Array.isArray(next.allowlist) ? next.allowlist : [],
    configPath,
  };

  return cachedConfig;
}
