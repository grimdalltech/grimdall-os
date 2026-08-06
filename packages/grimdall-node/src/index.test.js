import assert from "assert/strict";
import test from "node:test";
import {
  createGrimdall,
  GrimdallPolicyError,
  redactSensitiveArguments,
} from "../src/index.js";

test("requires an endpoint", () => {
  delete process.env.GRIMDALL_ENDPOINT;
  assert.throws(() => createGrimdall(), /endpoint is required/i);
});

test("createGrimdall guards a tool and allows safe calls", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ status: "allowed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const grimdall = createGrimdall({
    endpoint: "https://example.com/api/execute",
    fetch: fetchImpl,
  });

  const wrapped = grimdall.guardTool("run_shell", async ({ command }) => {
    return `ran: ${command}`;
  });

  assert.equal(await wrapped({ command: "ls -la" }), "ran: ls -la");
});

test("assertAllowed throws GrimdallPolicyError when blocked", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ status: "blocked", reason: "Blocked by policy" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const grimdall = createGrimdall({
    endpoint: "https://example.com/api/execute",
    fetch: fetchImpl,
  });

  await assert.rejects(
    () => grimdall.assertAllowed("rm_rf", { command: "rm -rf /" }),
    (error) =>
      error instanceof GrimdallPolicyError &&
      error.result.status === "blocked" &&
      /Blocked by policy/.test(error.message),
  );
});

test("check surfaces non-2xx errors", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  const grimdall = createGrimdall({
    endpoint: "https://example.com/api/execute",
    fetch: fetchImpl,
  });

  await assert.rejects(() => grimdall.check("some_tool"), /bad request/);
});

test("redactSensitiveArguments masks keys and sensitive strings", () => {
  const masked = redactSensitiveArguments({
    apiKey: "sk-abcdefghijklmnopqrstuvwxyz1234567890",
    email: "alice@example.com",
    token: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    safe: "hello world",
    nested: {
      Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      ok: "plain",
    },
    list: ["abc@def.com", "keep"],
  });

  assert.equal(masked.apiKey, "[REDACTED]");
  assert.equal(masked.email, "[REDACTED]");
  assert.equal(masked.token, "[REDACTED]");
  assert.equal(masked.safe, "hello world");
  assert.equal(masked.nested.Authorization, "[REDACTED]");
  assert.equal(masked.nested.ok, "plain");
  assert.deepEqual(masked.list, ["[REDACTED]", "keep"]);
});

test("redactSensitiveArguments handles null and non-objects", () => {
  assert.equal(redactSensitiveArguments(null), null);
  assert.deepEqual(redactSensitiveArguments(undefined), {});
  assert.equal(redactSensitiveArguments(42), 42);
});
