import { describe, expect, it, vi } from "vitest";
import { BrowserbaseSessionAdapter } from "../src/browserbase.js";

describe("BrowserbaseSessionAdapter", () => {
  it("creates a recorded non-keep-alive session and can request release", async () => {
    const create = vi.fn(async (_params?: unknown) => ({
      connectUrl: "wss://connect.browserbase.test/session-token",
      id: "session_123",
    }));
    const update = vi.fn(async (_sessionId: string, _params: unknown) => ({}));
    const adapter = new BrowserbaseSessionAdapter({
      apiKey: "browserbase-key",
      client: { sessions: { create, update } },
    });

    await expect(adapter.createSession()).resolves.toEqual({
      connectUrl: "wss://connect.browserbase.test/session-token",
      id: "session_123",
    });
    expect(create).toHaveBeenCalledWith({
      browserSettings: {
        logSession: true,
        recordSession: true,
      },
      keepAlive: false,
    });

    await adapter.releaseSession("session_123");
    expect(update).toHaveBeenCalledWith("session_123", { status: "REQUEST_RELEASE" });
  });

  it("redacts the Browserbase API key from SDK errors", async () => {
    const apiKey = "browserbase-secret-key";
    const adapter = new BrowserbaseSessionAdapter({
      apiKey,
      client: {
        sessions: {
          create: vi.fn(async () => {
            throw new Error(`unauthorized ${apiKey}`);
          }),
          update: vi.fn(async () => ({})),
        },
      },
    });

    const error = await adapter.createSession().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "BROWSERBASE_API_ERROR",
      message: "Could not create a Browserbase session: unauthorized [REDACTED]",
    });
    expect(String(error)).not.toContain(apiKey);
  });

  it("rejects malformed session connection URLs", async () => {
    const adapter = new BrowserbaseSessionAdapter({
      apiKey: "browserbase-key",
      client: {
        sessions: {
          create: vi.fn(async () => ({ connectUrl: "not-a-url", id: "session_123" })),
          update: vi.fn(async () => ({})),
        },
      },
    });

    await expect(adapter.createSession()).rejects.toThrow("invalid session response");
  });
});
