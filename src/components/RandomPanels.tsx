import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/store";
import {
  badModuleName,
  bankSwitch,
  duplicateRandomModule,
  emptyBank,
  jumpSeq,
  moduleRounds,
  moduleTag,
  seqTurnItem,
  setModulePick,
  setModuleRounds,
  type RandomBank,
  type RandomItem,
  type RandomModule,
} from "@/lib/random-prompt";
import { uid } from "@/lib/utils";
import { Switch, TextArea, TextInput } from "./ui-kit";

function copyText(text: string) {
  const done = () => useApp.getState().toast("已复制");
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(() => useApp.getState().toast("复制失败"));
    return;
  }
  useApp.getState().toast("复制失败");
}

function Sheet({
  title,
  extra,
  onClose,
  z,
  children,
}: {
  title: string;
  extra?: ReactNode;
  onClose: () => void;
  z: number;
  children: ReactNode;
}) {
  return createPortal(
    <div className="fixed inset-0 flex justify-center px-4 py-8" style={{ zIndex: z }}>
      <button type="button" className="absolute inset-0 bg-overlay/40" onClick={onClose} aria-label="关闭" />
      <div className="relative z-10 flex h-full min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[28px] bg-bg text-ink shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
          <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold">{title}</h2>
          {extra}
          <button type="button" className="grid size-9 shrink-0 place-items-center" onClick={onClose} aria-label="关闭">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 scroll-thin">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function saveBank(next: RandomBank) {
  useApp.getState().setSettings({ random: next });
}

export function RandomSettings({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (piece: string) => void;
}) {
  const bank = useApp((s) => s.settings.random) ?? emptyBank();
  const [tab, setTab] = useState<"mods" | "quick">("mods");
  const [editing, setEditing] = useState<RandomModule | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Sheet
        z={60}
        title="随机设置"
        onClose={onClose}
        extra={
          <Switch
            label="随机模式"
            on={bank.enabled}
            onChange={(v) => saveBank(bankSwitch(bank, v))}
          />
        }
      >
        <div className="mb-4 flex gap-6 text-[15px]">
          <button type="button" className={tab === "mods" ? "font-medium text-ink" : "text-muted"} onClick={() => setTab("mods")}>
            模块管理
          </button>
          <button type="button" className={tab === "quick" ? "font-medium text-ink" : "text-muted"} onClick={() => setTab("quick")}>
            快速配置
          </button>
        </div>
        {tab === "mods" ? (
          <ModuleList bank={bank} onEdit={setEditing} onCreate={() => setCreating(true)} onInsert={onInsert} />
        ) : (
          <QuickPick modules={bank.modules} onInsert={onInsert} />
        )}
      </Sheet>
      {creating && (
        <ModuleDraft
          modules={bank.modules}
          onClose={() => setCreating(false)}
          onSave={(mod) => {
            saveBank({ ...bank, modules: [...bank.modules, mod] });
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <ModuleEditor
          module={bank.modules.find((m) => m.id === editing.id) ?? editing}
          modules={bank.modules}
          onClose={() => setEditing(null)}
          onChange={(next) => saveBank({ ...bank, modules: bank.modules.map((m) => (m.id === next.id ? next : m)) })}
        />
      )}
    </>
  );
}

function RoundsStep({ rounds, onChange }: { rounds: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 text-[11px] leading-none text-muted">
      轮数
      <span className="inline-flex h-6 items-center rounded-full border border-line bg-card">
        <button type="button" className="grid h-6 w-5 place-items-center" aria-label="增加轮数" onClick={() => onChange(rounds + 1)}>
          <ChevronUp className="size-3" />
        </button>
        <span className="min-w-4 text-center text-[12px] text-ink tabular-nums">{rounds}</span>
        <button
          type="button"
          className="grid h-6 w-5 place-items-center disabled:opacity-30"
          aria-label="减少轮数"
          disabled={rounds <= 1}
          onClick={() => onChange(rounds - 1)}
        >
          <ChevronDown className="size-3" />
        </button>
      </span>
    </span>
  );
}

function ModuleList({
  bank,
  onEdit,
  onCreate,
  onInsert,
}: {
  bank: RandomBank;
  onEdit: (m: RandomModule) => void;
  onCreate: () => void;
  onInsert: (piece: string) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const setPick = (mod: RandomModule, pick: RandomModule["pick"]) => {
    saveBank(setModulePick(bank, mod.id, pick));
  };
  const setRounds = (mod: RandomModule, rounds: number) => {
    saveBank(setModuleRounds(bank, mod.id, rounds));
  };
  return (
    <div>
      <button
        type="button"
        className="mb-3 flex h-11 w-full items-center justify-center gap-1 rounded-full border border-line bg-card text-[14px]"
        onClick={onCreate}
      >
        <Plus className="size-4" /> 添加模块
      </button>
      {bank.modules.map((mod) => (
        <div key={mod.id} className="mb-3 rounded-[18px] border border-line bg-card px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-[15px] font-medium">
              {mod.name}
              <span className="ml-1 text-[12px] font-normal text-muted">({mod.items.length})</span>
            </div>
            <button
              type="button"
              className="grid size-8 place-items-center text-muted"
              aria-label="插入到正面提示词"
              onClick={() => {
                onInsert(moduleTag([mod.name]));
                useApp.getState().toast("插入成功");
              }}
            >
              <Send className="size-4" />
            </button>
            <button
              type="button"
              className="grid size-8 place-items-center text-muted"
              aria-label="复制提示词"
              onClick={() => copyText(moduleTag([mod.name]))}
            >
              <Copy className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-6 shrink-0 rounded-full bg-dim p-0.5 text-[12px]">
              {(["random", "seq"] as const).map((pick) => (
                <button
                  key={pick}
                  type="button"
                  className={`rounded-full px-2.5 leading-5 ${mod.pick === pick ? "bg-card text-ink" : "text-muted"}`}
                  onClick={() => setPick(mod, pick)}
                >
                  {pick === "random" ? "随机" : "顺序"}
                </button>
              ))}
            </div>
            <RoundsStep rounds={moduleRounds(mod)} onChange={(n) => setRounds(mod, n)} />
            <div className="relative ml-auto">
              <button
                type="button"
                className="grid size-8 place-items-center text-muted"
                aria-label="更多"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === mod.id ? null : mod.id);
                }}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menu === mod.id && (
                <div
                  className="absolute right-0 top-9 z-10 w-28 overflow-hidden rounded-[14px] border border-line bg-card shadow-lg"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button type="button" className="block w-full px-3 py-2 text-left text-[13px]" onClick={() => { setMenu(null); onEdit(mod); }}>
                    编辑
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-[13px]"
                    onClick={() => {
                      setMenu(null);
                      const copy = duplicateRandomModule(mod, bank.modules);
                      saveBank({ ...bank, modules: [...bank.modules, copy] });
                    }}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-[13px] text-danger"
                    onClick={() => {
                      setMenu(null);
                      useApp.getState().setUI({
                        confirm: {
                          title: "删除模块",
                          body: `删除「${mod.name}」？里面的项也会一起删掉。`,
                          danger: true,
                          onOk: () =>
                            saveBank({
                              ...bank,
                              modules: bank.modules.filter((m) => m.id !== mod.id),
                              ...(mod.linked === "appearances" ? { appearanceModuleDismissed: true } : {}),
                            }),
                        },
                      });
                    }}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {bank.modules.length === 0 && <p className="text-center text-[13px] text-muted">还没有模块</p>}
    </div>
  );
}

function SeqTurn({ module, onPick }: { module: RandomModule; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = seqTurnItem(module);
  const pool = module.items.filter((item) => item.enabled);
  return (
    <div className="mt-4">
      <div className="mb-1 text-[13px] text-muted">当前轮到</div>
      <button
        type="button"
        className="flex h-11 w-full items-center gap-2 rounded-full border border-line bg-card px-4 text-left text-[14px]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{current ? current.name || "未命名" : "没有选中的项"}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`mt-2 overflow-y-auto overscroll-contain rounded-[16px] border border-line bg-card scroll-thin ${pool.length > 8 ? "max-h-[22rem]" : ""}`}
        >
          {pool.length === 0 && <p className="flex h-11 items-center px-4 text-[14px] text-muted">没有选中的项</p>}
          {pool.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flex h-11 w-full items-center px-4 text-left text-[14px] ${item.id === current?.id ? "text-primary" : "text-ink"}`}
              onClick={() => {
                onPick(item.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.name || "未命名"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleEditor({
  module,
  modules,
  onClose,
  onChange,
}: {
  module: RandomModule;
  modules: RandomModule[];
  onClose: () => void;
  onChange: (m: RandomModule) => void;
}) {
  const [item, setItem] = useState<RandomItem | "new" | null>(null);
  const [name, setName] = useState(module.name);
  const linked = module.linked === "appearances";
  const allOn = module.items.length > 0 && module.items.every((item) => item.enabled);
  const allOff = module.items.length > 0 && module.items.every((item) => !item.enabled);
  const setAll = (enabled: boolean) => onChange({ ...module, items: module.items.map((item) => ({ ...item, enabled })) });
  useEffect(() => setName(module.name), [module.name]);
  return (
    <>
      <Sheet
        z={64}
        title="编辑模块"
        onClose={onClose}
        extra={
          <div className="flex shrink-0 items-center gap-1 text-[13px]">
            <button type="button" className={allOn ? "text-primary" : "text-muted"} onClick={() => setAll(true)}>
              全选
            </button>
            <button type="button" className={allOff ? "text-primary" : "text-muted"} onClick={() => setAll(false)}>
              全不选
            </button>
          </div>
        }
      >
        <label className="mb-1 block text-[13px] text-muted">名称</label>
        <TextInput
          value={name}
          disabled={linked}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (linked) {
              setName(module.name);
              return;
            }
            const err = badModuleName(name, modules, module.id);
            if (err) {
              useApp.getState().toast(err);
              setName(module.name);
              return;
            }
            if (name.trim() !== module.name) onChange({ ...module, name: name.trim() });
          }}
        />
        {linked && <p className="mt-1 text-[12px] leading-5 text-muted">这个模块跟着角色选择。名字不能改，加减角色也请到角色选择里。</p>}
        {module.pick === "seq" && <SeqTurn module={module} onPick={(id) => onChange(jumpSeq(module, id))} />}
        <ItemList
          items={module.items}
          canAdd={!linked}
          canDelete={!linked}
          onAdd={() => setItem("new")}
          onToggle={(it) => onChange({ ...module, items: module.items.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)) })}
          onEdit={setItem}
          onDelete={(it) =>
            useApp.getState().setUI({
              confirm: {
                title: "删除这一项",
                body: `删除「${it.name || "未命名"}」？`,
                danger: true,
                onOk: () => onChange({ ...module, items: module.items.filter((x) => x.id !== it.id) }),
              },
            })
          }
        />
      </Sheet>
      {item && (
        <ItemEditor
          item={item === "new" ? null : item}
          onClose={() => setItem(null)}
          onSave={(next) => {
            const items = item === "new" ? [...module.items, next] : module.items.map((x) => (x.id === next.id ? next : x));
            onChange({ ...module, items });
            setItem(null);
          }}
        />
      )}
    </>
  );
}

function ModuleDraft({
  modules,
  onClose,
  onSave,
}: {
  modules: RandomModule[];
  onClose: () => void;
  onSave: (m: RandomModule) => void;
}) {
  const [draft, setDraft] = useState<RandomModule>({
    id: uid("rm_"),
    name: "",
    pick: "random",
    items: [],
    nextId: null,
  });
  const [item, setItem] = useState<RandomItem | "new" | null>(null);
  return (
    <>
      <Sheet
        z={64}
        title="添加模块"
        onClose={onClose}
        extra={
          <button
            type="button"
            className="text-[14px] text-primary"
            onClick={() => {
              const err = badModuleName(draft.name, modules);
              if (err) {
                useApp.getState().toast(err);
                return;
              }
              onSave({ ...draft, name: draft.name.trim() });
            }}
          >
            保存
          </button>
        }
      >
        <label className="mb-1 block text-[13px] text-muted">名称</label>
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <ItemList
          items={draft.items}
          canAdd
          canDelete
          onAdd={() => setItem("new")}
          onToggle={(it) => setDraft({ ...draft, items: draft.items.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)) })}
          onEdit={setItem}
          onDelete={(it) =>
            useApp.getState().setUI({
              confirm: {
                title: "删除这一项",
                body: `删除「${it.name || "未命名"}」？`,
                danger: true,
                onOk: () => setDraft({ ...draft, items: draft.items.filter((x) => x.id !== it.id) }),
              },
            })
          }
        />
      </Sheet>
      {item && (
        <ItemEditor
          item={item === "new" ? null : item}
          onClose={() => setItem(null)}
          onSave={(next) => {
            const items = item === "new" ? [...draft.items, next] : draft.items.map((x) => (x.id === next.id ? next : x));
            setDraft({ ...draft, items });
            setItem(null);
          }}
        />
      )}
    </>
  );
}

function ItemList({
  items,
  canAdd = true,
  canDelete = true,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
}: {
  items: RandomItem[];
  canAdd?: boolean;
  canDelete?: boolean;
  onAdd: () => void;
  onToggle: (item: RandomItem) => void;
  onEdit: (item: RandomItem) => void;
  onDelete: (item: RandomItem) => void;
}) {
  return (
    <div className="mt-4">
      {canAdd && (
        <button
          type="button"
          className="mb-3 flex h-11 w-full items-center justify-center gap-1 rounded-full border border-line text-[14px]"
          onClick={onAdd}
        >
          <Plus className="size-4" /> 新增
        </button>
      )}
      {items.map((item) => (
        <div key={item.id} className="mb-2 flex items-center gap-2 rounded-[16px] border border-line px-3 py-2">
          <button
            type="button"
            aria-label={item.enabled ? "取消选用" : "选用"}
            className={`size-4 shrink-0 rounded-full border ${item.enabled ? "border-primary bg-primary" : "border-line-strong"}`}
            onClick={() => onToggle(item)}
          />
          <div className="min-w-0 flex-1 truncate text-[14px]">{item.name || "未命名"}</div>
          {canDelete && (
            <button type="button" className="grid size-8 place-items-center text-danger" aria-label="删除" onClick={() => onDelete(item)}>
              <Trash2 className="size-4" />
            </button>
          )}
          <button type="button" className="grid size-8 place-items-center text-muted" aria-label="编辑" onClick={() => onEdit(item)}>
            <Pencil className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ItemEditor({
  item,
  onClose,
  onSave,
}: {
  item: RandomItem | null;
  onClose: () => void;
  onSave: (item: RandomItem) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const appearances = useApp((s) => s.appearances);
  const source = item?.sourceId ? appearances.find((a) => a.id === item.sourceId) : undefined;
  const contentLocked = Boolean(item?.sourceId);
  return (
    <Sheet
      z={68}
      title={item ? "修改" : "新增"}
      onClose={onClose}
      extra={
        <button
          type="button"
          className="text-[14px] text-primary"
          onClick={() => {
            if (!name.trim() && !content.trim()) {
              useApp.getState().toast("先写名称或内容");
              return;
            }
            const nextName = name.trim();
            if (item?.sourceId && !nextName) {
              useApp.getState().toast("先写名称");
              return;
            }
            const custom = item?.sourceId ? (source ? nextName !== source.name : item.nameCustom === true) : false;
            onSave({
              id: item?.id ?? uid("ri_"),
              name: nextName,
              content: contentLocked ? (source?.prompt ?? item?.content ?? "") : content,
              enabled: item?.enabled ?? false,
              ...(item?.sourceId ? { sourceId: item.sourceId, ...(custom ? { nameCustom: true } : {}) } : {}),
            });
          }}
        >
          保存
        </button>
      }
    >
      <label className="mb-1 block text-[13px] text-muted">名称</label>
      <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      <label className="mb-1 mt-4 block text-[13px] text-muted">内容</label>
      <TextArea value={contentLocked ? (source?.prompt ?? content) : content} readOnly={contentLocked} onChange={(e) => setContent(e.target.value)} />
      {contentLocked && <p className="mt-1 text-[12px] leading-5 text-muted">内容跟着角色选择，这里改不了。改名字不会写回去。</p>}
    </Sheet>
  );
}

function QuickPick({ modules, onInsert }: { modules: RandomModule[]; onInsert: (piece: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[][]>([]);
  const [cursor, setCursor] = useState(0);
  const toggle = (name: string) => setPicked((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  const confirm = () => {
    if (!picked.length) return;
    setGroups((cur) => {
      const next = [...cur, picked];
      setCursor(next.length);
      return next;
    });
    setPicked([]);
  };
  const removeAt = (index: number) => {
    setGroups((cur) => {
      const next = cur.filter((_, i) => i !== index);
      setCursor((c) => Math.max(0, Math.min(c > index ? c - 1 : c, next.length)));
      return next;
    });
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-muted">模块池</div>
        <button type="button" className="text-[14px] text-primary" onClick={confirm}>
          确定
        </button>
      </div>
      <div className="mb-5 flex min-h-24 flex-wrap content-start items-start gap-2 rounded-[16px] border border-line p-3">
        {modules.length === 0 && <span className="text-[13px] text-muted">还没有模块</span>}
        {modules.map((mod) => {
          const on = picked.includes(mod.name);
          return (
            <button
              key={mod.id}
              type="button"
              className={`self-start rounded-full px-3 py-1.5 text-[13px] leading-5 ${on ? "bg-primary text-on-primary" : "bg-dim text-ink"}`}
              onClick={() => toggle(mod.name)}
            >
              {mod.name}
            </button>
          );
        })}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-muted">已选择</div>
        <button
          type="button"
          className="text-[14px] text-primary"
          onClick={() => {
            if (!groups.length) {
              useApp.getState().toast("还没有选择");
              return;
            }
            onInsert(groups.map((g) => moduleTag(g)).join(","));
            useApp.getState().toast("输出成功");
          }}
        >
          输出
        </button>
      </div>
      <div
        tabIndex={0}
        className="min-h-28 whitespace-pre-wrap rounded-[16px] border border-line bg-card px-3 py-3 text-[14px] outline-none focus:border-primary/40"
        onKeyDown={(e) => {
          if (e.key !== "Backspace" && e.key !== "Delete") return;
          e.preventDefault();
          if (!groups.length) return;
          if (e.key === "Backspace") {
            if (cursor <= 0) return;
            removeAt(cursor - 1);
            return;
          }
          if (cursor >= groups.length) return;
          removeAt(cursor);
        }}
      >
        {groups.length === 0 && <span className="text-muted">点确定后出现在这里。退格删掉一整组。</span>}
        {groups.map((g, i) => (
          <span key={`${g.join("&")}-${i}`}>
            {i > 0 ? ", " : ""}
            <button
              type="button"
              className={cursor === i + 1 ? "underline decoration-primary" : ""}
              onClick={() => setCursor(i + 1)}
            >
              {g.join("&")}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
