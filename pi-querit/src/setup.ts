import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { DynamicBorder, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  SelectList,
  Spacer,
  Text,
  fuzzyFilter,
  getKeybindings,
  type Component,
  type Focusable,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  COUNTRY_VALUES,
  LANGUAGE_VALUES,
  type QueritConfig,
  type QueritCountry,
  type QueritLanguage,
  type QueritSearchDefaults,
  type QueritThinkingLevel,
  type SearchWorkflow,
} from "./config.js";

/**
 * Masks the API key during rendering by temporarily swapping the Input value
 * with asterisks. Safe because pi-tui's Input.setValue is a pure field
 * assignment (no callbacks) and Input.render is a pure computation.
 */
class MaskedInput extends Input {
  override render(width: number): string[] {
    const secret = this.getValue();
    this.setValue("*".repeat(secret.length));
    try {
      return super.render(width);
    } finally {
      this.setValue(secret);
    }
  }
}

export async function promptForApiKey(ctx: ExtensionCommandContext): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/querit-setup requires Pi's interactive TUI.", "error");
    return undefined;
  }

  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    const input = new MaskedInput();
    input.onSubmit = (value) => done(value.trim() || undefined);
    input.onEscape = () => done(undefined);

    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("accent", theme.bold("Configure Querit")), 1, 0));
    container.addChild(new Text("Enter your Querit API key. Input is masked and is not added to chat history.", 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(input);
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", "Enter to validate and continue • Esc to cancel"), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return new FocusableContainer(container, input, tui);
  });
}

export interface SummarySetupSelection {
  defaultWorkflow: SearchWorkflow;
  summaryModel?: string;
  summaryThinkingLevel?: QueritThinkingLevel;
}

export async function promptForSummarySettings(
  ctx: ExtensionCommandContext,
): Promise<SummarySetupSelection | undefined> {
  if (ctx.mode !== "tui") return { defaultWorkflow: "raw" };

  const workflowChoice = await ctx.ui.select("Default Querit search workflow", [
    "Raw results (recommended)",
    "Auto-summary before returning results",
  ]);
  if (!workflowChoice) return undefined;
  const defaultWorkflow: SearchWorkflow = workflowChoice.startsWith("Auto-summary") ? "summary" : "raw";

  if (defaultWorkflow === "raw") return { defaultWorkflow: "raw" };

  const availableModels = ctx.scopedModels.length > 0
    ? ctx.scopedModels.map((entry) => entry.model)
    : ctx.modelRegistry.getAvailable();
  const modelReferences = new Set<string>();
  if (ctx.model) modelReferences.add(`${ctx.model.provider}/${ctx.model.id}`);
  for (const model of availableModels) modelReferences.add(`${model.provider}/${model.id}`);

  if (modelReferences.size === 0) {
    ctx.ui.notify("No Pi model is currently available for Querit summaries. Raw mode will still work.", "warning");
    return { defaultWorkflow: "raw" };
  }

  const summaryModel = await promptForModelPicker(
    ctx,
    "Fixed model for optional Querit summaries",
    [...modelReferences],
  );
  if (!summaryModel) return undefined;

  const thinkingLevel = await promptForSummaryThinkingLevel(ctx, summaryModel);
  if (thinkingLevel.cancelled) return undefined;
  return {
    defaultWorkflow,
    summaryModel,
    ...(thinkingLevel.level === undefined ? {} : { summaryThinkingLevel: thinkingLevel.level }),
  };
}

interface ThinkingLevelPromptResult {
  cancelled: boolean;
  level?: QueritThinkingLevel;
}

