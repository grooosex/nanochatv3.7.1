import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Download, FileUp, Lock, Pencil, RotateCcw, Settings, Star, Trash2, Upload, X } from "lucide-react";
import { DEFAULT_NAI_BASE, shortModelLabel } from "@/lib/constants";
import { exportArchive, importArchive } from "@/lib/archive";
import { fetchLlmModels } from "@/lib/grok-client";
import { applyLlmPick, pruneStarred, snapshotLlmAccount } from "@/lib/llm-models";
import { llmIdentity } from "@/lib/image-ai";
import { useApp } from "@/lib/store";
import { cn, uid, uniqueNumberedName } from "@/lib/utils";
import type { LlmAccount, LlmParams, StPreset, StPromptItem } from "@/lib/types";
import {
  defaultSampler,
  parseChatCompletionPreset,
  restoreSampler,
  samplerPatch,
  sealPreset,
  uniquePresetName,
} from "@/lib/st-preset";
import { GhostBtn, Modal, PrimaryBtn, Slider, Switch, TextArea, TextInput } from "./ui-kit";
import { NAI_OFFICIAL_BASE } from "@/lib/nai";

export function ConnectionPanel() {
  const open = useApp((s) => s.ui.connection);
  const settings = useApp((s) => s.settings);
  const setUI = useApp((s) => s.setUI);
  const [dl, setDl] = useState(false);
  const [page, setPage] = useState<null | "chat" | "image" | "preset">(null);
  const llmSettings = useApp((s) => s.ui.llmSettings);
  useEffect(() => {
    if (!open || !llmSettings) return;
    setPage("chat");
    useApp.getState().setUI({ llmSettings: false });
  }, [open, llmSettings]);
  useEffect(() => {
    if (!open) setPage(null);
  }, [open]);
  if (!open) return null;

  const close = () => {
    setPage(null);
    setUI({ connection: false });
  };

  return (
    <div className="absolute inset-0 z-50 flex justify-center px-4 py-8">
      <div className="absolute inset-0 bg-overlay/40" />
      <SheetCard
        title="设置"
        titleExtra={
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Switch
              on={settings.chatImage !== false}
              onChange={(v) => {
                useApp.getState().setSettings({ chatImage: v });
              }}
              label="生图"
            />
            生图
          </span>
        }
        onClose={close}
      >
        <div className="mb-4 grid grid-cols-2 gap-3">
          <button
            className="flex flex-col items-center gap-2 rounded-[18px] border border-line bg-card py-5"
            onClick={() => setDl(true)}
          >
            <Download className="size-6" />
            <span className="text-[13px]">下载存档</span>
          </button>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[18px] border border-line bg-card py-5">
            <Upload className="size-6" />
            <span className="text-[13px]">读取存档</span>
            <input
              type="file"
              accept=".json,.zip"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  await importArchive(f);
                  await useApp.getState().hydrate();
                  useApp.getState().toast("已读取存档");
                  close();
                } catch (err) {
                  useApp.getState().toast(err instanceof Error ? err.message : "读取失败");
                }
              }}
            />
          </label>
        </div>

        <GearRow label="聊天补全 AI" onClick={() => setPage("chat")} />
        <GearRow label="生图 AI" onClick={() => setPage("image")} />
        <GearRow label="预设设置" onClick={() => setPage("preset")} />
      </SheetCard>
      <Modal open={dl} onClose={() => setDl(false)} title="下载存档">
        <p className="mb-4 text-[13px] text-muted">全部含配图。部分配图留下你上传的头像、表情包、收藏和照片，不含生成图。无配图可再次点重生。</p>
        <div className="flex flex-col gap-2">
          <PrimaryBtn
            onClick={() => {
              void exportArchive("full");
              setDl(false);
            }}
          >
            全部
          </PrimaryBtn>
          <GhostBtn
            onClick={() => {
              void exportArchive("partial");
              setDl(false);
            }}
          >
            部分配图
          </GhostBtn>
          <GhostBtn
            onClick={() => {
              void exportArchive("lite");
              setDl(false);
            }}
          >
            无配图
          </GhostBtn>
        </div>
      </Modal>
      {page && (
        <div className="absolute inset-0 z-20 flex justify-center px-4 py-8">
          <button type="button" className="absolute inset-0 bg-overlay/40" onClick={() => setPage(null)} aria-label="返回" />
          {page === "chat" && <ChatAiSheet onClose={() => setPage(null)} />}
          {page === "image" && <ImageAiSheet onClose={() => setPage(null)} />}
          {page === "preset" && <PresetSheet onClose={() => setPage(null)} />}
        </div>
      )}
    </div>
  );
}

function SheetCard({
  title,
  titleExtra,
  onClose,
  children,
}: {
  title: string;
  titleExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative z-10 flex min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[28px] bg-bg shadow-2xl">
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
        <h2 className="text-[20px] font-semibold">{title}</h2>
        {titleExtra}
        <button type="button" className="ml-auto" onClick={onClose} aria-label="关闭">
          <X className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 scroll-hide">{children}</div>
    </div>
  );
}

function GearRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 flex w-full items-center justify-between rounded-[18px] border border-line bg-card px-4 py-4 text-left active:bg-dim"
    >
      <span className="text-[15px]">{label}</span>
      <Settings className="size-5 text-muted" />
    </button>
  );
}

