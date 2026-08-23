import Browserbase from "@browserbasehq/sdk";
import { IntegrationError } from "./errors.js";
import { safeErrorMessage } from "./security.js";
import type { BrowserSession, BrowserbaseAdapter } from "./types.js";

interface BrowserbaseSdkPort {
  sessions: {
    create(
      params?: Browserbase.SessionCreateParams,
    ): PromiseLike<Pick<Browserbase.SessionCreateResponse, "connectUrl" | "id">>;
    update(sessionId: string, params: Browserbase.SessionUpdateParams): PromiseLike<unknown>;
  };
}

export interface BrowserbaseSessionAdapterOptions {
  apiKey: string;
  client?: BrowserbaseSdkPort;
}

export class BrowserbaseApiError extends IntegrationError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super("BROWSERBASE_API_ERROR", message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "BrowserbaseApiError";
  }
}

export class BrowserbaseSessionAdapter implements BrowserbaseAdapter {
  private readonly apiKey: string;
  private readonly client: BrowserbaseSdkPort;

  constructor(options: BrowserbaseSessionAdapterOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new IntegrationError("INVALID_CONFIGURATION", "BROWSERBASE_API_KEY is required.");

    this.apiKey = apiKey;
    this.client = options.client ?? new Browserbase({ apiKey });
  }

  async createSession(): Promise<BrowserSession> {
    try {
      const session = await this.client.sessions.create({
        browserSettings: {
          logSession: true,
          recordSession: true,
        },
        keepAlive: false,
      });

      if (!session.id.trim() || !isCdpUrl(session.connectUrl)) {
        throw new Error("Browserbase returned an invalid session response.");
      }

      return { id: session.id, connectUrl: session.connectUrl };
    } catch (error) {
      throw new BrowserbaseApiError(
        `Could not create a Browserbase session: ${safeErrorMessage(error, [this.apiKey])}`,
        { cause: error },
      );
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
    } catch (error) {
      throw new BrowserbaseApiError(
        `Could not release the Browserbase session: ${safeErrorMessage(error, [this.apiKey])}`,
        { cause: error },
      );
    }
  }
}

export function browserbaseInspectorUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${encodeURIComponent(sessionId)}`;
}

function isCdpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol);
  } catch {
    return false;
  }
}
