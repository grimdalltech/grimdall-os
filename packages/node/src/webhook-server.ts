import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import express from 'express';
import type { ReviewManager } from 'grimdall-core';

export interface WebhookServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface SlackInteractiveAction {
  action_id: 'approve_action' | 'deny_action';
  value: string;
  type?: string;
}

export interface SlackInteractivePayload {
  type?: string;
  actions?: [SlackInteractiveAction, ...SlackInteractiveAction[]];
}

export interface SlackInteractiveRequestBody {
  payload?: string;
}

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

export function startWebhookServer(
  reviewManager: ReviewManager,
  port = resolveWebhookPort(),
): WebhookServerHandle {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }

  const app = express();
  app.use(
    express.urlencoded({
      extended: true,
      verify: captureRawBody,
    }),
  );
  app.use(
    express.json({
      verify: captureRawBody,
    }),
  );

  app.post('/slack/interactive', (req: RequestWithRawBody, res: Response) => {
    try {
      if (!verifySlackRequest(req, signingSecret)) {
        res.status(401).send('Invalid Slack signature');
        return;
      }

      const payload = parseInteractivePayload(req.body);
      const action = payload.actions?.[0];
      if (!action) {
        res.status(400).send('Missing Slack action payload');
        return;
      }

      const reviewId = action.value;
      if (!reviewId) {
        res.status(400).send('Missing review id');
        return;
      }

      const decision = action.action_id === 'approve_action' ? 'approve' : 'deny';
      reviewManager.resolveReview(reviewId, decision);

      res.sendStatus(200);
    } catch (error) {
      console.error('Slack webhook error:', error);
      res.status(500).send('Slack webhook error');
    }
  });

  const server: Server = app.listen(port, () => {
    console.log(`Slack webhook server running on port ${port}`);
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

function captureRawBody(
  req: RequestWithRawBody,
  _res: Response,
  buf: Buffer,
  _encoding: string,
): void {
  req.rawBody = buf.toString();
}

function verifySlackRequest(req: RequestWithRawBody, signingSecret: string): boolean {
  const timestamp = req.get('x-slack-request-timestamp');
  const signature = req.get('x-slack-signature');
  if (!timestamp || !signature || !req.rawBody) {
    return false;
  }

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime)) {
    return false;
  }

  const fiveMinutesInSeconds = 60 * 5;
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - requestTime) > fiveMinutesInSeconds) {
    return false;
  }

  const baseString = `v0:${timestamp}:${req.rawBody}`;
  const expectedSignature = `v0=${crypto.createHmac('sha256', signingSecret).update(baseString, 'utf8').digest('hex')}`;
  return safeTimingEqual(expectedSignature, signature);
}

function safeTimingEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function parseInteractivePayload(
  body: SlackInteractiveRequestBody | Record<string, unknown>,
): SlackInteractivePayload {
  const payloadValue = body.payload;
  if (typeof payloadValue !== 'string') {
    throw new Error('Slack interactive payload is missing');
  }

  const parsed = JSON.parse(payloadValue) as SlackInteractivePayload;
  return parsed;
}

function resolveWebhookPort(): number {
  const portValue = process.env.WEBHOOK_PORT;
  if (!portValue) {
    return 3001;
  }

  const parsed = Number(portValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3001;
}
