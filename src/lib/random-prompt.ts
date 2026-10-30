import type { ImageParams } from "./types";

export const APPEARANCE_MODULE_NAME = "角色";

function uid(prefix = "") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface RandomItem {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  /** 角色选择里的 id。有这个才跟着那边走。 */
  sourceId?: string;
  /** 在模块里改过名字，就不再跟着角色选择的名字。 */
  nameCustom?: boolean;
}

export interface RandomModule {
  id: string;
  name: string;
  pick: "random" | "seq";
  items: RandomItem[];
  /** 下次顺序要选的项。空着就是从第一项开始。 */
  nextId?: string | null;
  /** 抽一次接着用几张。1 或空着就是每张都重抽。 */
  rounds?: number;
  /** 这一项已经用了几次。轮数用完、关掉随机或删掉符号就清掉。 */
  hold?: { itemId: string; used: number } | null;
  /** 由角色选择维护。复制出来的没有这个。 */
  linked?: "appearances";
}

export interface RandomBank {
  enabled: boolean;
  modules: RandomModule[];
  /** 多个模块合在一次里抽时，各自记位置。键是「角色&动作」。 */
  comboLast?: Record<string, string>;
  /** 组合标签各自记「这一项用了几次」。键同上。 */
  comboHold?: Record<string, { itemId: string; used: number }>;
  /** 用户删掉了自动的「角色」模块。下次新保存角色才再建。 */
  appearanceModuleDismissed?: boolean;
}

type PromptFields = Pick<ImageParams, "promptFront" | "promptMid" | "promptBack" | "negative">;

const TAG_SRC = String.raw`<ran_id="([^"]+)"((?:&"[^"]+")*)>`;

export function emptyBank(): RandomBank {
  return { enabled: false, modules: [], comboLast: {} };
}

export function moduleTag(names: string[]) {
  return `<ran_id=${names.map((n) => `"${n}"`).join("&")}>`;
}

export function appendPrompt(mid: string, piece: string) {
  const t = mid.replace(/\s+$/, "");
  if (!t) return piece;
  if (t.endsWith(",")) return `${t}${piece}`;
  return `${t},${piece}`;
}

