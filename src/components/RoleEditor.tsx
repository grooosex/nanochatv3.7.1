import { useState, useEffect, useRef, type ReactNode, type PointerEvent as PE } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronUp, Check, Copy, Download, Loader2, Plus, RefreshCw, Sparkles, SquareArrowUp, Trash2, X } from "lucide-react";
import { DEFAULT_STATUS_BAR, PLACEHOLDERS, emptyCharacter } from "@/lib/constants";
import { polishAll, polishField, foldWindow } from "@/lib/engine";
import { FIELD_LABELS } from "@/lib/prompts";
import { applyRoleField, mergePolish } from "@/lib/role-polish";
import { useApp, saveBlob } from "@/lib/store";
import { compressRef } from "@/lib/ref-image";
import { getImage, imageUrl } from "@/lib/idb";
import { syncCharsFromRole } from "@/lib/nai";
import { copyRole, parseRoleText } from "@/lib/role-text";
import type { Chat, ExtraField } from "@/lib/types";
import { uid } from "@/lib/utils";
import { emptyMemory, foldCoveredEnd, memoryCaughtUp, memoryTurnStats } from "@/lib/chat-memory";
import { invalidateMemory, runManualMemory } from "./chat-actions";
import { ChatModelSelect } from "./ModelSelect";
import { Card, ExpandSelect, FieldLabel, GhostBtn, Modal, PrimaryBtn, Switch, TextArea, TextInput, ZoomImg } from "./ui-kit";
import { LibraryDrawer } from "./LibraryDrawer";
import { ImagePick } from "./ImagePick";

type Busy =
  | null
  | { kind: "all" }
  | { kind: "personalize" }
  | { kind: "mem" }
  | { kind: "field"; key: string; charId?: string };