async function promptForSummaryThinkingLevel(
  ctx: ExtensionCommandContext,
  modelReference: string,
): Promise<ThinkingLevelPromptResult> {
  const slash = modelReference.indexOf("/");
  const model = ctx.modelRegistry.find(modelReference.slice(0, slash), modelReference.slice(slash + 1));
  if (!model || !model.reasoning) return { cancelled: false };

  const levels = getSupportedThinkingLevels(model);
  if (levels.length === 0) return { cancelled: false };
  const recommended = levels.includes("medium") ? "medium" : levels.find((level) => level !== "off") ?? "off";
  const options = levels.map((level) => (level === recommended ? `${level} (recommended)` : level));

  const choice = await ctx.ui.select(`Thinking intensity for ${modelReference} summaries`, options);
  if (choice === undefined) return { cancelled: true };
  const level = levels.find(
    (candidate) => (candidate === recommended ? `${candidate} (recommended)` : candidate) === choice,
  );
  return level === undefined ? { cancelled: false } : { cancelled: false, level: level as QueritThinkingLevel };
}

const MODEL_PICKER_VISIBLE_ROWS = 5;

function promptForModelPicker(
  ctx: ExtensionCommandContext,
  title: string,
  models: string[],
): Promise<string | undefined> {
  const items: SelectItem[] = models.map((value) => ({ value, label: value }));
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const listTheme: SelectListTheme = {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", theme.bold(text)),
      description: (text) => theme.fg("dim", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("dim", text),
    };
    const header: Component[] = [
      new DynamicBorder((text: string) => theme.fg("accent", text)),
      new Spacer(1),
      new Text(theme.fg("accent", theme.bold(title)), 1, 0),
      new Text(theme.fg("dim", "Type to filter • Up/Down to move • Enter to select • Esc to cancel"), 1, 0),
      new Spacer(1),
    ];
    const footer: Component[] = [
      new Spacer(1),
      new DynamicBorder((text: string) => theme.fg("accent", text)),
    ];
    return new ModelPicker(items, listTheme, header, footer, tui, (value) => done(value), () => done(undefined));
  });
}

class ModelPicker implements Focusable {
  private _focused = false;
  private list: SelectList;
  private readonly input = new Input();

  constructor(
    private readonly items: SelectItem[],
    private readonly listTheme: SelectListTheme,
    private readonly header: Component[],
    private readonly footer: Component[],
    private readonly tui: TUI,
    private readonly onSelect: (value: string) => void,
    private readonly onCancel: () => void,
  ) {
    this.list = this.buildList("");
  }

  private buildList(filter: string): SelectList {
    const query = filter.trim();
    const filtered = query ? fuzzyFilter(this.items, query, (item) => item.value) : this.items;
    const list = new SelectList(filtered, MODEL_PICKER_VISIBLE_ROWS, this.listTheme);
    list.onSelect = (item) => this.onSelect(item.value);
    list.onCancel = () => this.onCancel();
    return list;
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const component of this.header) lines.push(...component.render(width));
    lines.push(...this.input.render(width));
    lines.push(...this.list.render(width));
    for (const component of this.footer) lines.push(...component.render(width));
    return lines;
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (
      keybindings.matches(data, "tui.select.up") ||
      keybindings.matches(data, "tui.select.down") ||
      keybindings.matches(data, "tui.select.confirm") ||
      keybindings.matches(data, "tui.select.cancel")
    ) {
      this.list.handleInput(data);
    } else {
      this.input.handleInput(data);
      this.list = this.buildList(this.input.getValue());
    }
    this.tui.requestRender();
  }

  invalidate(): void {
    this.input.invalidate();
    this.list.invalidate();
    for (const component of [...this.header, ...this.footer]) component.invalidate();
  }
}

export type SetupMode = "replace-key" | "search-defaults" | "summary-settings";

export function maskApiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length <= 4 ? "****" : `…${trimmed.slice(-4)}`;
}

export async function promptForSetupMode(
  ctx: ExtensionCommandContext,
  config: QueritConfig,
): Promise<SetupMode | undefined> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/querit-setup requires Pi's interactive TUI.", "error");
    return undefined;
  }

  const choice = await ctx.ui.select(
    `Querit is already configured (API key ${maskApiKeyHint(config.apiKey)}). What would you like to change?`,
    [
      "Replace API key (full re-setup)",
      "Change search defaults",
      "Change summary settings",
    ],
  );
  if (!choice) return undefined;
  if (choice.startsWith("Replace")) return "replace-key";
  if (choice.startsWith("Change search")) return "search-defaults";
  return "summary-settings";
}