function ChatAiSheet({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const [url, setUrl] = useState(settings.llmBase);
  const [key, setKey] = useState(settings.llmKey);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showApi, setShowApi] = useState(settings.chatSource === "api");

  useEffect(() => {
    setUrl(settings.llmBase);
    setKey(settings.llmKey);
    setErr("");
  }, [settings.llmBase, settings.llmKey]);

  const connect = async (override?: {
    url?: string;
    key?: string;
    toast?: string;
    starred?: string[];
    model?: string;
  }) => {
    const u = (override?.url ?? url).trim();
    const k = override?.key ?? key;
    setBusy(true);
    setErr("");
    try {
      const list = await fetchLlmModels(u, k);
      const live = useApp.getState().settings;
      const preferred = override?.model || live.llmModel;
      const nextModel = preferred || list[0] || "";
      const keepStars = override?.starred ?? live.llmStarred;
      const starred = list.length ? pruneStarred(keepStars, list, nextModel) : [...new Set(keepStars)];
      const nextIdentity = llmIdentity(u, k);
      const prevIdentity = live.llmIdentity || (live.llmConnected ? llmIdentity(live.llmBase, live.llmKey) : "");
      useApp.getState().setSettings({
        llmBase: u,
        llmKey: k,
        llmConnected: true,
        llmModels: list,
        llmModel: nextModel,
        llmStarred: starred,
        chatSource: "api",
        llmAccounts: snapshotLlmAccount(live.llmAccounts ?? [], u, k, starred, nextModel),
        llmIdentity: nextIdentity,
      });
      if (prevIdentity && prevIdentity !== nextIdentity) useApp.getState().clearImageAi();
      useApp.getState().toast(
        override?.toast ?? (list.length ? `已连接 · ${list.length} 个模型` : "已连接，请手填模型名"),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "连接失败");
      useApp.getState().setSettings({ llmBase: u, llmKey: k, llmConnected: false });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    useApp.getState().setSettings({
      llmConnected: false,
      llmKey: "",
      chatSource: "grok",
    });
    setKey("");
    useApp.getState().toast("已断开 API");
  };

  const saveAccount = () => {
    const name = uniqueNumberedName(
      saveName,
      (settings.llmAccounts ?? []).map((a) => a.name),
    );
    if (!saveName.trim()) {
      useApp.getState().toast("请输入名称");
      return;
    }
    useApp.getState().setSettings({
      llmAccounts: [
        ...(settings.llmAccounts ?? []),
        {
          id: uid("acc_"),
          name,
          base: url.trim(),
          key,
          starred: [...settings.llmStarred],
          model: settings.llmModel,
        },
      ],
    });
    useApp.getState().toast(`已保存（${name}）`);
    setSaveOpen(false);
    setSaveName("");
  };

  return (
    <SheetCard title="聊天补全 AI" onClose={onClose}>
      <button
        type="button"
        onClick={() => {
          setShowApi(false);
          useApp.getState().setSettings({ chatSource: "grok" });
        }}
        className={cn(
          "mb-3 w-full rounded-[18px] border p-4 text-left",
          settings.chatSource === "grok" ? "border-primary bg-primary-soft" : "border-line bg-card",
        )}
      >
        <div className="mb-1 font-medium">Grok</div>
        <p className="text-[12px] leading-relaxed text-muted">
          已使用当前 Grok 会员账号，无需再登录。选中后聊天、润色、写提示词都走 Grok。顶栏切换 4.7 / 4.6 / 4.5 均衡、专家、快速。
        </p>
      </button>
      <button
        type="button"
        onClick={() => {
          setShowApi(true);
          if (settings.llmConnected) useApp.getState().setSettings({ chatSource: "api" });
        }}
        className={cn(
          "mb-4 flex w-full items-center gap-3 rounded-[18px] border p-4 text-left",
          showApi || settings.chatSource === "api" ? "border-primary bg-primary-soft" : "border-line bg-card",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">API 连接</div>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {settings.llmConnected
              ? settings.llmModel
                ? shortModelLabel(settings.llmModel)
                : "已连接"
              : "未连接"}
          </p>
        </div>
        {settings.llmConnected && settings.chatSource === "api" ? <Check className="size-5 shrink-0 text-good" /> : null}
      </button>
      {showApi ? (
        <>
      <div className="mb-1 flex items-center justify-between text-[14px] font-medium">
        <span>网址</span>
        <button
          type="button"
          className="text-[12px] font-normal text-muted"
          onClick={() => {
            if (!url.trim() || !key.trim()) {
              useApp.getState().toast("请填写网址和密钥");
              return;
            }
            setSaveName("");
            setSaveOpen(true);
          }}
        >
          保存
        </button>
      </div>
      <TextInput
        value={url}
        placeholder="https://api.siliconflow.cn/v1"
        onChange={(e) => setUrl(e.target.value)}
      />
      <p className="mb-3 mt-1 text-[11px] text-muted">OpenAI 兼容。末尾 /v1 即可，不必写到 chat/completions。</p>
      <AccountPicker
        accounts={settings.llmAccounts ?? []}
        keyValue={key}
        onKeyChange={setKey}
        busy={busy}
        exit={
          settings.llmConnected ? (
            <button type="button" className="text-[12px] text-muted" onClick={disconnect}>
              退出
            </button>
          ) : null
        }
        onPick={(a) => {
          const s = useApp.getState().settings;
          if (s.llmBase || s.llmKey) {
            useApp.getState().setSettings({
              llmAccounts: snapshotLlmAccount(s.llmAccounts ?? [], s.llmBase, s.llmKey, s.llmStarred, s.llmModel),
            });
          }
          setUrl(a.base);
          setKey(a.key);
          void connect({
            url: a.base,
            key: a.key,
            starred: a.starred,
            model: a.model,
            toast: `已应用密钥（${a.name}）`,
          });
        }}
        onDelete={(id) =>
          useApp.getState().setSettings({
            llmAccounts: (settings.llmAccounts ?? []).filter((a) => a.id !== id),
          })
        }
      />
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      <PrimaryBtn
        className={cn("mt-3", settings.llmConnected && "bg-good hover:bg-good")}
        busy={busy}
        onClick={() => void connect()}
      >
        {settings.llmConnected ? "已连接 · 重新拉取" : "连接"}
      </PrimaryBtn>

      <div className="mt-5 mb-1 text-[14px] font-medium">可用模型</div>
      <p className="mb-2 text-[11px] text-muted">列表来自接口。点选即当前模型，星标会进聊天顶栏。</p>
      <ModelPicker
        models={settings.llmModels}
        current={settings.llmModel}
        starred={settings.llmStarred}
        connected={settings.llmConnected}
        onPick={(id) => {
          useApp.getState().setSettings(applyLlmPick(settings, id));
        }}
        onStar={(id) => {
          const on = settings.llmStarred.includes(id);
          const next = on ? settings.llmStarred.filter((x) => x !== id) : [...settings.llmStarred, id];
          const llmStarred = pruneStarred(next, settings.llmModels, settings.llmModel);
          useApp.getState().setSettings({
            llmStarred,
            llmAccounts: snapshotLlmAccount(
              settings.llmAccounts ?? [],
              settings.llmBase,
              settings.llmKey,
              llmStarred,
              settings.llmModel,
            ),
          });
        }}
      />
      {settings.llmConnected && settings.llmModels.length === 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[13px]">手填模型名</div>
          <div className="flex gap-2">
            <TextInput value={manual} placeholder="deepseek-ai/DeepSeek-V3.2" onChange={(e) => setManual(e.target.value)} />
            <button
              type="button"
              className="shrink-0 rounded-full bg-primary px-4 text-[13px] text-on-primary"
              onClick={() => {
                const id = manual.trim();
                if (!id) return;
                useApp.getState().setSettings({
                  llmModel: id,
                  llmModels: [id],
                  llmStarred: settings.llmStarred.includes(id) ? settings.llmStarred : [...settings.llmStarred, id],
                });
              }}
            >
              使用
            </button>
          </div>
        </div>
      )}
      <p className="mt-2 text-[12px] text-muted">
        当前：{settings.llmModel ? shortModelLabel(settings.llmModel) : "未选"} · 常用{" "}
        {pruneStarred(settings.llmStarred, settings.llmModels, settings.llmModel).length}
      </p>
        </>
      ) : null}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="保存账号">
        <TextInput
          value={saveName}
          placeholder="给这组起个名字"
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveAccount();
          }}
        />
        <PrimaryBtn className="mt-4" onClick={saveAccount}>
          保存
        </PrimaryBtn>
      </Modal>
    </SheetCard>
  );
}