export function badModuleName(name: string, modules: RandomModule[], exceptId?: string) {
  const n = name.trim();
  if (!n) return "先写模块名";
  if (/["&<>]/.test(n)) return "名字里不能有引号和 &";
  if (modules.some((m) => m.id !== exceptId && m.name === n)) return "已经有同名模块";
  return "";
}

export function bankSwitch(bank: RandomBank, enabled: boolean): RandomBank {
  if (enabled) return { ...bank, enabled: true };
  return {
    ...bank,
    enabled: false,
    modules: bank.modules.map((m) => ({ ...m, nextId: null, hold: null })),
    comboLast: {},
    comboHold: {},
  };
}

export function moduleRounds(mod: RandomModule) {
  const n = Math.floor(Number(mod.rounds));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** 顺序模式下，下一张会用到的那一项。轮数还没用完时是正在复用的项。 */
export function seqTurnItem(mod: RandomModule): RandomItem | null {
  const pool = mod.items.filter((item) => item.enabled);
  if (!pool.length) return null;
  const rounds = moduleRounds(mod);
  if (mod.hold && mod.hold.used < rounds) {
    const held = pool.find((item) => item.id === mod.hold?.itemId);
    if (held) return held;
  }
  if (mod.nextId) {
    const at = pool.find((item) => item.id === mod.nextId);
    if (at) return at;
  }
  return pool[0];
}

/** 手动指定下一次从这一项开始，并清掉还没走完的轮数。 */
export function jumpSeq(mod: RandomModule, itemId: string): RandomModule {
  return { ...mod, nextId: itemId, hold: null };
}

export function setModuleRounds(bank: RandomBank, id: string, rounds: number): RandomBank {
  const n = Math.max(1, Math.floor(rounds) || 1);
  return {
    ...bank,
    modules: bank.modules.map((m) => {
      if (m.id !== id) return m;
      if (n <= 1) {
        const next = { ...m };
        delete next.rounds;
        return next;
      }
      return { ...m, rounds: n };
    }),
  };
}

/** 换随机或顺序时丢掉正在复用的那一项，下一张按新方式重抽。轮数保留。 */
export function setModulePick(bank: RandomBank, id: string, pick: RandomModule["pick"]): RandomBank {
  const mod = bank.modules.find((m) => m.id === id);
  if (!mod || mod.pick === pick) return bank;
  const comboHold = { ...(bank.comboHold ?? {}) };
  for (const key of Object.keys(comboHold)) {
    if (key.split("&").includes(mod.name)) delete comboHold[key];
  }
  return {
    ...bank,
    comboHold,
    modules: bank.modules.map((m) => (m.id === id ? { ...m, pick, hold: null } : m)),
  };
}

function tagRe() {
  return new RegExp(TAG_SRC, "g");
}

function namesOf(first: string, rest: string) {
  const names = [first];
  for (const m of rest.matchAll(/&"([^"]+)"/g)) names.push(m[1]);
  return names;
}

function tagKeys(text: string) {
  const keys = new Set<string>();
  for (const m of text.matchAll(tagRe())) {
    const names = namesOf(m[1], m[2] || "");
    keys.add(names.length > 1 ? `&${names.join("&")}` : names[0]);
  }
  return keys;
}

function blob(p: PromptFields) {
  return [p.promptFront || "", p.promptMid || "", p.promptBack || "", p.negative || ""].join("\n");
}

/** 符号从这份提示词里消失，就忘掉它的顺序位置和轮数进度。没变化时返回 null。 */
export function forgetIfPrompt(bank: RandomBank, prev: PromptFields, next: PromptFields): RandomBank | null {
  const before = tagKeys(blob(prev));
  const after = tagKeys(blob(next));
  let modules = bank.modules;
  const combo = { ...(bank.comboLast ?? {}) };
  const comboHold = { ...(bank.comboHold ?? {}) };
  let changed = false;
  for (const key of before) {
    if (after.has(key)) continue;
    changed = true;
    if (key.startsWith("&")) {
      delete combo[key.slice(1)];
      delete comboHold[key.slice(1)];
    } else modules = modules.map((m) => (m.name === key ? { ...m, nextId: null, hold: null } : m));
  }
  if (!changed) return null;
  return { ...bank, modules, comboLast: combo, comboHold };
}

function enabledItems(mod: RandomModule) {
  return mod.items.filter((item) => item.enabled);
}

function indexOfNext(pool: RandomItem[], nextId?: string | null) {
  if (!nextId) return 0;
  const i = pool.findIndex((item) => item.id === nextId);
  return i >= 0 ? i : 0;
}

type Hold = { itemId: string; used: number };

function readHold(bank: RandomBank, names: string[]): Hold | null {
  if (names.length === 1) return bank.modules.find((m) => m.name === names[0])?.hold ?? null;
  return bank.comboHold?.[names.join("&")] ?? null;
}

function writeHold(bank: RandomBank, names: string[], hold: Hold): RandomBank {
  if (names.length === 1) {
    const name = names[0];
    return { ...bank, modules: bank.modules.map((m) => (m.name === name ? { ...m, hold } : m)) };
  }
  const key = names.join("&");
  return { ...bank, comboHold: { ...(bank.comboHold ?? {}), [key]: hold } };
}

function pickFresh(
  names: string[],
  unique: RandomModule[],
  pool: RandomItem[],
  bank: RandomBank,
  rng: () => number,
): { value: string; itemId: string; bank: RandomBank } {
  const allSeq = unique.every((mod) => mod.pick === "seq");
  if (!allSeq) {
    const item = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    return { value: item.content.trim(), itemId: item.id, bank };
  }
  if (names.length === 1) {
    const mod = unique[0];
    const idx = indexOfNext(pool, mod.nextId);
    const item = pool[idx];
    const next = pool[(idx + 1) % pool.length];
    return {
      value: item.content.trim(),
      itemId: item.id,
      bank: { ...bank, modules: bank.modules.map((m) => (m.id === mod.id ? { ...m, nextId: next.id } : m)) },
    };
  }
  const key = names.join("&");
  const idx = indexOfNext(pool, bank.comboLast?.[key]);
  const item = pool[idx];
  const next = pool[(idx + 1) % pool.length];
  return {
    value: item.content.trim(),
    itemId: item.id,
    bank: { ...bank, comboLast: { ...(bank.comboLast ?? {}), [key]: next.id } },
  };
}

function resolve(names: string[], bank: RandomBank, rng: () => number): { value: string; bank: RandomBank; missing: string[] } {
  const unique: RandomModule[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const mod = bank.modules.find((m) => m.name === name);
    if (!mod) missing.push(name);
    else if (!unique.includes(mod)) unique.push(mod);
  }
  const pool = unique.flatMap((mod) => enabledItems(mod));
  if (!pool.length) {
    for (const mod of unique) if (!missing.includes(mod.name)) missing.push(mod.name);
    return { value: "", bank, missing };
  }
  const rounds = Math.min(...unique.map(moduleRounds));
  const hold = readHold(bank, names);
  const held = hold ? pool.find((item) => item.id === hold.itemId) : undefined;
  if (hold && held && hold.used < rounds) {
    return { value: held.content.trim(), bank: writeHold(bank, names, { itemId: held.id, used: hold.used + 1 }), missing };
  }
  const picked = pickFresh(names, unique, pool, bank, rng);
  return { value: picked.value, bank: writeHold(picked.bank, names, { itemId: picked.itemId, used: 1 }), missing };
}

function expandField(text: string, bank: RandomBank, rng: () => number, missing: string[], seen: Map<string, string>) {
  let next = bank;
  const out = text.replace(tagRe(), (_full, first: string, rest: string) => {
    const names = namesOf(first, rest || "");
    const key = names.length > 1 ? names.join("&") : names[0];
    const cached = seen.get(key);
    if (cached !== undefined) return cached;
    const got = resolve(names, next, rng);
    next = got.bank;
    missing.push(...got.missing);
    seen.set(key, got.value);
    return got.value;
  });
  return { text: out, bank: next };
}

/** 开关关着时原样返回，符号当普通字。开着时换成选中的内容，并推进顺序和轮数。同一张图里同一个符号只算一轮。 */
export function expandParams(params: ImageParams, bank: RandomBank | undefined, rng: () => number = Math.random) {
  if (!bank?.enabled) return { params, bank, missing: [] as string[] };
  const missing: string[] = [];
  const seen = new Map<string, string>();
  let next = bank;
  const apply = (text: string) => {
    const got = expandField(text || "", next, rng, missing, seen);
    next = got.bank;
    return got.text;
  };
  return {
    params: {
      ...params,
      promptFront: apply(params.promptFront),
      promptMid: apply(params.promptMid),
      promptBack: apply(params.promptBack),
      negative: apply(params.negative),
    },
    bank: next,
    missing: [...new Set(missing)],
  };
}

function parseItem(raw: unknown): RandomItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<RandomItem>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const item: RandomItem = {
    id: row.id,
    name: row.name,
    content: typeof row.content === "string" ? row.content : "",
    enabled: row.enabled !== false,
  };
  if (typeof row.sourceId === "string" && row.sourceId) item.sourceId = row.sourceId;
  if (row.nameCustom === true) item.nameCustom = true;
  return item;
}

export function parseRandomBank(raw: unknown): RandomBank {
  const empty = emptyBank();
  if (!raw || typeof raw !== "object") return empty;
  const row = raw as Partial<RandomBank>;
  const modules: RandomModule[] = [];
  if (Array.isArray(row.modules)) {
    for (const mod of row.modules) {
      if (!mod || typeof mod !== "object") continue;
      const m = mod as Partial<RandomModule>;
      if (typeof m.id !== "string" || typeof m.name !== "string" || !m.name.trim()) continue;
      if (modules.some((x) => x.name === m.name || x.id === m.id)) continue;
      const items = Array.isArray(m.items) ? m.items.map(parseItem).filter((x): x is RandomItem => !!x) : [];
      const rounds = moduleRounds(m as RandomModule);
      const hold = parseHold(m.hold);
      modules.push({
        id: m.id,
        name: m.name.trim(),
        pick: m.pick === "seq" ? "seq" : "random",
        items,
        nextId: typeof m.nextId === "string" ? m.nextId : null,
        ...(rounds > 1 ? { rounds } : {}),
        ...(hold ? { hold } : {}),
        ...(m.linked === "appearances" ? { linked: "appearances" as const } : {}),
      });
    }
  }
  const comboLast: Record<string, string> = {};
  if (row.comboLast && typeof row.comboLast === "object") {
    for (const [k, v] of Object.entries(row.comboLast)) {
      if (typeof v === "string") comboLast[k] = v;
    }
  }
  const comboHold: Record<string, Hold> = {};
  if (row.comboHold && typeof row.comboHold === "object") {
    for (const [k, v] of Object.entries(row.comboHold)) {
      const hold = parseHold(v);
      if (hold) comboHold[k] = hold;
    }
  }
  return {
    enabled: row.enabled === true,
    modules,
    comboLast,
    ...(Object.keys(comboHold).length ? { comboHold } : {}),
    ...(row.appearanceModuleDismissed === true ? { appearanceModuleDismissed: true } : {}),
  };
}

function parseHold(raw: unknown): Hold | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<Hold>;
  const used = Math.floor(Number(row.used));
  if (typeof row.itemId !== "string" || !row.itemId || !Number.isFinite(used) || used < 1) return null;
  return { itemId: row.itemId, used };
}

export type AppearanceSnap = { id: string; name: string; prompt: string; order: number };

function blankLinked(): RandomModule {
  return {
    id: uid("rm_"),
    name: APPEARANCE_MODULE_NAME,
    pick: "random",
    items: [],
    nextId: null,
    linked: "appearances",
  };
}

function fillLinked(mod: RandomModule, ordered: AppearanceSnap[]): RandomModule {
  const prev = new Map(mod.items.filter((item) => item.sourceId).map((item) => [item.sourceId as string, item]));
  const items = ordered.map((a) => {
    const old = prev.get(a.id);
    if (!old) {
      return { id: uid("ri_"), name: a.name, content: a.prompt, enabled: false, sourceId: a.id };
    }
    const custom = old.nameCustom === true;
    return {
      id: old.id,
      name: custom ? old.name : a.name,
      content: a.prompt,
      enabled: old.enabled,
      sourceId: a.id,
      ...(custom ? { nameCustom: true as const } : {}),
    };
  });
  const nextId = items.some((item) => item.id === mod.nextId) ? mod.nextId ?? null : null;
  const hold = mod.hold && items.some((item) => item.id === mod.hold?.itemId) ? mod.hold : null;
  return { ...mod, name: APPEARANCE_MODULE_NAME, linked: "appearances", items, nextId, hold };
}

function sameItem(a: RandomItem, b: RandomItem) {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.content === b.content &&
    a.enabled === b.enabled &&
    (a.sourceId ?? "") === (b.sourceId ?? "") &&
    a.nameCustom === b.nameCustom
  );
}