export async function promptForSearchDefaults(
  ctx: ExtensionCommandContext,
  current: QueritSearchDefaults = {},
): Promise<QueritSearchDefaults | undefined> {
  if (ctx.mode !== "tui") return {};

  const next: QueritSearchDefaults = { ...current };

  const countChoice = await ctx.ui.select(
    "Default result count per search",
    scalarOptions(current.count === undefined ? undefined : String(current.count), ["3", "5", "10", "20"]),
  );
  if (countChoice === undefined) return undefined;
  if (isResetChoice(countChoice)) delete next.count;
  else if (!isKeepChoice(countChoice)) {
    const parsed = Number.parseInt(countChoice, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20) next.count = parsed;
  }

  const timeChoice = await ctx.ui.select(
    "Default time range filter",
    scalarOptions(current.timeRange, [
      "d7 (past 7 days)",
      "w2 (past 2 weeks)",
      "m3 (past 3 months)",
      "y1 (past year)",
    ]),
  );
  if (timeChoice === undefined) return undefined;
  if (isResetChoice(timeChoice)) delete next.timeRange;
  else if (!isKeepChoice(timeChoice)) next.timeRange = timeChoice.split(" ", 1)[0];

  const contentChoice = await ctx.ui.select(
    "Include sentence-level content excerpts by default?",
    scalarOptions(
      current.includeContent === undefined ? undefined : current.includeContent ? "yes" : "no",
      ["Yes, include excerpts", "No, snippets only"],
    ),
  );
  if (contentChoice === undefined) return undefined;
  if (isResetChoice(contentChoice)) delete next.includeContent;
  else if (!isKeepChoice(contentChoice)) next.includeContent = contentChoice.startsWith("Yes");

  const countries = await promptForEnumList(ctx, {
    title: `Default countries filter${formatCurrentList(current.countries)}`,
    hint: `Comma-separated country names. Valid values: ${COUNTRY_VALUES.join(", ")}.`,
    allowed: COUNTRY_VALUES,
  });
  if (countries === undefined) return undefined;
  if (countries.cleared) delete next.countries;
  else if (countries.values !== undefined) next.countries = countries.values as QueritCountry[];

  const languages = await promptForEnumList(ctx, {
    title: `Default languages filter${formatCurrentList(current.languages)}`,
    hint: `Comma-separated language names. Valid values: ${LANGUAGE_VALUES.join(", ")}.`,
    allowed: LANGUAGE_VALUES,
  });
  if (languages === undefined) return undefined;
  if (languages.cleared) delete next.languages;
  else if (languages.values !== undefined) next.languages = languages.values as QueritLanguage[];

  const includeDomains = await promptForDomainChoice(ctx, {
    message: "Restrict results to specific domains? (include whitelist)",
    current: current.includeDomains,
    customTitle: "Include only these domains (whitelist)",
    customHint: "Only these domains will return results. Example: github.com, stackoverflow.com, developer.mozilla.org. Comma-separated; 'none' clears.",
  });
  if (includeDomains === undefined) return undefined;
  if (includeDomains.cleared) delete next.includeDomains;
  else if (includeDomains.values !== undefined) next.includeDomains = includeDomains.values;
  const excludeDomains = await promptForDomainChoice(ctx, {
    message: "Exclude specific domains from results? (blacklist)",
    current: current.excludeDomains,
    preset: EXCLUDE_DOMAIN_PRESET,
    customTitle: "Exclude these domains (blacklist)",
    customHint: "These domains will never return results. Comma-separated; 'none' clears.",
  });
  if (excludeDomains === undefined) return undefined;
  if (excludeDomains.cleared) delete next.excludeDomains;
  else if (excludeDomains.values !== undefined) next.excludeDomains = excludeDomains.values;

  return next;
}

const EXCLUDE_DOMAIN_PRESET = {
  label: "Noise blockers (pinterest.com, facebook.com, instagram.com, tiktok.com)",
  values: ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"],
};