function presetUses(s: { stUseChat?: boolean; stUseImage?: boolean; stUseWechat?: boolean }) {
  return { chat: Boolean(s.stUseChat), image: Boolean(s.stUseImage), wechat: Boolean(s.stUseWechat) };
}

function writePresetUse(
  id: string | null,
  use: { chat: boolean; image: boolean; wechat: boolean },
  extra?: { llmParams?: ReturnType<typeof samplerPatch>; stParamSnapshot?: ReturnType<typeof samplerPatch> | null },
) {
  useApp.getState().setSettings({
    stPresetId: id,
    stUseChat: use.chat,
    stUseImage: use.image,
    stUseWechat: use.wechat,
    stActiveId: use.chat ? id : null,
    stImageActiveId: use.image ? id : null,
    stWechatActiveId: use.wechat ? id : null,
    ...extra,
  });
}

function applyStPreset(preset: StPreset) {
  const s = useApp.getState().settings;
  const use = presetUses(s);
  const none = !use.chat && !use.image && !use.wechat;
  writePresetUse(preset.id, none ? { chat: true, image: false, wechat: false } : use, {
    stParamSnapshot: s.stParamSnapshot ?? { ...s.llmParams },
    llmParams: samplerPatch(preset.params, s.llmParams),
  });
  useApp.getState().toast(`已应用预设（${preset.name}）`);
}

function cancelStPreset() {
  const s = useApp.getState().settings;
  writePresetUse(s.stPresetId ?? null, { chat: false, image: false, wechat: false }, {
    stParamSnapshot: null,
    llmParams: restoreSampler(s.stParamSnapshot, s.llmParams),
  });
  useApp.getState().toast("已取消预设");
}