function sameLinked(a: RandomModule, b: RandomModule) {
  if (a.name !== b.name || a.linked !== b.linked || (a.nextId ?? null) !== (b.nextId ?? null)) return false;
  if (a.items.length !== b.items.length) return false;
  return a.items.every((item, i) => sameItem(item, b.items[i]));
}

/** ensure：没有就按现有角色建一份，用户删掉过则不动。create：新保存了角色，删掉过也要再建。update：只刷新已经在的那份。 */
export function syncAppearanceModule(
  bank: RandomBank | undefined,
  appearances: AppearanceSnap[],
  mode: "ensure" | "create" | "update",
): RandomBank {
  const base = bank ?? emptyBank();
  const ordered = [...appearances].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const linked = base.modules.find((m) => m.linked === "appearances");
  if (!linked) {
    const blocked =
      mode === "update" || (mode === "ensure" && (base.appearanceModuleDismissed === true || ordered.length === 0));
    if (blocked) return base;
    if (base.modules.some((m) => m.name === APPEARANCE_MODULE_NAME)) return base;
    return {
      ...base,
      appearanceModuleDismissed: false,
      modules: [...base.modules, fillLinked(blankLinked(), ordered)],
    };
  }
  const filled = fillLinked(linked, ordered);
  const dismissed = mode === "create" ? false : base.appearanceModuleDismissed;
  if (sameLinked(linked, filled) && dismissed === base.appearanceModuleDismissed) return base;
  return {
    ...base,
    appearanceModuleDismissed: dismissed,
    modules: base.modules.map((m) => (m.id === linked.id ? filled : m)),
  };
}

/** 复制是快照。不带走角色选择的关联，之后两边互不影响。 */
export function duplicateRandomModule(mod: RandomModule, modules: RandomModule[]): RandomModule {
  const base = `${mod.name}(副本)`;
  let name = base;
  let n = 2;
  while (modules.some((m) => m.name === name)) {
    name = `${base}${n}`;
    n += 1;
  }
  return {
    id: uid("rm_"),
    name,
    pick: mod.pick,
    nextId: null,
    ...(moduleRounds(mod) > 1 ? { rounds: moduleRounds(mod) } : {}),
    items: mod.items.map((item) => ({
      id: uid("ri_"),
      name: item.name,
      content: item.content,
      enabled: item.enabled,
    })),
  };
}
