import { BrowserbaseSessionAdapter } from "./browserbase.js";
import { PlaywrightBrowserConnector } from "./playwright.js";
import { QueritSearchAdapter } from "./querit.js";
import type { DemoAdapters } from "./types.js";

export interface LiveAdapterOptions {
  browserbaseApiKey: string;
  queritApiKey: string;
}

export function createLiveAdapters(options: LiveAdapterOptions): DemoAdapters {
  return {
    search: new QueritSearchAdapter({ apiKey: options.queritApiKey }),
    browserbase: new BrowserbaseSessionAdapter({ apiKey: options.browserbaseApiKey }),
    browser: new PlaywrightBrowserConnector(),
  };
}