function setPresetUse(part: "chat" | "image" | "wechat", on: boolean) {
  const s = useApp.getState().settings;
  const id = s.stPresetId ?? null;
  if (on && !id) {
    useApp.getState().toast("先选择一份预设");
    return;
  }
  const use = presetUses(s);
  use[part] = on;
  const anyBefore = Boolean(s.stUseChat || s.stUseImage || s.stUseWechat);
  const any = use.chat || use.image || use.wechat;
  const preset = (s.stPresets ?? []).find((p) => p.id === id);
  if (on && !anyBefore && preset) {
    writePresetUse(id, use, {
      stParamSnapshot: s.stParamSnapshot ?? { ...s.llmParams },
      llmParams: samplerPatch(preset.params, s.llmParams),
    });
    return;
  }
  if (!any) {
    writePresetUse(id, use, {
      stParamSnapshot: null,
      llmParams: restoreSampler(s.stParamSnapshot, s.llmParams),
    });
    return;
  }
  writePresetUse(id, use);
}

function deleteStPreset(id: string) {
  const s = useApp.getState().settings;
  const next = (s.stPresets ?? []).filter((x) => x.id !== id);
  const was = s.stPresetId === id || s.stActiveId === id || s.stImageActiveId === id || s.stWechatActiveId === id;
  if (!was) {
    useApp.getState().setSettings({ stPresets: next });
    return;
  }
  writePresetUse(null, { chat: false, image: false, wechat: false }, {
    stParamSnapshot: null,
    llmParams: restoreSampler(s.stParamSnapshot, s.llmParams),
  });
  useApp.getState().setSettings({ stPresets: next });
  useApp.getState().toast("已取消预设");
}

function ChatPresetPicker() {
  const settings = useApp((s) => s.settings);
  const presets = settings.stPresets ?? [];
  const activeId = settings.stPresetId ?? null;
  const active = presets.find((p) => p.id === activeId) ?? null;
  const applied = Boolean(active && (settings.stUseChat || settings.stUseImage || settings.stUseWechat));
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(r.width, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const top = r.bottom + 4;
    const maxH = Math.min(260, Math.max(120, window.innerHeight - top - 12));
    setPos({ top, left, width, maxH });
  };

  const openMenu = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    place();
    let start: { x: number; y: number } | null = null;
    let downOutside = false;
    let moved = false;
    const inChrome = (t: EventTarget | null) => {
      const n = t as Node | null;
      return Boolean(n && (box.current?.contains(n) || menu.current?.contains(n)));
    };
    const onDown = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY };
      downOutside = !inChrome(e.target);
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 10) moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (downOutside && !moved && !inChrome(e.target)) setOpen(false);
      start = null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const importFile = async (file: File) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      useApp.getState().toast("无法读取这个文件");
      return;
    }
    try {
      const parsed = parseChatCompletionPreset(raw, file.name);
      const s = useApp.getState().settings;
      const name = uniquePresetName(
        parsed.name,
        (s.stPresets ?? []).map((p) => p.name),
      );
      useApp.getState().setSettings({ stPresets: [...(s.stPresets ?? []), { ...parsed, name }] });
      useApp.getState().toast(`已导入 ${name}，点列表应用`);
    } catch (e) {
      useApp.getState().toast(e instanceof Error ? e.message : "这不是对话补全预设");
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[14px] font-medium">预设版本</div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center text-muted"
          aria-label="导入预设"
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="size-4" />
        </button>
        {applied ? (
          <span className="flex shrink-0 items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1 text-good">
              <Check className="size-3.5" />
              已应用
            </span>
            <button type="button" className="text-muted" onClick={cancelStPreset}>
              取消
            </button>
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-danger">
            <X className="size-3.5" />
            未应用
          </span>
        )}
      </div>
      <div ref={box} className="relative">
        <div className="flex h-11 items-center rounded-full border border-line bg-card pl-4 pr-1">
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-[13px]"
            onClick={() => (open ? setOpen(false) : openMenu())}
          >
            <span className={active ? "text-ink" : "text-muted"}>{active ? active.name : "未选择"}</span>
          </button>
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center text-muted"
            aria-label={open ? "收起预设列表" : "展开预设列表"}
            onClick={() => (open ? setOpen(false) : openMenu())}
          >
            <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
          </button>
        </div>
        {open && (
          <div
            ref={menu}
            className="mt-1 max-h-60 overflow-auto overscroll-contain rounded-[16px] border border-line bg-card shadow-[0_16px_40px_rgb(44_40_36/0.16)] scroll-hide"
          >
            {presets.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px] text-muted">还没有导入的预设</p>
                ) : (
                  presets.map((p) => (
                    <div key={p.id} className="flex items-center gap-1 border-b border-line/70 last:border-0">
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 truncate px-3 py-3 text-left text-[13px]",
                          p.id === active?.id && "text-primary",
                        )}
                        onClick={() => {
                          applyStPreset(p);
                          setOpen(false);
                        }}
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        className="grid size-10 shrink-0 place-items-center text-danger"
                        aria-label={`删除${p.name}`}
                        onClick={() => deleteStPreset(p.id)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))
                )}
          </div>
        )}
      </div>
    </div>
  );
}

