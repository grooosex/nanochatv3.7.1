import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import type { AppDataDump, Chat, FavoriteItem, FavGroup, ImageParams, WechatLine, WechatLog, WechatSession, WechatSticker } from "./types";
import { migrateFavorite } from "./presets";
import { db, putImage } from "./idb";
import {
  collectEmbeddedImages,
  collectPngs,
  convertLegacyArchive,
  isLegacyArchive,
  pickArchiveJson,
} from "./legacy-archive";
import { downloadBlob, uid } from "./utils";

function addId(ids: Set<string>, id: unknown) {
  if (typeof id === "string" && id) ids.add(id);
}

function addLines(ids: Set<string>, lines?: WechatLine[], pending?: { blobId?: string }[]) {
  for (const line of lines ?? []) {
    for (const item of line.attachments ?? []) addId(ids, item.blobId);
  }
  for (const item of pending ?? []) addId(ids, item.blobId);
}

function addLog(ids: Set<string>, log?: WechatLog) {
  if (!log) return;
  addLines(ids, log.lines);
  for (const room of Object.values(log.rooms ?? {})) addLines(ids, room.lines, room.pending);
}

function addSession(ids: Set<string>, session: WechatSession) {
  addLines(ids, session.lines, session.pending);
  for (const room of Object.values(session.rooms ?? {})) addLines(ids, room.lines, room.pending);
}

function keptImageIds(dump: AppDataDump) {
  const ids = new Set<string>();
  for (const sticker of dump.wechatStickers ?? []) addId(ids, sticker.blobId);
  for (const fav of dump.favorites ?? []) addId(ids, fav.blobId);
  for (const card of dump.cards ?? []) {
    addId(ids, card.customAvatarBlobId);
    for (const c of card.characters ?? []) {
      addId(ids, c.lookBlobId);
      addId(ids, c.wechatAvatarBlobId);
    }
  }
  for (const chat of dump.chats ?? []) {
    addId(ids, chat.customAvatarBlobId);
    for (const c of chat.characters ?? []) {
      addId(ids, c.lookBlobId);
      addId(ids, c.wechatAvatarBlobId);
    }
    for (const m of chat.messages ?? []) {
      addId(ids, m.userImageBlobId);
      for (const shot of m.userImages ?? []) addId(ids, shot.blobId);
      addLog(ids, m.wechatLog);
    }
  }
  for (const session of Object.values(dump.wechatSessions ?? {})) addSession(ids, session);
  for (const shots of Object.values(dump.composerShots ?? {})) {
    for (const shot of shots ?? []) addId(ids, shot.blobId);
  }
  return ids;
}

