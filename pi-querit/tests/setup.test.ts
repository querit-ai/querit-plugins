import { describe, expect, it, vi } from "vitest";
import {
  maskApiKeyHint,
  promptForApiKey,
  promptForSearchDefaults,
  promptForSetupMode,
  promptForSummarySettings,
} from "../src/setup.js";

describe("masked setup prompt", () => {
  it("does not render the API key and returns it only on submit", async () => {
    const secret = "test-secret-key";
    let rendered = "";

    const ctx = {
      mode: "tui",
      ui: {
        notify: vi.fn(),
        custom: vi.fn(async (factory: any) => {
          return new Promise<string | undefined>((resolve) => {
            const component = factory(
              { requestRender: vi.fn() },
              {
                fg: (_color: string, text: string) => text,
                bold: (text: string) => text,
              },
              {},
              resolve,
            );
            component.focused = true;
            component.handleInput(secret);
            rendered = component.render(100).join("\n");
            component.handleInput("\n");
          });
        }),
      },
    };

    await expect(promptForApiKey(ctx as any)).resolves.toBe(secret);
    expect(rendered).not.toContain(secret);
    expect(rendered).toContain("*".repeat(secret.length));
  });

  it("selects a fixed summary model from Pi models with the active model first", async () => {
    const currentModel = { provider: "openai", id: "current" };
    const scopedModel = { provider: "anthropic", id: "scoped" };
    const select = vi.fn().mockResolvedValueOnce("Auto-summary before returning results");
    let rendered = "";
    const custom = vi.fn(async (factory: any) => {
      return new Promise<string | undefined>((resolve) => {
        const component = factory(
          { requestRender: vi.fn() },
          {
            fg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          resolve,
        );
        component.focused = true;
        rendered = component.render(120).join("\n");
        component.handleInput("\n");
      });
    });
    const ctx = {
      mode: "tui",
      model: currentModel,
      scopedModels: [{ model: scopedModel }],
      modelRegistry: { getAvailable: vi.fn(() => []), find: vi.fn(() => undefined) },
      ui: { select, custom, notify: vi.fn() },
    };

    await expect(promptForSummarySettings(ctx as any)).resolves.toEqual({
      defaultWorkflow: "summary",
      summaryModel: "openai/current",
    });
    expect(rendered.indexOf("openai/current")).toBeGreaterThanOrEqual(0);
    expect(rendered.indexOf("openai/current")).toBeLessThan(rendered.indexOf("anthropic/scoped"));
  });

  it("prompts for a per-model thinking intensity after picking the summary model", async () => {
    const thinkingModel = {
      provider: "qwen",
      id: "thinking-model",
      reasoning: true,
      thinkingLevelMap: { low: "low", medium: "medium", xhigh: "xhigh" },
    };
    const select = vi.fn()
      .mockResolvedValueOnce("Auto-summary before returning results")
      .mockResolvedValueOnce("medium (recommended)");
    const custom = vi.fn(async (factory: any) => {
      return new Promise<string | undefined>((resolve) => {
        const component = factory(
          { requestRender: vi.fn() },
          {
            fg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          resolve,
        );
        component.focused = true;
        component.handleInput("\n");
      });
    });
    const ctx = {
      mode: "tui",
      model: thinkingModel,
      scopedModels: [],
      modelRegistry: { getAvailable: vi.fn(() => []), find: vi.fn(() => thinkingModel) },
      ui: { select, custom, notify: vi.fn() },
    };

    await expect(promptForSummarySettings(ctx as any)).resolves.toEqual({
      defaultWorkflow: "summary",
      summaryModel: "qwen/thinking-model",
      summaryThinkingLevel: "medium",
    });
    expect(select.mock.calls[1]![0]).toContain("Thinking intensity");
  });

  it("refuses non-interactive setup", async () => {
    const notify = vi.fn();
    const ctx = { mode: "print", ui: { notify } };
    await expect(promptForApiKey(ctx as any)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("interactive TUI"), "error");
  });
});

describe("setup mode menu", () => {
  it("offers replace, search defaults, and summary settings when a key exists", async () => {
    const select = vi.fn().mockResolvedValue("Change search defaults");
    const ctx = { mode: "tui", ui: { select, notify: vi.fn() } };

    await expect(promptForSetupMode(ctx as any, { apiKey: "super-secret-key" })).resolves.toBe("search-defaults");
    expect(select.mock.calls[0][0]).toContain("…-key");
    expect(select.mock.calls[0][0]).not.toContain("super-secret-key");
  });

  it("returns undefined when the menu is dismissed", async () => {
    const ctx = { mode: "tui", ui: { select: vi.fn().mockResolvedValue(undefined), notify: vi.fn() } };
    await expect(promptForSetupMode(ctx as any, { apiKey: "key" })).resolves.toBeUndefined();
  });

  it("refuses non-interactive setup mode", async () => {
    const notify = vi.fn();
    const ctx = { mode: "print", ui: { notify } };
    await expect(promptForSetupMode(ctx as any, { apiKey: "key" })).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("interactive TUI"), "error");
  });

  it("masks all but the last four key characters", () => {
    expect(maskApiKeyHint("super-secret-key")).toBe("…-key");
    expect(maskApiKeyHint("abc")).toBe("****");
  });
});

describe("search defaults prompts", () => {
  function defaultsContext(select: any, custom: any, notify = vi.fn()) {
    return { mode: "tui", ui: { select, custom, notify } };
  }

  it("collects search defaults and skips untouched items", async () => {
    const select = vi.fn()
      .mockResolvedValueOnce("10")
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Yes, include excerpts")
      .mockResolvedValueOnce("Enter a custom list…")
      .mockResolvedValueOnce("Reset (no domain filter)");
    const custom = vi.fn()
      .mockResolvedValueOnce("United States")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("github.com, Wikipedia.org");

    const result = await promptForSearchDefaults(
      defaultsContext(select, custom) as any,
      { excludeDomains: ["old.example"] },
    );
    expect(result).toEqual({
      count: 10,
      includeContent: true,
      countries: ["united states"],
      includeDomains: ["github.com", "wikipedia.org"],
    });
  });

  it("applies the noise blocker preset to the exclude list", async () => {
    const select = vi.fn()
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Skip (no domain filter)")
      .mockResolvedValueOnce("Noise blockers (pinterest.com, facebook.com, instagram.com, tiktok.com)");
    const custom = vi.fn().mockResolvedValue("");

    const result = await promptForSearchDefaults(defaultsContext(select, custom) as any);
    expect(result).toEqual({
      excludeDomains: ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"],
    });
  });
  it("keeps or resets current values when editing existing defaults", async () => {
    const select = vi.fn()
      .mockResolvedValueOnce("Keep current (7)")
      .mockResolvedValueOnce("Reset to API default")
      .mockResolvedValueOnce("Keep current (no)")
      .mockResolvedValueOnce("Skip (no domain filter)")
      .mockResolvedValueOnce("Skip (no domain filter)");
    const custom = vi.fn().mockResolvedValue("");

    const result = await promptForSearchDefaults(defaultsContext(select, custom) as any, {
      count: 7,
      timeRange: "d7",
      includeContent: false,
      chunksPerDoc: 2,
      languages: ["english"],
    });
    expect(result).toEqual({
      count: 7,
      includeContent: false,
      chunksPerDoc: 2,
      languages: ["english"],
    });
  });

  it("cancels the whole flow when a prompt is dismissed", async () => {
    const select = vi.fn().mockResolvedValueOnce("10").mockResolvedValueOnce(undefined);
    const result = await promptForSearchDefaults(defaultsContext(select, vi.fn()) as any);
    expect(result).toBeUndefined();
  });

  it("re-prompts when list values are invalid", async () => {
    const select = vi.fn()
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Skip (use API default)")
      .mockResolvedValueOnce("Enter a custom list…")
      .mockResolvedValueOnce("Skip (no domain filter)");
    const custom = vi.fn()
      .mockResolvedValueOnce("atlantis")
      .mockResolvedValueOnce("japan")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("not a domain")
      .mockResolvedValueOnce("");
    const notify = vi.fn();

    const result = await promptForSearchDefaults(defaultsContext(select, custom, notify) as any);
    expect(result).toEqual({ countries: ["japan"] });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Unknown values"), "error");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Invalid domains"), "error");
  });

  it("returns empty defaults without prompting outside the TUI", async () => {
    await expect(promptForSearchDefaults({ mode: "print", ui: {} } as any)).resolves.toEqual({});
  });
});