async function naiProbe(body: Record<string, unknown>) {
  let j: { ok?: boolean; error?: string };
  try {
    const r = await fetch("/api/nai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    j = (await r.json()) as { ok?: boolean; error?: string };
  } catch {
    throw new Error("无法连接");
  }
  if (!j.ok) throw new Error(j.error || "连接失败");
}

function ImageAiSheet({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const source = settings.naiImageSource === "official" ? "official" : "proxy";
  const [tab, setTab] = useState<"proxy" | "official">(source);
  const [base, setBase] = useState(settings.naiBase || DEFAULT_NAI_BASE);
  const [key, setKey] = useState(settings.naiKey);
  const [officialKey, setOfficialKey] = useState(settings.naiOfficialKey ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setBase(settings.naiBase || DEFAULT_NAI_BASE);
    setKey(settings.naiKey);
    setOfficialKey(settings.naiOfficialKey ?? "");
  }, [settings.naiBase, settings.naiKey, settings.naiOfficialKey]);

  const connectProxy = async () => {
    const b = base.trim() || DEFAULT_NAI_BASE;
    const k = key.trim();
    if (!k) {
      useApp.getState().toast("请填写中转站密钥");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await naiProbe({ action: "test", baseUrl: b, apiKey: k });
      useApp.getState().setSettings({
        naiBase: b,
        naiKey: k,
        naiConnected: true,
        naiOfficialConnected: false,
        naiImageSource: "proxy",
      });
      useApp.getState().toast("已连接中转站");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "连接失败";
      setErr(msg);
      useApp.getState().setSettings({ naiBase: b, naiKey: k, naiConnected: false });
    } finally {
      setBusy(false);
    }
  };

  const connectOfficial = async () => {
    const k = officialKey.trim().replace(/^Bearer\s+/i, "");
    if (!k) {
      useApp.getState().toast("请填写 Persistent Token");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await naiProbe({ action: "official-test", apiKey: k });
      useApp.getState().setSettings({
        naiOfficialKey: k,
        naiOfficialConnected: true,
        naiConnected: false,
        naiImageSource: "official",
      });
      setOfficialKey(k);
      useApp.getState().toast("已连接官网");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "连接失败";
      setErr(msg);
      useApp.getState().setSettings({ naiOfficialKey: k, naiOfficialConnected: false });
    } finally {
      setBusy(false);
    }
  };

  const proxyOn = Boolean(settings.naiConnected && tab === "proxy" && source === "proxy");
  const officialOn = Boolean(settings.naiOfficialConnected && tab === "official" && source === "official");
  const liveOther = tab !== source && (source === "official" ? settings.naiOfficialConnected : settings.naiConnected);

  return (
    <SheetCard title="生图 AI" onClose={onClose}>
      <div className="mb-4 flex rounded-full bg-dim p-1 text-[13px]">
        <button
          type="button"
          className={cn("flex-1 rounded-full py-2", tab === "proxy" && "bg-card")}
          onClick={() => {
            setErr("");
            setTab("proxy");
          }}
        >
          中转站
        </button>
        <button
          type="button"
          className={cn("flex-1 rounded-full py-2", tab === "official" && "bg-card")}
          onClick={() => {
            setErr("");
            setTab("official");
          }}
        >
          官网 API
        </button>
      </div>
      {tab === "proxy" ? (
        <>
          <div className="mb-1 text-[14px] font-medium">中转站地址</div>
          <TextInput
            value={base}
            placeholder={DEFAULT_NAI_BASE}
            onChange={(e) => {
              const v = e.target.value;
              setBase(v);
              const s = useApp.getState().settings;
              useApp.getState().setSettings({
                naiBase: v,
                naiConnected: Boolean(s.naiConnected && v === s.naiBase),
              });
            }}
          />
          <div className="mb-1 mt-3 text-[14px] font-medium">中转站 API Key</div>
          <TextInput
            type="password"
            value={key}
            onChange={(e) => {
              const v = e.target.value;
              setKey(v);
              const s = useApp.getState().settings;
              useApp.getState().setSettings({
                naiKey: v,
                naiConnected: Boolean(s.naiConnected && v === s.naiKey),
              });
            }}
          />
          <div className="mt-3 flex h-5 justify-end">
            {settings.naiConnected ? (
              <button
                type="button"
                className="text-[12px] text-muted"
                onClick={() => {
                  useApp.getState().setSettings({ naiConnected: false });
                  useApp.getState().toast("已退出中转站");
                }}
              >
                退出
              </button>
            ) : null}
          </div>
          {err ? <p className="mb-2 text-[12px] text-danger">{err}</p> : null}
          <PrimaryBtn className={cn(proxyOn && "bg-good hover:bg-good")} busy={busy} onClick={() => void connectProxy()}>
            {proxyOn ? "已连接" : "连接"}
          </PrimaryBtn>
        </>
      ) : (
        <>
          <div className="mb-1 text-[14px] font-medium">Persistent Token</div>
          <TextInput
            type="password"
            value={officialKey}
            placeholder="pst-"
            onChange={(e) => {
              const v = e.target.value;
              setOfficialKey(v);
              const s = useApp.getState().settings;
              useApp.getState().setSettings({
                naiOfficialKey: v,
                naiOfficialConnected: Boolean(s.naiOfficialConnected && v === (s.naiOfficialKey ?? "")),
              });
            }}
          />
          <p className="mb-1 mt-1 text-[11px] text-muted">一般以 pst- 开头。地址固定为 {NAI_OFFICIAL_BASE}，不能改。</p>
          <div className="mt-3 flex h-5 justify-end">
            {settings.naiOfficialConnected ? (
              <button
                type="button"
                className="text-[12px] text-muted"
                onClick={() => {
                  useApp.getState().setSettings({ naiOfficialConnected: false });
                  useApp.getState().toast("已退出官网");
                }}
              >
                退出
              </button>
            ) : null}
          </div>
          {err ? <p className="mb-2 text-[12px] text-danger">{err}</p> : null}
          <PrimaryBtn
            className={cn(officialOn && "bg-good hover:bg-good")}
            busy={busy}
            onClick={() => void connectOfficial()}
          >
            {officialOn ? "已连接" : "连接"}
          </PrimaryBtn>
        </>
      )}
      {liveOther ? (
        <p className="mt-3 text-[12px] text-muted">
          生图目前仍走{source === "official" ? "官网" : "中转站"}。连接这边后会改过来，另一边会断开，密钥还留在输入框里。
        </p>
      ) : null}
    </SheetCard>
  );
}

function patchActivePreset(map: (preset: StPreset) => StPreset) {
  const s = useApp.getState().settings;
  const id = s.stPresetId;
  if (!id) return;
  useApp.getState().setSettings({
    stPresets: (s.stPresets ?? []).map((p) => (p.id === id ? map(p) : p)),
  });
}

function PresetSheet({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const params = settings.llmParams;
  const preset = (settings.stPresets ?? []).find((p) => p.id === settings.stPresetId) ?? null;
  const [edit, setEdit] = useState<{ id: string; name: string; text: string; readOnly: boolean } | null>(null);

  const patchParam = (partial: Partial<LlmParams>) => {
    const cur = useApp.getState().settings.llmParams;
    useApp.getState().setSettings({ llmParams: { ...cur, ...partial } });
  };

  const setItemEnabled = (item: StPromptItem, on: boolean) => {
    if (!item.usable) return;
    patchActivePreset((p) => {
      if (!p.items) return p;
      return sealPreset({
        ...p,
        items: p.items.map((row) => (row.id === item.id ? { ...row, enabled: on } : row)),
      });
    });
  };

  const saveEdit = () => {
    if (!edit || edit.readOnly) return;
    const text = edit.text;
    const id = edit.id;
    patchActivePreset((p) => {
      if (!p.items) return p;
      return sealPreset({
        ...p,
        items: p.items.map((row) => (row.id === id ? { ...row, content: text } : row)),
      });
    });
    setEdit(null);
  };

  const oldMode = settings.stPresetMode === "old";
  const hasLegacy = typeof preset?.legacySystemPrompt === "string" || typeof preset?.legacyPostHistory === "string";
  const editing = preset?.items?.find((item) => item.id === edit?.id);
  const canRestore = Boolean(edit && !edit.readOnly && typeof editing?.original === "string");

  const restoreOriginal = () => {
    if (!edit || edit.readOnly || typeof editing?.original !== "string") return;
    const text = editing.original;
    const id = edit.id;
    patchActivePreset((p) => {
      if (!p.items) return p;
      return sealPreset({
        ...p,
        items: p.items.map((row) => (row.id === id ? { ...row, content: text } : row)),
      });
    });
    setEdit({ ...edit, text });
    useApp.getState().toast("已还原");
  };

  const setMode = (mode: "new" | "old") => {
    useApp.getState().setSettings({ stPresetMode: mode });
    if (mode === "old" && preset && !hasLegacy) {
      useApp.getState().toast("这份是以前导入的，没有旧版内容，请重新导入");
    }
  };

  return (
    <SheetCard title="预设设置" onClose={onClose}>
      <ChatPresetPicker />
      <div className="mt-3 flex items-center gap-5 text-[13px]">
        {(
          [
            ["new", "新版方法"],
            ["old", "旧版方法"],
          ] as const
        ).map(([id, label]) => {
          const on = (oldMode ? "old" : "new") === id;
          return (
            <button key={id} type="button" className="inline-flex items-center gap-1.5" onClick={() => setMode(id)}>
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full border",
                  on ? "border-primary" : "border-line-strong",
                )}
              >
                {on ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
              {label}
            </button>
          );
        })}
      </div>
      {oldMode && preset && !hasLegacy ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">这份没有旧版内容。请重新导入。现在仍按新版发送。</p>
      ) : null}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(
          [
            ["chat", "对话", Boolean(settings.stUseChat)],
            ["image", "生图", Boolean(settings.stUseImage)],
            ["wechat", "微信", Boolean(settings.stUseWechat)],
          ] as const
        ).map(([part, label, on]) => (
          <div key={part} className="flex flex-col items-center gap-1.5">
            <span className="text-[13px]">{label}</span>
            <Switch on={on} onChange={(v) => setPresetUse(part, v)} label={label} />
          </div>
        ))}
      </div>
      <div className="mb-2 mt-5 flex items-center justify-between">
        <span className="text-[14px] font-medium">参数管理</span>
        <button
          type="button"
          className="text-[12px] text-muted"
          onClick={() => {
            const cur = useApp.getState().settings.llmParams;
            useApp.getState().setSettings({ llmParams: defaultSampler(cur) });
          }}
        >
          恢复默认
        </button>
      </div>
      <ParamRow
        label="温度"
        value={params.temperature}
        min={0}
        max={2}
        step={0.01}
        locked={params.temperatureLocked}
        onLock={(v) => patchParam({ temperatureLocked: v })}
        onChange={(n) => patchParam({ temperature: n })}
      />
      <ParamRow
        label="Top P"
        value={params.topP}
        min={0}
        max={1}
        step={0.01}
        locked={params.topPLocked}
        onLock={(v) => patchParam({ topPLocked: v })}
        onChange={(n) => patchParam({ topP: n })}
      />
      <ParamRow
        label="频率惩罚"
        value={params.frequencyPenalty}
        min={-2}
        max={2}
        step={0.01}
        locked={params.frequencyPenaltyLocked}
        onLock={(v) => patchParam({ frequencyPenaltyLocked: v })}
        onChange={(n) => patchParam({ frequencyPenalty: n })}
      />
      <ParamRow
        label="存在惩罚"
        value={params.presencePenalty}
        min={-2}
        max={2}
        step={0.01}
        locked={params.presencePenaltyLocked}
        onLock={(v) => patchParam({ presencePenaltyLocked: v })}
        onChange={(n) => patchParam({ presencePenalty: n })}
      />
      <ParamRow
        label="最大长度"
        value={params.maxTokens}
        min={256}
        max={131072}
        step={1}
        digits={0}
        locked={params.maxTokensLocked}
        onLock={(v) => patchParam({ maxTokensLocked: v })}
        onChange={(n) => patchParam({ maxTokens: n })}
      />
      <ParamRow
        label="上下文轮数"
        value={params.contextTurns}
        min={4}
        max={80}
        step={1}
        digits={0}
        locked={params.contextTurnsLocked}
        onLock={(v) => patchParam({ contextTurnsLocked: v })}
        onChange={(n) => patchParam({ contextTurns: n })}
      />
      <div className="mb-2 mt-4 text-[14px] font-medium">内容开关</div>
      {oldMode ? <p className="mb-2 text-[12px] leading-relaxed text-muted">旧版不看这些开关。要改内容，请切回新版方法。</p> : null}
      {!preset ? (
        <p className="text-[12px] text-muted">先选择一份预设。</p>
      ) : !preset.items?.length ? (
        <p className="text-[12px] leading-relaxed text-muted">
          这是以前导入的预设，只有整段文字，没有一条条开关。重新导入后才能逐条开关，现在仍按原来的整段发送。
        </p>
      ) : (
        <div>
          {preset.items.map((item) => {
            const live = item.usable && !oldMode;
            return (
              <div key={item.id} className="flex items-center gap-2 border-b border-line/70 py-2.5 last:border-0">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px]",
                    live ? (item.enabled ? "font-semibold text-ink" : "text-ink") : "text-faint",
                  )}
                >
                  {item.name}
                </span>
                <button
                  type="button"
                  className={cn("grid size-8 shrink-0 place-items-center", live ? "text-muted" : "text-faint")}
                  aria-label={live ? `编辑${item.name}` : `查看${item.name}`}
                  onClick={() => setEdit({ id: item.id, name: item.name, text: item.content, readOnly: !live })}
                >
                  <Pencil className="size-3.5" />
                </button>
                <Switch
                  on={Boolean(live && item.enabled)}
                  disabled={!live}
                  label={item.name}
                  onChange={(v) => setItemEnabled(item, v)}
                />
              </div>
            );
          })}
        </div>
      )}
      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.name || "内容"}
        wide
        titleAside={
          canRestore ? (
            <button type="button" className="grid size-9 place-items-center text-muted" aria-label="还原" onClick={restoreOriginal}>
              <RotateCcw className="size-4" />
            </button>
          ) : null
        }
      >
        <TextArea
          className={cn("min-h-[200px]", edit?.readOnly && "text-muted")}
          value={edit?.text ?? ""}
          readOnly={edit?.readOnly}
          onChange={(e) => {
            const text = e.target.value;
            setEdit((cur) => (cur ? { ...cur, text } : cur));
          }}
        />
        {edit?.readOnly ? (
          <p className="mt-2 text-[12px] text-muted">
            {oldMode ? "旧版方法不能改这些条目。" : "这一条绘语用不上，只给查看，不会发送。"}
          </p>
        ) : (
          <PrimaryBtn className="mt-4" onClick={saveEdit}>
            保存
          </PrimaryBtn>
        )}
      </Modal>
    </SheetCard>
  );
}