export async function exportArchive(kind: "full" | "lite" | "partial") {
  const [chats, folders, cards, appearances, favorites, favGroups, history, settingsRow, wechatRow, stickerRow, pureRow, currentRow, draftsRow, shotsRow] =
    await Promise.all([
      db.chats.toArray(),
      db.folders.toArray(),
      db.cards.toArray(),
      db.appearances.toArray(),
      db.favorites.toArray(),
      db.favGroups.toArray(),
      db.history.toArray(),
      db.kv.get("settings"),
      db.kv.get("wechatSessions"),
      db.kv.get("wechatStickers"),
      db.kv.get("pureParams"),
      db.kv.get("currentId"),
      db.kv.get("composerDrafts"),
      db.kv.get("composerShots"),
    ]);
  const dump: AppDataDump = {
    version: 1,
    settings: (settingsRow?.value as AppDataDump["settings"]) ?? {
      grokModelId: "grok-4.6-medium",
      chatSource: "grok",
      llmBase: "",
      llmKey: "",
      llmConnected: false,
      llmModel: "",
      llmModels: [],
      llmStarred: [],
      llmAccounts: [],
      llmParams: {
        temperature: 0.9,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0.4,
        maxTokens: 4096,
        contextTurns: 16,
      },
      stPresets: [],
      stActiveId: null,
      stParamSnapshot: null,
      stImageActiveId: null,
      stWechatActiveId: null,
      naiKey: "",
      naiBase: "https://api.idlecloud.cc",
      naiConnected: false,
      cooldownUntil: 0,
      chatImage: true,
      theme: "light",
    },
    folders,
    chats,
    cards,
    appearances,
    favorites,
    favGroups,
    history,
    hasImages: kind !== "lite",
    wechatSessions: (wechatRow?.value ?? {}) as AppDataDump["wechatSessions"],
    wechatStickers: (Array.isArray(stickerRow?.value) ? stickerRow.value : []) as WechatSticker[],
    pureParams: pureRow?.value && typeof pureRow.value === "object" ? (pureRow.value as ImageParams) : undefined,
    currentId: typeof currentRow?.value === "string" ? currentRow.value : null,
    composerDrafts:
      draftsRow?.value && typeof draftsRow.value === "object" && !Array.isArray(draftsRow.value)
        ? (draftsRow.value as Record<string, string>)
        : {},
    composerShots:
      shotsRow?.value && typeof shotsRow.value === "object" && !Array.isArray(shotsRow.value)
        ? (shotsRow.value as AppDataDump["composerShots"])
        : {},
  };

  if (kind === "lite") {
    dump.favorites = (dump.favorites ?? []).map((f) => ({ ...f, blobId: undefined }));
    dump.history = (dump.history ?? []).map((h) => ({ ...h, blobId: undefined }));
    dump.composerShots = {};
    const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
    downloadBlob(blob, `绘语-无配图-${new Date().toISOString().slice(0, 10)}.json`);
    return;
  }

  const files: Record<string, Uint8Array> = {};
  const images = await db.images.toArray();
  if (kind === "partial") {
    dump.history = (dump.history ?? []).map((h) => ({ ...h, blobId: undefined }));
    const keep = keptImageIds(dump);
    for (const img of images) {
      if (!keep.has(img.id)) continue;
      files[`images/${img.id}.png`] = new Uint8Array(await img.blob.arrayBuffer());
    }
  } else {
    for (const img of images) {
      files[`images/${img.id}.png`] = new Uint8Array(await img.blob.arrayBuffer());
    }
  }
  files["huiyu.json"] = strToU8(JSON.stringify(dump));
  const zipped = zipSync(files, { level: 1 });
  const name = kind === "partial" ? "部分配图" : "全部";
  downloadBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), `绘语-${name}-${new Date().toISOString().slice(0, 10)}.zip`);
}

