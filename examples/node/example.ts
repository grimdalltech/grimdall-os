import { createGrimdall } from 'grimdall-node';

const grimdall = createGrimdall({
  workspaceId: 'client-acme-corp',
  agentId: 'example-agent-1',
  slackWebhookUrl: process.env.GRIMDALL_SLACK_WEBHOOK_URL,
});

function runShell(cmd: string): string {
  return `[mock] executed: ${cmd}`;
}

const securedRunShell = grimdall.wrapTool(runShell, 'runShell');

async function main(): Promise<void> {
  const result = securedRunShell('ls -la');
  console.log(result);

  try {
    securedRunShell('rm -rf /');
  } catch (error) {
    console.log((error as Error).message);
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

void main();
