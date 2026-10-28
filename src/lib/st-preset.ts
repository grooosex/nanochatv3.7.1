import type { Chat, LlmParams, Settings, StPreset, StPromptItem } from "./types.ts";
import { DEFAULT_LLM_PARAMS } from "./constants.ts";
import { uniqueNumberedName, uid } from "./utils.ts";

const PLACEHOLDER_IDS = new Set([
  "worldInfoBefore",
  "worldInfoAfter",
  "charDescription",
  "charPersonality",
  "scenario",
  "personaDescription",
  "dialogueExamples",
  "chatHistory",
  "charDepthPrompt",
  "personalityFormat",
  "scenarioFormat",
]);

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseItems(raw: unknown): StPromptItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StPromptItem[] = [];
  for (const row of raw) {
    const o = rec(row);
    if (!o || typeof o.id !== "string" || typeof o.name !== "string") continue;
    out.push({
      id: o.id,
      name: o.name,
      content: str(o.content),
      enabled: o.enabled === true,
      place: o.place === "after" ? "after" : "before",
      usable: o.usable !== false,
      ...(typeof o.original === "string" ? { original: o.original } : {}),
    });
  }
  return out;
}

export function parseStPresets(raw: unknown): StPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: StPreset[] = [];
  for (const row of raw) {
    const o = rec(row);
    if (!o) continue;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    const items = parseItems(o.items);
    out.push({
      id: o.id,
      name: o.name,
      systemPrompt: str(o.systemPrompt),
      postHistory: str(o.postHistory),
      params: {
        temperature: num(o.params && rec(o.params)?.temperature),
        topP: num(o.params && rec(o.params)?.topP),
        frequencyPenalty: num(o.params && rec(o.params)?.frequencyPenalty),
        presencePenalty: num(o.params && rec(o.params)?.presencePenalty),
        maxTokens: num(o.params && rec(o.params)?.maxTokens),
      },
      ...(typeof o.legacySystemPrompt === "string" ? { legacySystemPrompt: o.legacySystemPrompt } : {}),
      ...(typeof o.legacyPostHistory === "string" ? { legacyPostHistory: o.legacyPostHistory } : {}),
      ...(items ? { items } : {}),
    });
  }
  return out;
}

function isTextCompletion(raw: Record<string, unknown>) {
  return (
    typeof raw.input_sequence === "string" ||
    typeof raw.output_sequence === "string" ||
    typeof raw.system_prompt === "string" ||
    Array.isArray(raw.seq)
  );
}

function isCharacterCard(raw: Record<string, unknown>) {
  const spec = str(raw.spec);
  return spec.startsWith("chara_card") || Boolean(rec(raw.data)?.character_book) || Boolean(raw.first_mes);
}

type PromptRow = {
  identifier: string;
  name: string;
  content: string;
  marker: boolean;
  role: string;
  injectionPosition: number;
  enabled: boolean;
};

function readPrompt(v: unknown): PromptRow | null {
  const o = rec(v);
  if (!o) return null;
  const identifier = str(o.identifier) || str(o.name) || uid("p_");
  const content = str(o.content) || str(o.prompt);
  return {
    identifier,
    name: str(o.name) || identifier,
    content,
    marker: o.marker === true,
    role: str(o.role).toLowerCase() || "system",
    injectionPosition: num(o.injection_position) ?? 0,
    enabled: o.enabled !== false,
  };
}

function pickOrder(raw: Record<string, unknown>): { identifier: string; enabled: boolean }[] {
  const orders = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
  let global: { identifier: string; enabled: boolean }[] | null = null;
  let best: { identifier: string; enabled: boolean }[] = [];
  for (const entry of orders) {
    const o = rec(entry);
    if (!o || !Array.isArray(o.order)) continue;
    const rows = o.order
      .map((row) => {
        const r = rec(row);
        if (!r) return null;
        const identifier = str(r.identifier);
        if (!identifier) return null;
        return { identifier, enabled: r.enabled !== false };
      })
      .filter((row): row is { identifier: string; enabled: boolean } => Boolean(row));
    if (o.character_id === 100000 || o.character_id === "100000") global = rows;
    if (rows.length > best.length) best = rows;
  }
  if (global && global.length) return global;
  return best;
}

function isHistoryMarker(p: PromptRow) {
  return p.identifier === "chatHistory" || p.name.trim().toLowerCase() === "chat history";
}

function isSlot(p: PromptRow) {
  if (p.marker) return true;
  if (PLACEHOLDER_IDS.has(p.identifier)) return true;
  return false;
}

