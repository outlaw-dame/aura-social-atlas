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
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

export function AtlasSidebar(p: Props) {
  const pinned = p.tabs.filter((t) => t.pinned);
  const unstacked = p.tabs.filter((t) => !t.pinned && !t.stackId);
  const stacked = (sid: string) => p.tabs.filter((t) => t.stackId === sid);

  const selectAndClose = (id: string) => {
    p.onSelect(id);
    p.onMobileClose?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {p.mobileOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={p.onMobileClose}
          className="fixed inset-0 z-20 bg-black/30 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        aria-label="Tabs sidebar"
        className={`liquid-glass specular fixed inset-y-3 left-3 z-30 flex w-[min(17rem,calc(100vw-1.5rem))] flex-col rounded-3xl ring-1 ring-black/5 transition-transform duration-300 dark:ring-white/10 lg:w-64 lg:translate-x-0 ${
          p.mobileOpen ? "translate-x-0" : "-translate-x-[110%]"
        }`}
      >
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-4 pt-4">
          <TrafficLight color="bg-[#ff5f57]" icon={<X className="size-2" strokeWidth={3} />} label="Close window" />
          <TrafficLight color="bg-[#febc2e]" icon={<Minus className="size-2" strokeWidth={3} />} label="Minimize window" />
          <TrafficLight color="bg-[#28c840]" icon={<Square className="size-2" strokeWidth={3} />} label="Maximize window" />
          <div className="ml-auto flex items-center gap-1">
            <NavBtn onClick={p.onBack} disabled={!p.canBack} aria-label="Go back">
              <ArrowLeft className="size-3.5" />
            </NavBtn>
            <NavBtn onClick={p.onForward} disabled={!p.canForward} aria-label="Go forward">
              <ArrowRight className="size-3.5" />
            </NavBtn>
            <NavBtn onClick={p.onReload} aria-label="Reload page">
              <RotateCw className="size-3.5" />
            </NavBtn>
            {p.onMobileClose && (
              <NavBtn onClick={p.onMobileClose} aria-label="Close sidebar" className="lg:hidden">
                <X className="size-3.5" />
              </NavBtn>
            )}
          </div>
        </div>

        {/* Pinned grid */}
        {pinned.length > 0 && (
          <div className="grid grid-cols-4 gap-2 px-4 pt-4">
            {pinned.map((t) => (
              <button
                key={t.id}
                onClick={() => selectAndClose(t.id)}
                onDoubleClick={() => p.onPinToggle(t.id)}
                aria-label={`Open pinned tab ${t.title || hostOf(t.url)}`}
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
          aria-label="Open new tab"
          className="mx-4 mt-4 flex items-center gap-2 rounded-xl border border-dashed border-black/15 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-white/60 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/5"
        >
          <Plus className="size-3.5" aria-hidden="true" />
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
                onSelect={() => selectAndClose(t.id)}
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
                    aria-expanded={!s.collapsed}
                    aria-label={`${s.collapsed ? "Expand" : "Collapse"} ${s.name} stack`}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 hover:bg-white/40 dark:hover:bg-white/5"
                  >
                    {s.collapsed ? (
                      <ChevronRight className="size-3" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-3" aria-hidden="true" />
                    )}
                    <span className={`size-2 rounded-full bg-gradient-to-br ${s.color}`} aria-hidden="true" />
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
                          onSelect={() => selectAndClose(t.id)}
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
          <FooterBtn onClick={() => { p.onOpenDownloads(); p.onMobileClose?.(); }} label="Open downloads">
            <Download className="size-3.5" />
          </FooterBtn>
          <FooterBtn onClick={() => { p.onOpenSettings(); p.onMobileClose?.(); }} label="Open settings">
            <Settings className="size-3.5" />
          </FooterBtn>
        </div>
      </aside>
    </>
  );
}

function TrafficLight({
  color,
  icon,
  label,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`group grid size-3 place-items-center rounded-full ${color} text-black/60`}
    >
      <span className="opacity-0 transition group-hover:opacity-100" aria-hidden="true">{icon}</span>
    </button>
  );
}

function NavBtn({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`grid size-7 place-items-center rounded-md text-zinc-500 transition hover:bg-white/60 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white ${className}`}
    >
      {children}
    </button>
  );
}

function FooterBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/60 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
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
  const label = tab.title || hostOf(tab.url);
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
      <span className="flex-1 truncate">{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        aria-label={tab.pinned ? `Unpin ${label}` : `Pin ${label}`}
        className="hidden size-5 place-items-center rounded text-zinc-500 hover:bg-black/10 group-hover:grid dark:hover:bg-white/10"
      >
        {tab.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${label}`}
        className="hidden size-5 place-items-center rounded text-zinc-500 hover:bg-black/10 group-hover:grid dark:hover:bg-white/10"
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
        aria-label="Create new tab stack"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-white/40 dark:hover:bg-white/5"
      >
        <Folder className="size-3" aria-hidden="true" />
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
      <label className="sr-only" htmlFor="atlas-new-stack-name">New stack name</label>
      <input
        id="atlas-new-stack-name"
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
