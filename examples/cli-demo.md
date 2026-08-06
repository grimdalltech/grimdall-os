# Grimdall CLI example

Set up a project with `npx grimdall init`:

```bash
cd my-agent-project
npx grimdall init
```

Non-interactive setup:

```bash
npx grimdall init --yes --stack node,langgraph --endpoint https://your-endpoint/api/execute
```

What gets written:

- `grimdall.config.json` — starter policy rules (destructive shell, SQL, refund limits, production deploys).
- `grimdall-examples/` — wrapper code for Node, Python, LangGraph, and Claude Code.
- `.env.grimdall.example` — environment variable template.
- `GRIMDALL_SETUP.md` — setup guide for your project.

Then wrap your dangerous tools with the generated wrappers. The CLI requires
`GRIMDALL_ENDPOINT` (or `--endpoint`) — point it at your own policy service or
use the `lib/` engine directly.
