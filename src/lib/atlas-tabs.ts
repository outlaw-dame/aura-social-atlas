import { useCallback, useEffect, useState } from "react";

export type AtlasTab = {
  id: string;
  url: string;          // "atlas://home", "atlas://downloads", "atlas://settings", or https://…
  title: string;
  pinned?: boolean;
  stackId?: string | null;
};

export type AtlasStack = {
  id: string;
  name: string;
  color: string;        // tailwind gradient
  collapsed?: boolean;
};

export type AtlasDownload = {
  id: string;
  name: string;
  url: string;
  size: string;
  receivedAt: number;
  status: "complete" | "in_progress" | "failed";
  progress?: number;
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function faviconFor(url: string): string {
  try {
    if (url.startsWith("atlas://")) return "";
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return "";
  }
}

export function hostOf(url: string): string {
  if (url.startsWith("atlas://")) return url.replace("atlas://", "atlas · ");
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const DEFAULT_PINNED: AtlasTab[] = [
  { id: uid(), url: "https://github.com", title: "GitHub", pinned: true },
  { id: uid(), url: "https://news.ycombinator.com", title: "HN", pinned: true },
  { id: uid(), url: "https://figma.com", title: "Figma", pinned: true },
  { id: uid(), url: "https://linear.app", title: "Linear", pinned: true },
];

const DEFAULT_STACKS: AtlasStack[] = [
  { id: "research", name: "Research", color: "from-amber-400 to-orange-500" },
  { id: "design", name: "Design Inspiration", color: "from-emerald-400 to-teal-500" },
];

const DEFAULT_OPEN: AtlasTab[] = [
  { id: uid(), url: "atlas://home", title: "New Tab" },
  { id: uid(), url: "https://dezeen.com", title: "Dezeen", stackId: "design" },
  { id: uid(), url: "https://archdaily.com", title: "ArchDaily", stackId: "design" },
  { id: uid(), url: "https://arxiv.org", title: "arXiv", stackId: "research" },
  { id: uid(), url: "https://nature.com", title: "Nature", stackId: "research" },
];

export function useAtlasTabs() {
  const [tabs, setTabs] = useState<AtlasTab[]>([...DEFAULT_PINNED, ...DEFAULT_OPEN]);
  const [stacks, setStacks] = useState<AtlasStack[]>(DEFAULT_STACKS);
  const [activeId, setActiveId] = useState<string>(DEFAULT_OPEN[0].id);
  const [downloads, setDownloads] = useState<AtlasDownload[]>([
    {
      id: uid(),
      name: "atlas-brand-kit.zip",
      url: "https://atlas.app/kit.zip",
      size: "12.4 MB",
      receivedAt: Date.now() - 1000 * 60 * 22,
      status: "complete",
    },
    {
      id: uid(),
      name: "research-notes.pdf",
      url: "https://arxiv.org/abs/2401.0001",
      size: "1.8 MB",
      receivedAt: Date.now() - 1000 * 60 * 60 * 3,
      status: "complete",
    },
  ]);

  // hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("atlas:state:v1");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.tabs) setTabs(s.tabs);
      if (s.stacks) setStacks(s.stacks);
      if (s.activeId) setActiveId(s.activeId);
      if (s.downloads) setDownloads(s.downloads);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "atlas:state:v1",
        JSON.stringify({ tabs, stacks, activeId, downloads })
      );
    } catch {}
  }, [tabs, stacks, activeId, downloads]);

  const openTab = useCallback((url: string, title?: string) => {
    const t: AtlasTab = { id: uid(), url, title: title ?? hostOf(url) };
    setTabs((arr) => [...arr, t]);
    setActiveId(t.id);
    return t.id;
  }, []);

  const navigateActive = useCallback((url: string, title?: string) => {
    setTabs((arr) =>
      arr.map((t) =>
        t.id === activeId ? { ...t, url, title: title ?? hostOf(url) } : t
      )
    );
  }, [activeId]);

  const closeTab = useCallback((id: string) => {
    setTabs((arr) => {
      const next = arr.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next.find((t) => !t.pinned) ?? next[0];
        if (fallback) setActiveId(fallback.id);
        else {
          const home: AtlasTab = { id: uid(), url: "atlas://home", title: "New Tab" };
          setActiveId(home.id);
          return [...next, home];
        }
      }
      return next;
    });
  }, [activeId]);

  const togglePin = useCallback((id: string) => {
    setTabs((arr) =>
      arr.map((t) => (t.id === id ? { ...t, pinned: !t.pinned, stackId: null } : t))
    );
  }, []);

  const moveToStack = useCallback((id: string, stackId: string | null) => {
    setTabs((arr) =>
      arr.map((t) => (t.id === id ? { ...t, stackId, pinned: false } : t))
    );
  }, []);

  const toggleStack = useCallback((id: string) => {
    setStacks((arr) =>
      arr.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    );
  }, []);

  const addStack = useCallback((name: string) => {
    const colors = [
      "from-sky-400 to-indigo-500",
      "from-pink-400 to-rose-500",
      "from-amber-400 to-orange-500",
      "from-emerald-400 to-teal-500",
      "from-violet-400 to-fuchsia-500",
    ];
    const s: AtlasStack = {
      id: uid(),
      name,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
    setStacks((arr) => [...arr, s]);
    return s.id;
  }, []);

  const addDownload = useCallback((d: Omit<AtlasDownload, "id" | "receivedAt">) => {
    setDownloads((arr) => [{ ...d, id: uid(), receivedAt: Date.now() }, ...arr]);
  }, []);

  const clearDownloads = useCallback(() => setDownloads([]), []);

  const active = tabs.find((t) => t.id === activeId);

  return {
    tabs,
    stacks,
    activeId,
    active,
    downloads,
    setActiveId,
    openTab,
    navigateActive,
    closeTab,
    togglePin,
    moveToStack,
    toggleStack,
    addStack,
    addDownload,
    clearDownloads,
  };
}
