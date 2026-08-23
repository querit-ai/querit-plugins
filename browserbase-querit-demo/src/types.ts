export interface SearchCandidate {
  title: string;
  url: string;
  snippet: string;
  passages: readonly string[];
  siteName?: string;
  publishedAt?: string;
}

export interface SearchResponse {
  query: string;
  results: readonly SearchCandidate[];
  searchId?: string;
}

export interface SearchAdapter {
  search(query: string): Promise<SearchResponse>;
}

export interface BrowserSession {
  id: string;
  connectUrl: string;
}

export interface BrowserbaseAdapter {
  createSession(): Promise<BrowserSession>;
  releaseSession(sessionId: string): Promise<void>;
}

export interface NavigationOptions {
  timeout: number;
  waitUntil: "domcontentloaded";
}

export interface ScreenshotOptions {
  fullPage: boolean;
  path: string;
}

export interface BrowserPage {
  close(): Promise<void>;
  goto(url: string, options: NavigationOptions): Promise<void>;
  screenshot(options: ScreenshotOptions): Promise<void>;
  title(): Promise<string>;
  url(): string;
}

export interface BrowserConnection {
  close(): Promise<void>;
  page(): Promise<BrowserPage>;
}

export interface BrowserConnector {
  connect(connectUrl: string): Promise<BrowserConnection>;
}

export interface DemoAdapters {
  browserbase: BrowserbaseAdapter;
  browser: BrowserConnector;
  search: SearchAdapter;
}

export interface DemoOptions {
  artifactPath?: string;
  navigationTimeoutMs?: number;
  query: string;
}

export interface CitationEvidence {
  passages: string[];
  provider: "Querit";
  publishedAt?: string;
  rank: number;
  searchId: string | null;
  siteName?: string;
  snippet: string;
  title: string;
  url: string;
}

export interface BrowserEvidence {
  finalUrl: string;
  inspectorUrl: string;
  provider: "Browserbase";
  screenshotPath: string;
  sessionId: string;
  title: string;
}

export interface DemoSummary {
  browserEvidence: BrowserEvidence;
  citation: CitationEvidence;
  query: string;
}