export async function importArchive(file: File) {
  const name = file.name.toLowerCase();
  let raw: unknown;
  const imageBlobs = new Map<string, Blob>();

  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = name.endsWith(".zip") || (head[0] === 0x50 && head[1] === 0x4b);

  if (isZip) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(buf);
    } catch {
      throw new Error("无法识别的存档");
    }
    const jsonFile = pickArchiveJson(unzipped);
    if (!jsonFile) throw new Error("无法识别的存档");
    try {
      raw = JSON.parse(strFromU8(jsonFile));
    } catch {
      throw new Error("无法识别的存档");
    }
    for (const [id, data] of collectPngs(unzipped)) {
      imageBlobs.set(id, new Blob([data as BlobPart], { type: "image/png" }));
    }
  } else {
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new Error("无法识别的存档");
    }
  }

  for (const [id, blob] of collectEmbeddedImages(raw)) {
    if (!imageBlobs.has(id)) imageBlobs.set(id, blob);
  }

  let dump: AppDataDump;
  let currentId: string | null | undefined;
  let pureParams: ImageParams | undefined;

  if (isLegacyArchive(raw)) {
    const loaded = convertLegacyArchive(raw);
    dump = loaded.dump;
    currentId = loaded.currentId;
    pureParams = loaded.pureParams;
  } else {
    dump = raw as AppDataDump;
    if (!dump || dump.version !== 1 || !Array.isArray(dump.chats)) throw new Error("无法识别的存档");
  }

  const tables = [db.chats, db.folders, db.cards, db.appearances, db.favorites, db.favGroups, db.history, db.images, db.kv];
  await db.transaction("rw", tables, async () => {
    await db.chats.clear();
    await db.folders.clear();
    await db.cards.clear();
    await db.appearances.clear();
    await db.favorites.clear();
    await db.favGroups.clear();
    await db.history.clear();
    await db.images.clear();
    await db.chats.bulkPut(dump.chats ?? []);
    await db.folders.bulkPut(dump.folders ?? []);
    await db.cards.bulkPut(dump.cards ?? []);
    await db.appearances.bulkPut(dump.appearances ?? []);
    await db.favorites.bulkPut((dump.favorites ?? []).map(migrateFavorite).filter(Boolean) as FavoriteItem[]);
    await db.favGroups.bulkPut((dump.favGroups ?? []).filter((g) => g && typeof g.id === "string") as FavGroup[]);
    await db.history.bulkPut(dump.history ?? []);
    const prev = await db.kv.get("settings");
    const prevVal = (prev?.value as AppDataDump["settings"] | undefined) ?? undefined;
    const dumpS = dump.settings;
    const merged = {
      ...((prevVal as object) ?? {}),
      ...dumpS,
      naiKey: dumpS?.naiKey || prevVal?.naiKey || "",
      naiOfficialKey: dumpS?.naiOfficialKey || prevVal?.naiOfficialKey || "",
      llmKey: dumpS?.llmKey || prevVal?.llmKey || "",
      llmAccounts: Array.isArray(dumpS?.llmAccounts) ? dumpS.llmAccounts : (prevVal?.llmAccounts ?? []),
      stPresets: Array.isArray(dumpS?.stPresets) ? dumpS.stPresets : (prevVal?.stPresets ?? []),
      stActiveId: dumpS?.stActiveId ?? prevVal?.stActiveId ?? null,
      stParamSnapshot: dumpS?.stParamSnapshot ?? prevVal?.stParamSnapshot ?? null,
      stImageActiveId: dumpS?.stImageActiveId ?? prevVal?.stImageActiveId ?? null,
      stWechatActiveId: dumpS?.stWechatActiveId ?? prevVal?.stWechatActiveId ?? null,
    };
    await db.kv.put({ key: "settings", value: merged });
    if (currentId !== undefined) await db.kv.put({ key: "currentId", value: currentId });
    if (pureParams) await db.kv.put({ key: "pureParams", value: pureParams });
    if (dump.wechatSessions && typeof dump.wechatSessions === "object") {
      await db.kv.put({ key: "wechatSessions", value: dump.wechatSessions });
    }
    if (Array.isArray(dump.wechatStickers)) {
      await db.kv.put({ key: "wechatStickers", value: dump.wechatStickers });
    }
    if (dump.pureParams && typeof dump.pureParams === "object") {
      await db.kv.put({ key: "pureParams", value: dump.pureParams });
    }
    if ("currentId" in dump) {
      await db.kv.put({ key: "currentId", value: typeof dump.currentId === "string" ? dump.currentId : null });
    }
    if (dump.composerDrafts && typeof dump.composerDrafts === "object") {
      await db.kv.put({ key: "composerDrafts", value: dump.composerDrafts });
    }
    if (dump.composerShots && typeof dump.composerShots === "object") {
      await db.kv.put({ key: "composerShots", value: dump.composerShots });
    }
  });
  for (const [id, blob] of imageBlobs) await putImage(id, blob);
}

export function cloneChat(chat: Chat, nameSuffix = "(副本)"): Chat {
  const id = uid("chat_");
  return {
    ...structuredClone(chat),
    id,
    name: chat.name ? `${chat.name}${nameSuffix}` : "未命名" + nameSuffix,
    starred: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDraft: false,
    messages: structuredClone(chat.messages),
  };
}