interface ListPromptResult {
  cleared: boolean;
  values?: string[];
}

async function promptForEnumList(
  ctx: ExtensionCommandContext,
  options: { title: string; hint: string; allowed: readonly string[] },
): Promise<ListPromptResult | undefined> {
  for (;;) {
    const raw = await promptForPlainText(ctx, options.title, options.hint);
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === "") return { cleared: false };
    if (trimmed.toLowerCase() === "none") return { cleared: true };
    const values = splitList(trimmed);
    const invalid = values.filter((value) => !options.allowed.includes(value));
    if (invalid.length > 0) {
      ctx.ui.notify(`Unknown values: ${invalid.join(", ")}. ${options.hint}`, "error");
      continue;
    }
    return { cleared: false, values: [...new Set(values)] };
  }
}

async function promptForDomainList(
  ctx: ExtensionCommandContext,
  options: { title: string; hint: string },
): Promise<ListPromptResult | undefined> {
  for (;;) {
    const raw = await promptForPlainText(ctx, options.title, options.hint);
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === "") return { cleared: false };
    if (trimmed.toLowerCase() === "none") return { cleared: true };
    const values = splitList(trimmed);
    const invalid = values.filter((value) => value.length > 253 || /\s/u.test(value) || !value.includes("."));
    if (invalid.length > 0) {
      ctx.ui.notify(`Invalid domains: ${invalid.join(", ")}. ${options.hint}`, "error");
      continue;
    }
    return { cleared: false, values: [...new Set(values)] };
  }
}

async function promptForDomainChoice(
  ctx: ExtensionCommandContext,
  options: {
    message: string;
    current: string[] | undefined;
    preset?: { label: string; values: string[] };
    customTitle: string;
    customHint: string;
  },
): Promise<ListPromptResult | undefined> {
  const hasCurrent = options.current !== undefined && options.current.length > 0;
  const selectOptions: string[] = [];
  if (hasCurrent) {
    selectOptions.push(`Keep current (${options.current?.join(", ")})`);
    selectOptions.push("Reset (no domain filter)");
  } else {
    selectOptions.push("Skip (no domain filter)");
  }
  if (options.preset) selectOptions.push(options.preset.label);
  selectOptions.push("Enter a custom list…");

  const choice = await ctx.ui.select(options.message, selectOptions);
  if (choice === undefined) return undefined;
  if (isKeepChoice(choice)) return { cleared: false };
  if (isResetChoice(choice)) return { cleared: true };
  if (options.preset && choice === options.preset.label) {
    return { cleared: false, values: [...options.preset.values] };
  }
  return promptForDomainList(ctx, { title: options.customTitle, hint: options.customHint });
}
async function promptForPlainText(
  ctx: ExtensionCommandContext,
  title: string,
  hint: string,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    const input = new Input();
    input.onSubmit = (value) => done(value);
    input.onEscape = () => done(undefined);

    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    container.addChild(new Text(hint, 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(input);
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", "Enter = keep • 'none' = clear • Esc = cancel setup"), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return new FocusableContainer(container, input, tui);
  });
}

function scalarOptions(currentLabel: string | undefined, values: string[]): string[] {
  if (currentLabel === undefined) return ["Skip (use API default)", ...values];
  return [`Keep current (${currentLabel})`, "Reset to API default", ...values];
}

function isKeepChoice(choice: string): boolean {
  return choice.startsWith("Keep current");
}

function isResetChoice(choice: string): boolean {
  return choice.startsWith("Reset") || choice.startsWith("Skip");
}

function formatCurrentList(values: string[] | undefined): string {
  return values === undefined || values.length === 0 ? "" : ` (current: ${values.join(", ")})`;
}

function splitList(value: string): string[] {
  return value.split(",").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
}
class FocusableContainer implements Focusable {
  private _focused = false;

  constructor(
    private readonly container: Container,
    private readonly input: Input,
    private readonly tui: TUI,
  ) {}

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
    this.tui.requestRender();
  }

  invalidate(): void {
    this.container.invalidate();
  }
}
