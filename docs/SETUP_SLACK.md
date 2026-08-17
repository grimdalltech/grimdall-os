# Slack HITL Setup

This guide sets up Grimdall's Slack human-in-the-loop approval flow with local secret handling.

## 1. Create or verify your Slack app

You already created the Slack app, but these are the values Grimdall needs:

- `SLACK_BOT_TOKEN` - your bot token, usually starts with `xoxb-`
- `SLACK_SIGNING_SECRET` - the signing secret from the app's **Basic Information** page
- `SLACK_CHANNEL_ID` - the channel ID where approval requests should be posted

## 2. Configure local environment variables

Update `.env` in the project root from `.env.example`:

```env
SLACK_BOT_TOKEN=xoxb-YOUR_TOKEN_HERE
SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET_HERE
SLACK_CHANNEL_ID=C0123456789
WEBHOOK_PORT=3001
NODE_ENV=development
```

Never commit real tokens.

## 3. Find the channel ID

In Slack, open the target channel and inspect its details. The channel ID looks like `C0123456789`.

If you need to use a private channel, invite the bot to that channel first.

## 4. Start a local tunnel with ngrok

Slack needs a public HTTPS URL to reach your local webhook server.

1. Start the webhook server locally on port `3001` or whatever `WEBHOOK_PORT` is set to.
2. In another terminal, run ngrok:

```bash
ngrok http 3001
```

3. Copy the HTTPS forwarding URL ngrok gives you, for example:

```text
https://abcd-1234.ngrok-free.app
```

## 5. Configure Slack interactivity

In the Slack app dashboard:

1. Open **Interactivity & Shortcuts**
2. Turn interactivity on
3. Set the **Request URL** to:

```text
https://abcd-1234.ngrok-free.app/slack/interactive
```

Replace the domain with your current ngrok URL.

## 6. Install dependencies and run

From the project root:

```bash
npm install
npm run build
```

If you are running the Node integration directly, make sure the process loads `.env` before starting so the Slack token and signing secret are available.

## 7. What happens at runtime

- Grimdall validates `SLACK_BOT_TOKEN` before sending approval requests.
- The webhook server validates Slack request signatures with `SLACK_SIGNING_SECRET`.
- Approval requests are posted into `SLACK_CHANNEL_ID` with Block Kit buttons.
- Button clicks are resolved back into the pending review queue.

## 8. Troubleshooting

- If approval messages do not post, confirm the bot token and channel ID are set correctly.
- If Slack says the request URL is invalid, make sure ngrok is running and the `/slack/interactive` path is correct.
- If interactive actions return `401`, verify the signing secret and request URL.
- If the webhook server does not start, check `WEBHOOK_PORT` and that no other process is using it.
