// Node SDK example: guard a dangerous tool with Grimdall.
//
// Run with:  GRIMDALL_ENDPOINT=https://your-endpoint/api/execute node examples/node-sdk.js
import { createGrimdall } from "grimdall-node";

const grimdall = createGrimdall({
  endpoint: process.env.GRIMDALL_ENDPOINT,
  apiKey: process.env.GRIMDALL_API_KEY,
});

const protectedDeleteRepo = grimdall.guardTool(
  "github_delete_repo",
  async ({ repoName }) => {
    // Call your real GitHub delete function here after Grimdall allows it.
    return { status: "deleted", repoName };
  }
);

try {
  const result = await protectedDeleteRepo({ repoName: "acme/legacy" });
  console.log("Allowed:", result);
} catch (error) {
  console.error("Blocked:", error instanceof Error ? error.message : error);
}
