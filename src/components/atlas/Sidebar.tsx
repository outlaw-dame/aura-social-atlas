import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  Minus,
  Pin,
  PinOff,
  Plus,
  RotateCw,
  Settings,
  Square,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  type AtlasStack,
  type AtlasTab,
  faviconFor,
  hostOf,
} from "@/lib/atlas-tabs";

type Props = {
  tabs: AtlasTab[];
  stacks: AtlasStack[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPinToggle: (id: string) => void;
  onMoveToStack: (id: string, stackId: string | null) => void;
  onToggleStack: (id: string) => void;
  onAddStack: (name: string) => void;
  onNewTab: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  canBack: boolean;
  canForward: boolean;
};

export function AtlasSidebar(p: Props) {
  const pinned = p.tabs.filter((t) => t.pinned);
  const unstacked = p.tabs.filter((t) => !t.pinned && !t.stackId);
  const stacked = (sid: string) => p.tabs.filter((t) => t.stackId === sid);

  return (
    <aside className="liquid-glass specular fixed inset-y-3 left-3 z-30 flex w-64 flex-col rounded-3xl ring-1 ring-black/5 dark:ring-white/10">
      {/* Traffic lights */}
      <div className="flex items-center gap-2 px-4 pt-4">
        <TrafficLight color="bg-[#ff5f57]" icon={<X className="size-2" strokeWidth={3} />} title="Close" />
        <TrafficLight color="bg-[#febc2e]" icon={<Minus className="size-2" strokeWidth={3} />} title="Minimize" />
        <TrafficLight color="bg-[#28c840]" icon={<Square className="size-2" strokeWidth={3} />} title="Maximize" />
        <div className="ml-auto flex items-center gap-1">
          <NavBtn onClick={p.onBack} disabled={!p.canBack} aria-label="Back">
            <ArrowLeft className="size-3.5" />
          </NavBtn>
          <NavBtn onClick={p.onForward} disabled={!p.canForward} aria-label="Forward">
            <ArrowRight className="size-3.5" />
          </NavBtn>
          <NavBtn onClick={p.onReload} aria-label="Reload">
            <RotateCw className="size-3.5" />
          </NavBtn>
        </div>
      </div>

      {/* Pinned grid */}
      {pinned.length > 0 && (
        <div className="grid grid-cols-4 gap-2 px-4 pt-4">
          {pinned.map((t) => (
            <button
              key={t.id}
              onClick={() => p.onSelect(t.id)}
              onDoubleClick={() => p.onPinToggle(t.id)}
              title={`${t.title} — double-click to unpin`}
              className={`group relative grid aspect-square place-items-center rounded-xl ring-1 transition ${
                t.id === p.activeId
                  ? "bg-white/80 ring-sky-400/50 shadow-sm dark:bg-white/10"
                  : "bg-white/40 ring-black/5 hover:bg-white/70 dark:bg-white/5 dark:ring-white/10 dark:hover:bg-white/10"
              }`}
            >
              <Favicon url={t.url} title={t.title} />
            </button>
          ))}
        </div>
      )}

      {/* New tab */}
      <button
        onClick={p.onNewTab}
        className="mx-4 mt-4 flex items-center gap-2 rounded-xl border border-dashed border-black/15 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-white/60 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/5"
      >
        <Plus className="size-3.5" />
        New tab
      </button>

      {/* Tabs list */}
      <div className="no-scrollbar mt-3 flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {unstacked.map((t) => (
            <TabRow
              key={t.id}
              tab={t}
              active={t.id === p.activeId}
              onSelect={() => p.onSelect(t.id)}
              onClose={() => p.onClose(t.id)}
              onPin={() => p.onPinToggle(t.id)}
            />
          ))}
        </ul>

        {/* Stacks */}
        <div className="mt-4 space-y-3">
          {p.stacks.map((s) => {
            const children = stacked(s.id);
            return (
              <div key={s.id}>
                <button
                  onClick={() => p.onToggleStack(s.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 hover:bg-white/40 dark:hover:bg-white/5"
                >
                  {s.collapsed ? (
                    <ChevronRight className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                  <span className={`size-2 rounded-full bg-gradient-to-br ${s.color}`} />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-[10px] opacity-60">{children.length}</span>
                </button>
                {!s.collapsed && (
                  <ul className="ml-3 mt-1 space-y-0.5 border-l border-black/5 pl-2 dark:border-white/10">
                    {children.map((t) => (
                      <TabRow
                        key={t.id}
                        tab={t}
                        active={t.id === p.activeId}
                        onSelect={() => p.onSelect(t.id)}
                        onClose={() => p.onClose(t.id)}
                        onPin={() => p.onPinToggle(t.id)}
                        compact
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <AddStackButton onAdd={p.onAddStack} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1 border-t border-black/5 px-3 py-2 dark:border-white/10">
        <FooterBtn onClick={p.onOpenDownloads} title="Downloads">
          <Download className="size-3.5" />
        </FooterBtn>
        <FooterBtn onClick={p.onOpenSettings} title="Settings">
          <Settings className="size-3.5" />
        </FooterBtn>
      </div>
    </aside>
  );
}

function TrafficLight({
  color,
  icon,
  title,
}: {
  color: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      className={`group grid size-3 place-items-center rounded-full ${color} text-black/60`}
    >
      <span className="opacity-0 transition group-hover:opacity-100">{icon}</span>
    </button>
  );
}

function NavBtn({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="grid size-6 place-items-center rounded-md text-zinc-500 transition hover:bg-white/60 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function FooterBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/60 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function Favicon({ url, title }: { url: string; title: string }) {
  const src = faviconFor(url);
  if (!src) {
    return (
      <span className="grid size-6 place-items-center rounded-md bg-gradient-to-br from-sky-400 to-indigo-500 text-[10px] font-bold text-white">
        {title.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" className="size-5 rounded-sm" />;
}

function TabRow({
  tab,
  active,
  onSelect,
  onClose,
  onPin,
  compact,
}: {
  tab: AtlasTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onPin: () => void;
  compact?: boolean;
}) {
  return (
    <li
      onClick={onSelect}
      className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 ${
        compact ? "py-1" : "py-1.5"
      } text-xs font-medium transition ${
        active
          ? "bg-white/80 text-zinc-900 ring-1 ring-sky-400/40 shadow-sm dark:bg-white/10 dark:text-white"
          : "text-zinc-600 hover:bg-white/50 dark:text-zinc-300 dark:hover:bg-white/5"
      }`}
    >
      <Favicon url={tab.url} title={tab.title} />
      <span className="flex-1 truncate">{tab.title || hostOf(tab.url)}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        className="hidden size-5 place-items-center rounded text-zinc-500 hover:bg-black/10 group-hover:grid dark:hover:bg-white/10"
        title={tab.pinned ? "Unpin" : "Pin"}
      >
        {tab.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="hidden size-5 place-items-center rounded text-zinc-500 hover:bg-black/10 group-hover:grid dark:hover:bg-white/10"
        title="Close"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

function AddStackButton({ onAdd }: { onAdd: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  if (!editing)
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-white/40 dark:hover:bg-white/5"
      >
        <Folder className="size-3" />
        New stack
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName("");
        setEditing(false);
      }}
      className="px-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder="Stack name…"
        className="w-full rounded-md bg-white/70 px-2 py-1 text-xs ring-1 ring-black/10 focus:outline-none dark:bg-white/10 dark:ring-white/10"
      />
    </form>
  );
}
