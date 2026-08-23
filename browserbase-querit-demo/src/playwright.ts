import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type {
  BrowserConnection,
  BrowserConnector,
  BrowserPage,
  NavigationOptions,
  ScreenshotOptions,
} from "./types.js";

const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

export interface PlaywrightBrowserConnectorOptions {
  connectionTimeoutMs?: number;
}

export class PlaywrightBrowserConnector implements BrowserConnector {
  private readonly connectionTimeoutMs: number;

  constructor(options: PlaywrightBrowserConnectorOptions = {}) {
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
  }

  async connect(connectUrl: string): Promise<BrowserConnection> {
    const browser = await chromium.connectOverCDP(connectUrl, {
      timeout: this.connectionTimeoutMs,
    });

    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("Browserbase session has no default browser context.");
      const page = context.pages()[0] ?? await context.newPage();
      return new PlaywrightConnection(browser, page);
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}

class PlaywrightConnection implements BrowserConnection {
  private readonly browser: Browser;
  private readonly browserPage: BrowserPage;

  constructor(browser: Browser, page: Page) {
    this.browser = browser;
    this.browserPage = new PlaywrightPage(page);
  }

  async close(): Promise<void> {
    await this.browser.close({ reason: "Browserbase Querit demo complete" });
  }

  async page(): Promise<BrowserPage> {
    return this.browserPage;
  }
}

class PlaywrightPage implements BrowserPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async close(): Promise<void> {
    await this.page.close();
  }

  async goto(url: string, options: NavigationOptions): Promise<void> {
    await this.page.goto(url, options);
  }

  async screenshot(options: ScreenshotOptions): Promise<void> {
    await this.page.screenshot(options);
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  url(): string {
    return this.page.url();
  }
}