function asksForTool(p: PromptRow) {
  if (/game_content/i.test(p.content)) return true;
  if (/function\s*call|tool_call/i.test(p.content)) return true;
  return /调用[\s\S]{0,24}(函数|工具)/.test(p.content);
}

function isUnusable(p: PromptRow) {
  if (isSlot(p)) return true;
  if (asksForTool(p)) return true;
  if (p.name === "SPreset配置" || p.content.length > 20000) return true;
  return false;
}

function isAfter(p: PromptRow, passedHistory: boolean) {
  if (p.injectionPosition === 1) return true;
  const id = p.identifier.toLowerCase();
  const name = p.name.toLowerCase();
  if (id === "jailbreak" || name.includes("post-history") || name.includes("post history")) return true;
  return passedHistory;
}

export function presetTexts(preset: StPreset, mode: "new" | "old" = "new"): { systemPrompt: string; postHistory: string } {
  if (
    mode === "old" &&
    (typeof preset.legacySystemPrompt === "string" || typeof preset.legacyPostHistory === "string")
  ) {
    return {
      systemPrompt: preset.legacySystemPrompt ?? "",
      postHistory: preset.legacyPostHistory ?? "",
    };
  }
  if (!preset.items?.length) return { systemPrompt: preset.systemPrompt, postHistory: preset.postHistory };
  const on = preset.items.filter((item) => item.enabled && item.usable && item.content.trim());
  return {
    systemPrompt: on
      .filter((item) => item.place !== "after")
      .map((item) => item.content.trim())
      .join("\n\n"),
    postHistory: on
      .filter((item) => item.place === "after")
      .map((item) => item.content.trim())
      .join("\n\n"),
  };
}

export function sealPreset(preset: StPreset): StPreset {
  const texts = presetTexts(preset);
  return { ...preset, systemPrompt: texts.systemPrompt, postHistory: texts.postHistory };
}

function isLegacyPost(p: PromptRow) {
  const id = p.identifier.toLowerCase();
  const name = p.name.toLowerCase();
  return id === "jailbreak" || name.includes("post-history") || name.includes("post history") || p.injectionPosition === 1;
}

/** 旧版：全局顺序为空就整份都要；不看条目自己的开关。导入时封存，之后不跟着新版改。 */
function legacyTexts(raw: Record<string, unknown>, prompts: PromptRow[]) {
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  const orders = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
  let order: unknown[] = [];
  for (const entry of orders) {
    const o = rec(entry);
    if (!o || !Array.isArray(o.order)) continue;
    if (o.character_id === 100000 || o.character_id === "100000" || !order.length) order = o.order;
    if (o.character_id === 100000 || o.character_id === "100000") break;
  }
  let listed = prompts;
  if (order.length) {
    const out: PromptRow[] = [];
    const seen = new Set<string>();
    for (const row of order) {
      const o = rec(row);
      if (!o || o.enabled === false) continue;
      const id = str(o.identifier);
      const p = byId.get(id);
      if (!p || seen.has(id)) continue;
      seen.add(id);
      out.push(p);
    }
    listed = out;
  }
  const kept = listed.filter((p) => !isSlot(p) && p.content.trim());
  return {
    systemPrompt: kept
      .filter((p) => !isLegacyPost(p))
      .map((p) => p.content.trim())
      .join("\n\n"),
    postHistory: kept
      .filter((p) => isLegacyPost(p))
      .map((p) => p.content.trim())
      .join("\n\n"),
  };
}