function AccountPicker({
  accounts,
  keyValue,
  onKeyChange,
  busy,
  exit,
  onPick,
  onDelete,
}: {
  accounts: LlmAccount[];
  keyValue: string;
  onKeyChange: (v: string) => void;
  busy?: boolean;
  exit?: ReactNode;
  onPick: (a: LlmAccount) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(r.width, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const top = r.bottom + 4;
    const maxH = Math.min(260, Math.max(120, window.innerHeight - top - 12));
    setPos({ top, left, width, maxH });
  };

  const openMenu = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    place();
    let start: { x: number; y: number } | null = null;
    let downOutside = false;
    let moved = false;
    const inChrome = (t: EventTarget | null) => {
      const n = t as Node | null;
      return Boolean(n && (box.current?.contains(n) || menu.current?.contains(n)));
    };
    const onDown = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY };
      downOutside = !inChrome(e.target);
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 10) moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (downOutside && !moved && !inChrome(e.target)) setOpen(false);
      start = null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div ref={box}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[14px] font-medium">
        <span>API 密钥</span>
        <span className="flex shrink-0 items-center gap-3 text-[12px] font-normal">
          {exit}
          <button type="button" className="text-muted" onClick={() => (open ? setOpen(false) : openMenu())}>
            账号列表
          </button>
        </span>
      </div>
      <TextInput type="password" value={keyValue} placeholder="" onChange={(e) => onKeyChange(e.target.value)} />
      {open && (
        <div
          ref={menu}
          className="mt-1 max-h-60 overflow-auto overscroll-contain rounded-[16px] border border-line bg-card shadow-[0_16px_40px_rgb(44_40_36/0.16)] scroll-hide"
        >
          {accounts.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-muted">还没有保存的账号</p>
              ) : (
                accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-1 border-b border-line/70 last:border-0">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate px-3 py-3 text-left text-[13px]"
                      disabled={busy}
                      onClick={() => {
                        onPick(a);
                        setOpen(false);
                      }}
                    >
                      {a.name}
                    </button>
                    <button
                      type="button"
                      className="grid size-10 shrink-0 place-items-center text-danger"
                      aria-label={`删除${a.name}`}
                      onClick={() => onDelete(a.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))
              )}
        </div>
      )}
    </div>
  );
}

