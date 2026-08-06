export interface GrimdallConfig {
  mode: "audit" | "enforce";
  allowlist: Array<{
    tool?: string;
    pattern: string | RegExp;
  }>;
  configPath: string | null;
}

export function loadGrimdallConfig(): GrimdallConfig;
export function getGrimdallMode(): "audit" | "enforce";
export function saveGrimdallConfig(patch: {
  mode: "audit" | "enforce";
}): GrimdallConfig;