export function RoleEditor({ chat, mode }: { chat: Chat; mode: "create" | "edit" }) {
  const grok = useApp((s) => s.settings.grokModelId);
  const cards = useApp((s) => s.cards);
  const [busy, setBusy] = useState<Busy>(null);
  const [polished, setPolished] = useState(false);
  const [charSel, setCharSel] = useState(0);
  const [memPick, setMemPick] = useState(false);
  const [recognizeOpen, setRecognizeOpen] = useState(false);
  const [recognizeText, setRecognizeText] = useState("");
  const patch = (p: Partial<Chat>) => useApp.getState().patchChat(chat.id, p);
  const char = chat.characters[charSel] ?? chat.characters[0];
  const autoPolish = useApp((s) => s.ui.autoPolish);
  const polishJob = useApp((s) => s.ui.polishJob);
  const busyRef = useRef(false);
  const locked = !!busy;
  const memTurns = memoryTurnStats(chat.messages.length, chat.memoryUntil);
  const { W, I } = foldWindow();
  const memOk = memoryCaughtUp(chat.messages.length, chat.memoryUntil || 0, W, I);
  const memReady = foldCoveredEnd(chat.messages.length, W, I) >= 2;
  const memoryHint = useApp((s) => s.ui.memoryHint);
  const memStreaming = memoryHint?.chatId === chat.id && memoryHint.state === "generating";
  const memoryShown = memStreaming && memoryHint.draft != null ? memoryHint.draft : chat.memory;
  const fieldBusyLabel =
    busy?.kind === "field" ? FIELD_LABELS[busy.key] || busy.key : "";

  const syncChars = (characters: Chat["characters"], isMulti = chat.isMulti) =>
    patch({
      characters,
      isMulti,
      imageParams: syncCharsFromRole(chat.imageParams, characters, isMulti),
    });

  const copyPersona = async () => {
    const text = copyRole(chat);
    if (!text.trim()) {
      useApp.getState().toast("没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      useApp.getState().toast("已复制");
    } catch {
      useApp.getState().toast("复制失败");
    }
  };

  const applyRecognized = () => {
    const parsed = parseRoleText(recognizeText);
    if (!parsed.matched) {
      useApp.getState().toast("没认出标题");
      return;
    }
    const people = parsed.people;
    const shared: Partial<Chat> = {};
    if (parsed.overview !== undefined) shared.overview = parsed.overview;
    if (parsed.opening !== undefined) shared.opening = parsed.opening;
    if (!chat.isMulti) {
      const p = people[0];
      const cur = chat.characters[0] ?? emptyCharacter(1);
      const next = p
        ? {
            ...cur,
            ...(p.name !== undefined ? { name: p.name } : {}),
            ...(p.persona !== undefined ? { persona: p.persona } : {}),
            ...(p.speech !== undefined ? { speech: p.speech } : {}),
            ...(p.appearance !== undefined ? { appearance: p.appearance } : {}),
          }
        : cur;
      patch({
        ...shared,
        characters: [next, ...chat.characters.slice(1)],
        imageParams: {
          ...chat.imageParams,
          characters: chat.imageParams.characters.map((slot) =>
            slot.id === next.id && p?.name !== undefined ? { ...slot, name: next.name } : slot,
          ),
        },
      });
      useApp.getState().toast(people.length > 1 ? "只填了第一个人" : "已填入");
    } else {
      let characters = [...chat.characters];
      while (characters.length < Math.max(people.length, 1)) characters.push(emptyCharacter(characters.length + 1));
      characters = characters.map((c, i) => {
        const p = people[i];
        if (!p) return c;
        return {
          ...c,
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.persona !== undefined ? { persona: p.persona } : {}),
          ...(p.speech !== undefined ? { speech: p.speech } : {}),
          ...(p.appearance !== undefined ? { appearance: p.appearance } : {}),
        };
      });
      patch({
        ...shared,
        characters,
        imageParams: syncCharsFromRole(chat.imageParams, characters, true),
      });
      useApp.getState().toast("已填入");
    }
    setRecognizeOpen(false);
  };

  const runPolish = async (instruction?: string, mark: "all" | "personalize" = "all") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ kind: mark });
    try {
      const snapshot = useApp.getState().chats.find((c) => c.id === chat.id) ?? chat;
      const json = await polishAll(snapshot, grok, instruction);
      useApp.getState().patchChat(chat.id, (c) => {
        const merged = mergePolish(c, json);
        return {
          ...c,
          ...merged,
          imageParams: syncCharsFromRole(c.imageParams, merged.characters, c.isMulti),
          updatedAt: Date.now(),
        };
      });
      setPolished(true);
      useApp.getState().toast(instruction?.trim() ? "已按要求修改" : "已完善设定");
    } catch (e) {
      useApp.getState().toast(e instanceof Error ? e.message : "完善失败");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const runField = async (key: string, charId?: string, instruction?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ kind: "field", key, charId });
    try {
      const snapshot = useApp.getState().chats.find((c) => c.id === chat.id) ?? chat;
      const text = await polishField(snapshot, grok, key, instruction, charId, (t) => {
        if (key !== "persona") return;
        const ch = snapshot.characters.find((c) => c.id === charId);
        if (!ch?.personaVoices) return;
        useApp.getState().patchChat(chat.id, (c) => ({
          ...applyRoleField(c, key, t, charId),
          updatedAt: Date.now(),
        }));
      });
      useApp.getState().patchChat(chat.id, (c) => ({
        ...applyRoleField(c, key, text, charId),
        updatedAt: Date.now(),
      }));
      useApp.getState().toast(`已更新${FIELD_LABELS[key] || key}`);
    } catch (e) {
      useApp.getState().toast(e instanceof Error ? e.message : "生成失败");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const openPersonalize = (key: string, charId?: string) => {
    if (locked) return;
    useApp.getState().setUI({ fieldEdit: { key, charId, text: "" } });
  };

  useEffect(() => {
    if (!autoPolish || mode !== "create") return;
    useApp.getState().setUI({ autoPolish: false });
    void runPolish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPolish]);

  useEffect(() => {
    if (!polishJob || polishJob.chatId !== chat.id) return;
    useApp.getState().setUI({ polishJob: null });
    if (polishJob.kind === "field" && polishJob.key) {
      void runField(polishJob.key, polishJob.charId, polishJob.instruction);
    } else {
      void runPolish(polishJob.instruction, "personalize");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polishJob]);

  const startChat = async () => {
    const name = chat.characters.map((c) => c.name).filter(Boolean).join("、") || chat.name || "未命名";
    useApp.getState().patchChat(chat.id, (c) => ({
      ...c,
      name,
      isDraft: false,
      imageParams: syncCharsFromRole(c.imageParams, c.characters, c.isMulti),
    }));
    useApp.getState().commitChat(chat.id);
    if (mode === "create") {
      const { sendOpening } = await import("./chat-actions");
      void sendOpening(chat.id);
    } else {
      useApp.getState().toast("设定已保存");
    }
  };

  const nameBlock = char ? (
    <FieldBlock
      label="名字"
      hint="可空，让 Grok 起"
      value={char.name}
      placeholder={PLACEHOLDERS.name}
      single
      busy={busy?.kind === "field" && busy.key === "name" && busy.charId === char.id}
      locked={locked}
      onChange={(v) =>
        useApp.getState().patchChat(chat.id, (c) => {
          const characters = c.characters.map((x) => (x.id === char.id ? { ...x, name: v } : x));
          return {
            ...c,
            characters,
            imageParams: {
              ...c.imageParams,
              characters: c.imageParams.characters.map((slot) =>
                slot.id === char.id ? { ...slot, name: v } : slot,
              ),
            },
            updatedAt: Date.now(),
          };
        })
      }
      onRegen={() => runField("name", char.id)}
      onPersonal={() => openPersonalize("name", char.id)}
    />
  ) : null;

  const overviewBlock = (
    <FieldBlock
      label="要求总览"
      hint="可空。写了就是最高优先。例如：回复尽量详尽生动，不要简略。"
      value={chat.overview}
      placeholder={PLACEHOLDERS.overview}
      busy={busy?.kind === "field" && busy.key === "overview"}
      locked={locked}
      onChange={(v) => patch({ overview: v })}
      onRegen={() => runField("overview")}
      onPersonal={() => openPersonalize("overview")}
    />
  );

  return (
    <div className="h-full overflow-y-auto px-4 pb-56 pt-3 scroll-thin">
      <div className="mb-1 text-[11px] tracking-[0.14em] text-muted">{mode === "create" ? "NEW ROLE" : "EDIT ROLE"}</div>
      <div className="mb-1 flex items-center gap-1">
        <h1 className={`min-w-0 flex-1 truncate whitespace-nowrap font-semibold leading-tight ${mode === "create" ? "text-[15px]" : "text-[20px]"}`}>
          {mode === "create" ? "写下她，再交给 Grok 补全" : "修改设定"}
        </h1>
        <button type="button" className="grid size-8 shrink-0 place-items-center text-muted" aria-label="复制人设" onClick={() => void copyPersona()}>
          <Copy className="size-4" />
        </button>
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center text-muted"
          aria-label="识别人设"
          onClick={() => {
            setRecognizeText("");
            setRecognizeOpen(true);
          }}
        >
          <SquareArrowUp className="size-4" />
        </button>
      </div>
      {mode === "edit" && (
        <p className="mb-4 text-[12px] text-muted">保存后立刻对之后的对话生效。取消则不改动。</p>
      )}

      <div className="mb-3 flex items-end gap-2">
        <button
          className="inline-flex shrink-0 flex-col items-center gap-0.5 px-1 pb-1.5 text-[10px] text-muted"
          onClick={() => useApp.getState().setUI({ saveCardOpen: true })}
        >
          <Download className="size-3.5" />
          保存为角色卡
        </button>
        <div className="min-w-0 flex-1">
          <CardSelect
            onPick={(id) => {
              const card = cards.find((c) => c.id === id);
              if (card) useApp.getState().applyCard(chat.id, card, chat.isMulti ? charSel : undefined);
            }}
            onEdit={(id) => useApp.getState().setUI({ editCardId: id })}
          />
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 text-[14px]">
        <label className="flex items-center gap-2">
          <span
            className={`grid size-5 place-items-center rounded-full border ${chat.isMulti ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-card"}`}
          >
            {chat.isMulti && <span className="text-[11px] leading-none">✓</span>}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={chat.isMulti}
            onChange={(e) => {
              const on = e.target.checked;
              const characters = on
                ? chat.characters.length >= 2
                  ? chat.characters
                  : [...chat.characters, emptyCharacter(2)]
                : [chat.characters[0] ?? emptyCharacter(1)];
              setCharSel(0);
              syncChars(characters, on);
            }}
          />
          多人
        </label>
        {chat.isMulti && (
          <span className="ml-auto inline-flex items-center gap-1 text-[13px] text-muted">
            人数
            <span className="inline-flex items-center rounded-full border border-line bg-card">
              <button
                type="button"
                className="px-2 py-1"
                onClick={() => {
                  const characters = [...chat.characters, emptyCharacter(chat.characters.length + 1)];
                  syncChars(characters, true);
                }}
              >
                <ChevronUp className="size-3.5" />
              </button>
              <span className="px-2 text-ink">{chat.characters.length}</span>
              <button
                type="button"
                className="px-2 py-1"
                disabled={chat.characters.length <= 2}
                onClick={() => {
                  const characters = chat.characters.slice(0, -1);
                  setCharSel(0);
                  syncChars(characters, true);
                }}
              >
                <ChevronDown className="size-3.5" />
              </button>
            </span>
          </span>
        )}
      </div>

      <Card className="mb-3">
        <FieldLabel>AI 版本</FieldLabel>
        <ChatModelSelect align="left" className="w-full rounded-full border border-line bg-card" />
        <CustomAvatar
          blobId={chat.customAvatarBlobId}
          onId={(id) => patch({ customAvatarBlobId: id })}
          onClear={() => patch({ customAvatarBlobId: "" })}
        />
      </Card>

      {!chat.isMulti && nameBlock}
      {overviewBlock}

      {chat.isMulti && (
        <Card className="mb-3">
          <FieldLabel>角色选择</FieldLabel>
          <ExpandSelect
            value={String(charSel)}
            options={chat.characters.map((c, i) => ({
              id: String(i),
              label: `角色${i + 1}${c.name ? ":" + c.name : ""}`,
            }))}
            onChange={(id) => setCharSel(Number(id))}
            align="left"
          />
        </Card>
      )}

      {char && (
        <div className={chat.isMulti ? "rounded-[22px] border border-line/80 bg-card/50 p-1" : ""}>
          {chat.isMulti && nameBlock}
          <FieldBlock
            label="人设"
            hint="她是谁：性格、职业或身份、口头禅、和我的关系……外貌请写在下面那栏。"
            value={char.persona}
            placeholder={PLACEHOLDERS.persona}
            busy={busy?.kind === "field" && busy.key === "persona" && busy.charId === char.id}
            locked={locked}
            grow={Boolean(char.personaVoices)}
            titleExtra={
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[11px] leading-none transition ${
                  char.personaVoices
                    ? "border-primary bg-primary text-on-primary"
                    : "border-primary bg-transparent text-primary"
                }`}
                disabled={locked}
                onClick={() =>
                  patch({
                    characters: chat.characters.map((c) =>
                      c.id === char.id ? { ...c, personaVoices: !c.personaVoices } : c,
                    ),
                  })
                }
              >
                声部
              </button>
            }
            onChange={(v) =>
              patch({ characters: chat.characters.map((c) => (c.id === char.id ? { ...c, persona: v } : c)) })
            }
            onRegen={() => runField("persona", char.id)}
            onPersonal={() => openPersonalize("persona", char.id)}
          />
          {chat.isMulti ? (
            <div className="mb-3 px-1">
              <CustomAvatar
                blobId={char.wechatAvatarBlobId}
                label="自定义微信头像。不上传就用主聊天的头像"
                onId={(id) =>
                  patch({
                    characters: chat.characters.map((c) => (c.id === char.id ? { ...c, wechatAvatarBlobId: id } : c)),
                  })
                }
                onClear={() =>
                  patch({
                    characters: chat.characters.map((c) => (c.id === char.id ? { ...c, wechatAvatarBlobId: "" } : c)),
                  })
                }
              />
            </div>
          ) : null}
          <FieldBlock
            label="说话方式"
            hint="语气、口癖、人称、句子长短。例如：软软的、会把「……」拖长。"
            value={char.speech}
            placeholder={PLACEHOLDERS.speech}
            busy={busy?.kind === "field" && busy.key === "speech" && busy.charId === char.id}
            locked={locked}
            onChange={(v) =>
              patch({ characters: chat.characters.map((c) => (c.id === char.id ? { ...c, speech: v } : c)) })
            }
            onRegen={() => runField("speech", char.id)}
            onPersonal={() => openPersonalize("speech", char.id)}
          />
          <LookRef
            blobId={char.lookBlobId}
            onPick={async (file) => {
              const blob = await compressRef(file, 768, 0.82);
              const id = await saveBlob(blob);
              patch({
                characters: chat.characters.map((c) => (c.id === char.id ? { ...c, lookBlobId: id } : c)),
              });
            }}
            onBlob={async (blobId) => {
              const blob = await getImage(blobId);
              if (!blob) {
                useApp.getState().toast("这张图已经不在了");
                return;
              }
              const id = await saveBlob(blob);
              patch({
                characters: chat.characters.map((c) => (c.id === char.id ? { ...c, lookBlobId: id } : c)),
              });
            }}
            onClear={() =>
              patch({
                characters: chat.characters.map((c) => (c.id === char.id ? { ...c, lookBlobId: "" } : c)),
              })
            }
          />
          <FieldBlock
            label="外貌备忘"
            hint="用生图提示词书写。发型发色瞳色体型固定服装写这里。其他栏不用再写外貌。"
            value={char.appearance}
            placeholder={PLACEHOLDERS.appearance}
            busy={busy?.kind === "field" && busy.key === "appearance" && busy.charId === char.id}
            locked={locked}
            onChange={(v) =>
              patch({ characters: chat.characters.map((c) => (c.id === char.id ? { ...c, appearance: v } : c)) })
            }
            onRegen={() => runField("appearance", char.id)}
            onPersonal={() => openPersonalize("appearance", char.id)}
          />
        </div>
      )}

      <FieldBlock
        label="开场场景"
        hint="现在在哪里、在做什么、气氛如何。"
        value={chat.opening}
        placeholder={PLACEHOLDERS.opening}
        busy={busy?.kind === "field" && busy.key === "opening"}
        locked={locked}
        onChange={(v) => patch({ opening: v })}
        onRegen={() => runField("opening")}
        onPersonal={() => openPersonalize("opening")}
      />

      <Card className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">状态栏</div>
            <div className="mt-0.5 text-[11px] text-muted">
              关掉就折叠。打开后，每句回复末尾都会更新这份状态。开启内容按固定骨架，可改冒号后的描述。
            </div>
          </div>
          <Switch
            on={chat.statusBarOn}
            onChange={(v) =>
              patch({
                statusBarOn: v,
                statusBar: chat.statusBar?.trim() ? chat.statusBar : DEFAULT_STATUS_BAR,
              })
            }
          />
        </div>
        {chat.statusBarOn && (
          <TextArea
            className="min-h-[200px] font-mono text-[12px]"
            value={chat.statusBar}
            onChange={(e) => patch({ statusBar: e.target.value })}
          />
        )}
      </Card>

      <Extras extras={chat.extras} onChange={(extras) => patch({ extras })} />

      {mode === "edit" && (
        <Card className="mb-3">
          <FieldLabel
            sub={
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span>
                  （已对话 <span className="text-good">{memTurns.spoken}</span> 轮，已总结到第{" "}
                  <span className="text-good">{memTurns.folded}</span> 轮）
                </span>
                {memOk ? <Check className="size-3.5 text-good" /> : <X className="size-3.5 text-danger" />}
              </span>
            }
            hint="聊久了会把更早的剧情压成备忘，下一轮当事实用。聊天里看不见。可改、可重总结、可清空。"
          >
            长期记忆
          </FieldLabel>
          <TextArea
            className="min-h-[120px]"
            value={memoryShown}
            placeholder={memStreaming ? "正在总结…" : "还没有长期记忆。对话变长后会自动整理。"}
            onChange={(e) => {
              if (memStreaming) return;
              const text = e.target.value;
              const snaps = chat.memorySnaps ?? [];
              const last = snaps[snaps.length - 1];
              patch({
                memory: text,
                memorySnaps: last
                  ? [...snaps.slice(0, -1), { ...last, text }]
                  : text
                    ? [{ covered: chat.memoryUntil || 0, text, foldAt: chat.memoryFoldAt || 0 }]
                    : [],
              });
            }}
          />
          <div className="mt-2 flex gap-2">
            <GhostBtn
              className="h-10 w-auto min-w-0 flex-1 whitespace-nowrap px-3 text-[13px]"
              onClick={() => useApp.getState().toast("已保存")}
            >
              保存
            </GhostBtn>
            <GhostBtn
              className="h-10 w-auto min-w-0 flex-1 whitespace-nowrap px-3 text-[13px]"
              onClick={() => {
                if (locked) return;
                if (!memReady) {
                  useApp.getState().toast("还不够长，先多聊几轮");
                  return;
                }
                setMemPick(true);
              }}
            >
              {busy?.kind === "mem" ? "总结中…" : "重新总结"}
            </GhostBtn>
            <GhostBtn
              className="h-10 w-auto min-w-0 flex-1 whitespace-nowrap px-3 text-[13px]"
              onClick={() => {
                invalidateMemory(chat.id);
                patch(emptyMemory());
              }}
            >
              清空
            </GhostBtn>
          </div>
        </Card>
      )}

      <Modal open={memPick} onClose={() => setMemPick(false)} title="重新总结">
        <p className="mb-4 text-[13px] leading-5 text-muted">
          {memOk ? "记忆已经齐了。总结到当前只重压最近那一截。" : "记忆还落后。总结到当前会从缺口一次收到位。"}
        </p>
        <div className="flex flex-col gap-2">
          <PrimaryBtn
            disabled={locked || !memReady}
            busy={busy?.kind === "mem"}
            onClick={async () => {
              if (locked) return;
              setMemPick(false);
              setBusy({ kind: "mem" });
              const ok = await runManualMemory(chat.id, "current");
              if (ok) useApp.getState().toast("已总结到当前");
              setBusy(null);
            }}
          >
            总结到当前
          </PrimaryBtn>
          <GhostBtn
            className="h-11"
            disabled={locked || !memReady}
            onClick={async () => {
              if (locked) return;
              setMemPick(false);
              setBusy({ kind: "mem" });
              const ok = await runManualMemory(chat.id, "all");
              if (ok) useApp.getState().toast("已全部重新总结");
              setBusy(null);
            }}
          >
            全部重新总结
          </GhostBtn>
        </div>
      </Modal>

      <div className="pointer-events-none h-4" />
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-4">
        {mode === "create" && !polished && (
          <>
            <PrimaryBtn
              busy={busy?.kind === "all" || busy?.kind === "field"}
              disabled={locked && busy?.kind !== "all" && busy?.kind !== "field"}
              onClick={() => {
                if (locked) return;
                void runPolish();
              }}
            >
              {busy?.kind === "field" ? (
                `完善中(${fieldBusyLabel})`
              ) : busy?.kind === "all" ? (
                "完善中"
              ) : (
                <>
                  <Sparkles className="size-4" /> 让 Grok 完善设定
                </>
              )}
            </PrimaryBtn>
            <GhostBtn className="mt-2" disabled={locked} onClick={() => void startChat()}>
              跳过，开始聊天
            </GhostBtn>
          </>
        )}
        {mode === "create" && polished && (
          <>
            <PrimaryBtn
              busy={busy?.kind === "field"}
              disabled={locked}
              onClick={() => {
                if (locked) return;
                void startChat();
              }}
            >
              {busy?.kind === "field" ? `完善中(${fieldBusyLabel})` : "可以了，开始聊天"}
            </PrimaryBtn>
            <GhostBtn className="mt-2" disabled={locked && busy?.kind !== "all"} onClick={() => void runPolish()}>
              {busy?.kind === "all" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 完善中
                </>
              ) : (
                "让 Grok 完善设定"
              )}
            </GhostBtn>
            <GhostBtn className="mt-2" disabled={locked && busy?.kind !== "personalize"} onClick={() => openPersonalize("all")}>
              {busy?.kind === "personalize" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 完善中
                </>
              ) : (
                "让 Grok 个性化修改"
              )}
            </GhostBtn>
          </>
        )}
        {mode === "edit" && (
          <>
            <PrimaryBtn
              busy={busy?.kind === "field"}
              disabled={locked}
              onClick={() => {
                if (locked) return;
                void startChat();
              }}
            >
              {busy?.kind === "field" ? `完善中(${fieldBusyLabel})` : "确认保存"}
            </PrimaryBtn>
            <GhostBtn className="mt-2" disabled={locked && busy?.kind !== "all"} onClick={() => void runPolish()}>
              {busy?.kind === "all" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 完善中
                </>
              ) : (
                "让 Grok 完善设定"
              )}
            </GhostBtn>
            <GhostBtn className="mt-2" disabled={locked && busy?.kind !== "personalize"} onClick={() => openPersonalize("all")}>
              {busy?.kind === "personalize" ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 完善中
                </>
              ) : (
                "让 Grok 个性化修改"
              )}
            </GhostBtn>
            <button
              className="mt-2 w-full py-2 text-[13px] text-muted"
              onClick={() => useApp.getState().cancelEdit()}
            >
              取消
            </button>
          </>
        )}
        {mode === "create" && (
          <button
            className="mt-2 w-full py-2 text-[13px] text-muted"
            onClick={() => useApp.getState().cancelDraft()}
          >
            取消
          </button>
        )}
      </div>
      <Modal open={recognizeOpen} onClose={() => setRecognizeOpen(false)} title="识别人设">
        <p className="mb-3 text-[12px] leading-relaxed text-muted">
          按标题拆开。一行写「名字」「要求总览」「人设」「说话方式」「外貌备忘」或「开场场景」，也可以写成「名字：」或「【名字】」。对不上的不改。
        </p>
        <TextArea value={recognizeText} onChange={(e) => setRecognizeText(e.target.value)} placeholder="把人设贴在这里" />
        <PrimaryBtn className="mt-3" onClick={applyRecognized}>
          填入
        </PrimaryBtn>
      </Modal>
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onRegen,
  onPersonal,
  busy,
  locked,
  single,
  titleExtra,
  grow,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onRegen: () => void;
  onPersonal: () => void;
  busy?: boolean;
  locked?: boolean;
  single?: boolean;
  titleExtra?: ReactNode;
  grow?: boolean;
}) {
  return (
    <Card className="mb-3">
      <FieldLabel
        hint={hint}
        right={
          <span className="flex gap-1">
            <button
              className="grid size-8 place-items-center rounded-full hover:bg-dim disabled:opacity-40"
              onClick={onRegen}
              disabled={locked}
              title="重新生成"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-muted" />}
            </button>
            <button
              className="grid size-8 place-items-center rounded-full hover:bg-dim disabled:opacity-40"
              onClick={onPersonal}
              disabled={locked}
              title="个性化"
            >
              <Sparkles className="size-4 text-muted" />
            </button>
          </span>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          {label}
          {titleExtra}
        </span>
      </FieldLabel>
      {single ? (
        <TextInput value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <TextArea
          value={value}
          placeholder={placeholder}
          rows={grow ? 12 : 5}
          className={grow ? "min-h-[calc(1.5rem+12*1.625em)]" : "min-h-[calc(1.5rem+5*1.625em)]"}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Card>
  );
}

function clampCrop(
  scale: number,
  ox: number,
  oy: number,
  sMin: number,
  sMax: number,
  diameter: number,
  natW: number,
  natH: number,
) {
  const s = Math.min(sMax, Math.max(sMin, scale));
  const limX = Math.max(0, (natW * s - diameter) / 2);
  const limY = Math.max(0, (natH * s - diameter) / 2);
  return {
    scale: s,
    ox: Math.min(limX, Math.max(-limX, ox)),
    oy: Math.min(limY, Math.max(-limY, oy)),
  };
}

function AvatarCrop({ src, onCancel, onDone }: { src: string; onCancel: () => void; onDone: (blob: Blob) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ scale: number; ox: number; oy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ ox: number; oy: number; scale: number; x: number; y: number; dist: number; mx: number; my: number } | null>(null);

  const diameter = Math.min(box.w, box.h) * 0.78;
  const ready = nat.w > 0 && diameter > 0;
  const sMin = ready ? Math.max(diameter / nat.w, diameter / nat.h) : 1;
  const sMax = sMin * 4;
  const shown = view ?? { scale: sMin, ox: 0, oy: 0 };
  const viewRef = useRef(shown);
  viewRef.current = shown;
  const geo = useRef({ sMin, sMax, diameter, natW: nat.w, natH: nat.h });
  geo.current = { sMin, sMax, diameter, natW: nat.w, natH: nat.h };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setView((v) => {
      const g = geo.current;
      if (!v || !g.natW || !g.diameter) return v;
      const next = clampCrop(v.scale, v.ox, v.oy, g.sMin, g.sMax, g.diameter, g.natW, g.natH);
      if (next.scale === v.scale && next.ox === v.ox && next.oy === v.oy) return v;
      viewRef.current = next;
      return next;
    });
  }, [box.w, box.h, nat.w, nat.h]);

  const apply = (scale: number, ox: number, oy: number) => {
    const g = geo.current;
    const next = clampCrop(scale, ox, oy, g.sMin, g.sMax, g.diameter, g.natW, g.natH);
    viewRef.current = next;
    setView(next);
  };

  const begin = () => {
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      gesture.current = {
        ox: v.ox,
        oy: v.oy,
        scale: v.scale,
        x: 0,
        y: 0,
        dist,
        mx: (pts[0].x + pts[1].x) / 2,
        my: (pts[0].y + pts[1].y) / 2,
      };
    } else if (pts.length === 1) {
      gesture.current = { ox: v.ox, oy: v.oy, scale: v.scale, x: pts[0].x, y: pts[0].y, dist: 0, mx: pts[0].x, my: pts[0].y };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e: PE<HTMLDivElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    begin();
  };

  const onPointerMove = (e: PE<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const scale = g.scale * (dist / g.dist);
      const k = scale / g.scale;
      apply(scale, g.ox * k + (mx - g.mx), g.oy * k + (my - g.my));
    } else {
      apply(g.scale, g.ox + (e.clientX - g.x), g.oy + (e.clientY - g.y));
    }
  };

  const onPointerUp = (e: PE<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    begin();
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!geo.current.natW) return;
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06;
      const g = geo.current;
      const next = clampCrop(v.scale * factor, v.ox * factor, v.oy * factor, g.sMin, g.sMax, g.diameter, g.natW, g.natH);
      viewRef.current = next;
      setView(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const finish = () => {
    const img = imgRef.current;
    const g = geo.current;
    if (!img || !g.natW || !g.diameter || busy) return;
    setBusy(true);
    const { scale, ox, oy } = viewRef.current;
    const dw = g.natW * scale;
    const dh = g.natH * scale;
    const sw = g.diameter / scale;
    const sh = g.diameter / scale;
    const sx = Math.max(0, Math.min(g.natW - sw, ((dw - g.diameter) / 2 - ox) / scale));
    const sy = Math.max(0, Math.min(g.natH - sh, ((dh - g.diameter) / 2 - oy) / scale));
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 512, 512);
    canvas.toBlob((blob) => {
      if (!blob) {
        setBusy(false);
        return;
      }
      onDone(blob);
    }, "image/jpeg", 0.9);
  };

  const dw = nat.w * shown.scale;
  const dh = nat.h * shown.scale;
  const cx = box.w / 2;
  const cy = box.h / 2;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex shrink-0 items-center px-1 pt-[max(8px,env(safe-area-inset-top))]">
        <button type="button" className="grid size-11 place-items-center" aria-label="返回" onClick={onCancel}>
          <ChevronLeft className="size-6" />
        </button>
        <div className="flex-1 text-center text-[16px]">移动和缩放</div>
        <div className="size-11" />
      </div>
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={onCancel}
          className="absolute max-w-none select-none"
          style={{
            width: dw || undefined,
            height: dh || undefined,
            left: cx + shown.ox - dw / 2,
            top: cy + shown.oy - dh / 2,
            opacity: ready ? 1 : 0,
          }}
        />
        {ready ? (
          <div
            className="pointer-events-none absolute rounded-full border border-white/90"
            style={{
              width: diameter,
              height: diameter,
              left: cx - diameter / 2,
              top: cy - diameter / 2,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            }}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          className="rounded-full bg-primary px-6 py-2 text-[15px] text-on-primary disabled:opacity-40"
          disabled={!ready || busy}
          onClick={finish}
        >
          完成
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function CustomAvatar({
  blobId,
  onId,
  onClear,
  label = "自定义头像。不上传就用第一张生成的图",
}: {
  blobId?: string;
  onId: (id: string) => void;
  onClear: () => void;
  label?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<string | null>(null);
  useEffect(() => {
    if (!blobId) {
      setUrl(null);
      return;
    }
    let dead = false;
    void imageUrl(blobId).then((u) => {
      if (!dead) setUrl(u);
    });
    return () => {
      dead = true;
    };
  }, [blobId]);
  useEffect(() => {
    return () => {
      if (crop) URL.revokeObjectURL(crop);
    };
  }, [crop]);
  const openCrop = (blob: Blob) => {
    setCrop((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
  };
  return (
    <div className="mt-3 flex items-center gap-2">
      {url ? (
        <div className="relative">
          <ZoomImg src={url} className="size-16 rounded-full object-cover" />
          <button
            type="button"
            className="absolute -right-1 -top-1 z-10 grid size-5 place-items-center rounded-full bg-card text-ink"
            aria-label="去掉自定义头像"
            onClick={onClear}
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <ImagePick
          onFile={(file) => openCrop(file)}
          onBlob={async (id) => {
            const blob = await getImage(id);
            if (!blob) {
              useApp.getState().toast("这张图已经不在了");
              return;
            }
            openCrop(blob);
          }}
          render={(open) => (
            <button
              type="button"
              className="grid size-9 place-items-center rounded-full border border-line text-muted"
              aria-label="上传自定义头像"
              onClick={open}
            >
              <Plus className="size-4" />
            </button>
          )}
        />
      )}
      <span className="text-[12px] text-muted">{label}</span>
      {crop ? (
        <AvatarCrop
          src={crop}
          onCancel={() => setCrop(null)}
          onDone={(blob) => {
            void saveBlob(blob).then(onId);
            setCrop(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function LookRef({
  blobId,
  onPick,
  onBlob,
  onClear,
}: {
  blobId?: string;
  onPick: (file: File) => void;
  onBlob: (blobId: string) => void | Promise<void>;
  onClear: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blobId) {
      setUrl(null);
      return;
    }
    let dead = false;
    void imageUrl(blobId).then((u) => {
      if (!dead) setUrl(u);
    });
    return () => {
      dead = true;
    };
  }, [blobId]);
  return (
    <div className="mb-3 flex items-center gap-2 px-1">
      {url ? (
        <div className="relative">
          <ZoomImg src={url} className="size-16 rounded-[12px] object-cover" />
          <button
            type="button"
            className="absolute -right-1 -top-1 z-10 grid size-5 place-items-center rounded-full bg-card text-ink"
            aria-label="去掉外貌备忘"
            onClick={onClear}
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <ImagePick
          onFile={onPick}
          onBlob={onBlob}
          render={(open) => (
            <button
              type="button"
              className="grid size-9 place-items-center rounded-full border border-line text-muted"
              aria-label="上传外貌备忘"
              onClick={open}
            >
              <Plus className="size-4" />
            </button>
          )}
        />
      )}
      <span className="text-[12px] text-muted">外貌备忘的样子，只给聊天看</span>
    </div>
  );
}

export function Extras({ extras, onChange }: { extras: ExtraField[]; onChange: (e: ExtraField[]) => void }) {
  return (
    <div className="mb-3">
      {extras.map((e, i) => (
        <Card key={e.id} className="mb-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[13px] font-medium">新增{i + 1}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[11px] leading-none transition ${
                  e.emphasize
                    ? "border-primary bg-primary text-on-primary"
                    : "border-primary bg-transparent text-primary"
                }`}
                onClick={() =>
                  onChange(extras.map((x) => (x.id === e.id ? { ...x, emphasize: !x.emphasize } : x)))
                }
              >
                强调
              </button>
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[11px] leading-none transition ${
                  e.applyImage
                    ? "border-primary bg-primary text-on-primary"
                    : "border-primary bg-transparent text-primary"
                }`}
                onClick={() =>
                  onChange(extras.map((x) => (x.id === e.id ? { ...x, applyImage: !x.applyImage } : x)))
                }
              >
                应用到生图
              </button>
              <button className="text-danger" onClick={() => onChange(extras.filter((x) => x.id !== e.id))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
          <TextArea
            value={e.body}
            onChange={(ev) => onChange(extras.map((x) => (x.id === e.id ? { ...x, body: ev.target.value } : x)))}
          />
        </Card>
      ))}
      <button
        className="flex items-center gap-1 px-2 py-2 text-[13px] text-primary"
        onClick={() => onChange([...extras, { id: uid("ex_"), body: "" }])}
      >
        <Plus className="size-4" /> 新增
      </button>
    </div>
  );
}

function CardSelect({ onPick, onEdit }: { onPick: (id: string) => void; onEdit: (id: string) => void }) {
  const cards = useApp((s) => s.cards);
  const ordered = cards.slice().sort((a, b) => a.order - b.order);
  return (
    <LibraryDrawer
      className="flex-1"
      label="角色卡选择"
      items={ordered.map((c) => ({ id: c.id, name: c.name }))}
      onApply={onPick}
      onEdit={onEdit}
      onDelete={(id) => useApp.getState().deleteCard(id)}
      onReorder={(ids) => useApp.getState().reorderCards(ids)}
    />
  );
}