function ModelPicker({
  models,
  current,
  starred,
  connected,
  onPick,
  onStar,
}: {
  models: string[];
  current: string;
  starred: string[];
  connected: boolean;
  onPick: (id: string) => void;
  onStar: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? models.filter((id) => id.toLowerCase().includes(t)) : models;
    const star = new Set(starred);
    return [...list].sort((a, b) => {
      const as = star.has(a) ? 0 : 1;
      const bs = star.has(b) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.localeCompare(b);
    });
  }, [models, q, starred]);

  const place = () => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(r.width, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const top = r.bottom + 4;
    const maxH = Math.min(260, Math.max(120, window.innerHeight - top - 12));
    setPos({ top, left, width, maxH });
  };

  const openMenu = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    place();
    let start: { x: number; y: number } | null = null;
    let downOutside = false;
    let moved = false;
    const inChrome = (t: EventTarget | null) => {
      const n = t as Node | null;
      return Boolean(n && (box.current?.contains(n) || menu.current?.contains(n)));
    };
    const onDown = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY };
      downOutside = !inChrome(e.target);
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 10) moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (downOutside && !moved && !inChrome(e.target)) setOpen(false);
      start = null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <div className="flex h-12 items-center rounded-full border border-line bg-card focus-within:border-primary/40">
        <input
          value={q}
          placeholder="搜索"
          className="min-w-0 flex-1 bg-transparent px-4 text-[14px] outline-none placeholder:text-faint"
          onChange={(e) => {
            setQ(e.target.value);
            if (!open) openMenu();
          }}
          onFocus={() => {
            if (!open) openMenu();
          }}
        />
        <button
          type="button"
          className="grid size-11 shrink-0 place-items-center"
          aria-label={open ? "收起模型列表" : "展开模型列表"}
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          <ChevronDown className={cn("size-4 text-muted transition", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div
          ref={menu}
          className="mt-1 max-h-60 overflow-auto overscroll-contain rounded-[16px] border border-line bg-card shadow-[0_16px_40px_rgb(44_40_36/0.16)] scroll-hide"
        >
          {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-muted">
                  {connected ? "没有匹配的模型" : "连接后才会出现列表"}
                </p>
              ) : (
                filtered.map((id) => {
                  const on = current === id;
                  const star = starred.includes(id);
                  return (
                    <div
                      key={id}
                      className={cn("flex items-center gap-1 border-b border-line/70 last:border-0", on && "bg-dim/70")}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate px-3 py-3 text-left text-[13px]"
                        onClick={() => {
                          onPick(id);
                          setOpen(false);
                        }}
                      >
                        {id}
                      </button>
                      <button
                        type="button"
                        className="grid size-10 shrink-0 place-items-center"
                        onClick={() => onStar(id)}
                        aria-label={star ? "取消常用" : "标为常用"}
                      >
                        <Star className={cn("size-4", star ? "fill-primary text-primary" : "text-faint")} />
                      </button>
                    </div>
                  );
                })
              )}
        </div>
      )}
    </div>
  );
}

function ParamRow({
  label,
  value,
  min,
  max,
  step,
  digits = 2,
  locked,
  onLock,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  locked?: boolean;
  onLock?: (v: boolean) => void;
  onChange: (n: number) => void;
}) {
  const shown = digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
  return (
    <div className="mb-3">
      <div className="mb-0.5 flex items-center justify-between text-[13px]">
        <span className={locked ? "text-muted" : undefined}>{label}</span>
        <span className="flex items-center gap-1.5 tabular-nums text-muted">
          {shown}
          {onLock ? (
            <button
              type="button"
              className={locked ? "text-primary" : "text-muted"}
              onClick={() => onLock(!locked)}
              aria-label={locked ? "解锁" : "锁定"}
            >
              <Lock className="size-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} disabled={locked} />
    </div>
  );
}
