const REMEDIATION_RULES = [
  {
    match: /rm\s+-rf/i,
    suggestion:
      "Use 'trash' (recoverable delete) or scope the path: rm -rf ./build/ (never use wildcards or root paths)",
  },
  {
    match: /chmod\s+777/i,
    suggestion:
      "Use 'chmod 755' for directories or 'chmod 644' for files. 777 allows ANY user to write.",
  },
  {
    match: /mkfs|dd\s+if=/i,
    suggestion:
      "This permanently destroys a disk. If you need to format, target a specific partition and confirm with a human first.",
  },
  {
    match: /:\(\)\{\s*:\|:&\s*\};:/i,
    suggestion:
      "This is a fork bomb (denial of service). It has no legitimate use. Remove it entirely.",
  },
  {
    match: /github_delete_repo|delete.*repo/i,
    suggestion:
      "Repository deletion is irreversible. Archive the repository instead, or require human approval via Slack.",
  },
  {
    match: /deploy.*production|production.*deploy/i,
    suggestion:
      "Deploy to a staging environment first, then request human approval for production.",
  },
];

export function suggestRemediation(tool, args = {}) {
  const command = [tool, args.command, args.input, JSON.stringify(args)]
    .filter(Boolean)
    .join(" ");

  for (const rule of REMEDIATION_RULES) {
    if (rule.match.test(command)) {
      return rule.suggestion;
    }
  }

  return "Break this action into smaller, reviewable steps and request human approval for the risky part.";
}

export { REMEDIATION_RULES };