export function parseChatCompletionPreset(raw: unknown, fileName: string): StPreset {
  const o = rec(raw);
  if (!o) throw new Error("这不是对话补全预设");
  if (isCharacterCard(o)) throw new Error("这是角色卡，不是对话补全预设");
  if (!Array.isArray(o.prompts)) {
    if (isTextCompletion(o)) throw new Error("这不是对话补全预设");
    throw new Error("这不是对话补全预设");
  }

  const prompts = o.prompts.map(readPrompt).filter((p): p is PromptRow => Boolean(p));
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  const order = pickOrder(o);
  const listed = order.length
    ? order
        .map((row) => {
          const p = byId.get(row.identifier);
          return p ? { ...p, enabled: row.enabled } : null;
        })
        .filter((p): p is PromptRow => Boolean(p))
    : prompts;

  let passedHistory = false;
  const items: StPromptItem[] = [];
  for (const p of listed) {
    const history = isHistoryMarker(p);
    const place = isAfter(p, passedHistory) ? "after" : "before";
    if (history) passedHistory = true;
    items.push({
      id: p.identifier,
      name: p.name,
      content: p.content,
      original: p.content,
      enabled: p.enabled,
      place: history ? "before" : place,
      usable: !isUnusable(p),
    });
  }
  const usable = items.some((item) => item.usable && item.content.trim());
  if (!usable) throw new Error("这份预设没有可导入的提示词");

  const stem = fileName.replace(/\.json$/i, "").trim() || "未命名预设";
  const legacy = legacyTexts(o, prompts);
  return sealPreset({
    id: uid("st_"),
    name: stem,
    systemPrompt: "",
    postHistory: "",
    legacySystemPrompt: legacy.systemPrompt,
    legacyPostHistory: legacy.postHistory,
    items,
    params: {
      temperature: num(o.temperature),
      topP: num(o.top_p) ?? num(o.topP),
      frequencyPenalty: num(o.frequency_penalty) ?? num(o.frequencyPenalty),
      presencePenalty: num(o.presence_penalty) ?? num(o.presencePenalty),
      maxTokens: num(o.openai_max_tokens) ?? num(o.max_tokens) ?? num(o.maxTokens),
    },
  });
}

export function uniquePresetName(desired: string, existing: string[]) {
  return uniqueNumberedName(desired, existing);
}

type MacroCtx = {
  char: string;
  isMulti: boolean;
  scenario: string;
  personality: string;
};

export function macroContext(chat?: Chat | null): MacroCtx {
  const chars = chat?.characters ?? [];
  const names = chars.map((c) => c.name.trim()).filter(Boolean);
  const personas = chars.map((c) => c.persona.trim()).filter(Boolean);
  return {
    char: names.join("、"),
    isMulti: Boolean(chat?.isMulti && chars.length > 1),
    scenario: chat?.opening?.trim() ?? "",
    personality: personas.join("\n\n"),
  };
}

export function substituteMacros(text: string, ctx: MacroCtx): string {
  if (!text) return "";
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, rawKey: string) => {
    const key = rawKey.trim().toLowerCase().split(":")[0]?.trim() ?? "";
    if (key === "user" || key === "username") return "你";
    if (key === "char" || key === "bot" || key === "character") return ctx.char;
    if (key === "charifnotgroup") return ctx.isMulti ? "" : ctx.char;
    if (key === "scenario") return ctx.scenario;
    if (key === "personality") return ctx.personality;
    return "";
  });
}

function readMode(settings: { stPresetMode?: "new" | "old" }) {
  return settings.stPresetMode === "old" ? "old" : "new";
}

export function activePreset(settings: Settings): StPreset | null {
  const id = settings.stActiveId;
  if (!id) return null;
  return (settings.stPresets ?? []).find((p) => p.id === id) ?? null;
}

export function activeImagePreset(settings: {
  stImageActiveId?: string | null;
  stPresets?: StPreset[];
}): StPreset | null {
  const id = settings.stImageActiveId;
  if (!id) return null;
  return (settings.stPresets ?? []).find((p) => p.id === id) ?? null;
}

/** 只给单独写提示词。没选预设时返回空，调用处和以前一样。 */
export function imagePresetStyle(
  settings: { stImageActiveId?: string | null; stPresets?: StPreset[]; stPresetMode?: "new" | "old" },
  chat?: Chat | null,
): { styleExtra?: string; postHistory?: string } {
  const preset = activeImagePreset(settings);
  if (!preset) return {};
  const ctx = macroContext(chat);
  const texts = presetTexts(preset, readMode(settings));
  const sys = substituteMacros(texts.systemPrompt, ctx).trim();
  const post = substituteMacros(texts.postHistory, ctx).trim();
  const closer =
    "上面的预设只影响怎么理解这一镜。最终输出仍只能是生图标签或规定的 JSON。思考过程不要写进标签。";
  return {
    styleExtra: sys || undefined,
    postHistory: [post, closer].filter(Boolean).join("\n\n"),
  };
}

export function activeWechatPreset(settings: {
  stWechatActiveId?: string | null;
  stPresets?: StPreset[];
}): StPreset | null {
  const id = settings.stWechatActiveId;
  if (!id) return null;
  return (settings.stPresets ?? []).find((p) => p.id === id) ?? null;
}

/** 只给写微信回复。没选预设时返回空。预设不能改 JSON 格式。 */
export function wechatPresetStyle(
  settings: { stWechatActiveId?: string | null; stPresets?: StPreset[]; stPresetMode?: "new" | "old" },
  chat?: Chat | null,
  inlineImage = false,
  group = false,
): { styleExtra?: string; postHistory?: string } {
  const preset = activeWechatPreset(settings);
  if (!preset) return {};
  const ctx = macroContext(chat);
  const texts = presetTexts(preset, readMode(settings));
  const sys = substituteMacros(texts.systemPrompt, ctx).trim();
  const post = substituteMacros(texts.postHistory, ctx).trim();
  const closer = group
    ? "上面的预设只影响她们怎么说、什么态度，不能改输出形式。最终只能返回一个 JSON，不要 markdown，不要小说，不要状态栏，不要预设自己的消息格式。bubbles 是数组，每项是 {name, text}。inner 和 sticker 按角色名分开。思考不要写进 text 或 inner。bubbles 的先后就是发出顺序。后一条已经看见前一条，不要把每个人写成同时只回用户。" +
      (inlineImage ? "JSON 结束后另起一行写 <<<PROMPT>>>，里面只许英文 tag，然后 <<<END>>>。" : "")
    : inlineImage
      ? "上面的预设只影响她怎么说、什么态度，不能改输出形式。先只输出一个微信 JSON，不要 markdown，不要小说，不要状态栏，不要预设自己的消息格式。思考不要写进 bubbles 或 inner。JSON 结束后另起一行写 <<<PROMPT>>>，里面只许英文 tag，然后 <<<END>>>。"
      : '上面的预设只影响她怎么说、什么态度，不能改输出形式。最终只能返回一个 JSON，不要 markdown，不要解释，不要小说，不要状态栏，不要预设自己的消息格式：{"bubbles":["一条文字"],"inner":"内心","sticker":0}。思考过程不要写进 bubbles 或 inner。';
  return {
    styleExtra: sys || undefined,
    postHistory: [post, closer].filter(Boolean).join("\n\n"),
  };
}

function keepLocked(current: LlmParams, next: LlmParams): LlmParams {
  return {
    ...next,
    temperature: current.temperatureLocked ? current.temperature : next.temperature,
    topP: current.topPLocked ? current.topP : next.topP,
    frequencyPenalty: current.frequencyPenaltyLocked ? current.frequencyPenalty : next.frequencyPenalty,
    presencePenalty: current.presencePenaltyLocked ? current.presencePenalty : next.presencePenalty,
    maxTokens: current.maxTokensLocked ? current.maxTokens : next.maxTokens,
    contextTurns: current.contextTurnsLocked ? current.contextTurns : next.contextTurns,
    temperatureLocked: current.temperatureLocked,
    topPLocked: current.topPLocked,
    frequencyPenaltyLocked: current.frequencyPenaltyLocked,
    presencePenaltyLocked: current.presencePenaltyLocked,
    maxTokensLocked: current.maxTokensLocked,
    contextTurnsLocked: current.contextTurnsLocked,
  };
}

export function samplerPatch(params: StPreset["params"], current: LlmParams): LlmParams {
  return keepLocked(current, {
    ...current,
    temperature: params.temperature ?? current.temperature,
    topP: params.topP ?? current.topP,
    frequencyPenalty: params.frequencyPenalty ?? current.frequencyPenalty,
    presencePenalty: params.presencePenalty ?? current.presencePenalty,
    maxTokens: params.maxTokens ?? current.maxTokens,
  });
}

export function restoreSampler(snapshot: LlmParams | null, current: LlmParams): LlmParams {
  if (!snapshot) return current;
  return keepLocked(current, {
    ...current,
    temperature: snapshot.temperature,
    topP: snapshot.topP,
    frequencyPenalty: snapshot.frequencyPenalty,
    presencePenalty: snapshot.presencePenalty,
    maxTokens: snapshot.maxTokens,
  });
}

export function defaultSampler(current: LlmParams): LlmParams {
  return keepLocked(current, { ...DEFAULT_LLM_PARAMS });
}

export function presetStyle(
  settings: Settings,
  task: string,
  chat?: Chat | null,
): { styleExtra?: string; postHistory?: string } {
  if (task === "image" || task === "memory" || task === "rewrite") return {};
  const preset = activePreset(settings);
  if (!preset) return {};
  const ctx = macroContext(chat);
  const texts = presetTexts(preset, readMode(settings));
  const sys = substituteMacros(texts.systemPrompt, ctx).trim();
  const post = substituteMacros(texts.postHistory, ctx).trim();
  if (task === "chat") {
    return {
      styleExtra: sys || undefined,
      postHistory: post || undefined,
    };
  }
  const blob = [sys, post].filter(Boolean).join("\n\n");
  return { styleExtra: blob || undefined };
}
