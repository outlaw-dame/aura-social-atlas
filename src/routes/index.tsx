import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Cloud,
  CloudSun,
  Compass,
  Lock,
  Moon,
  Plus,
  RotateCw,
  Search,
  Send,
  Shield,
  Sparkle,
  Sun,
  X,
  CloudRain,
  CloudSnow,
} from "lucide-react";

import newsArchitecture from "@/assets/news-architecture.jpg";
import newsSpace from "@/assets/news-space.jpg";
import newsDesign from "@/assets/news-design.jpg";
import newsTravel from "@/assets/news-travel.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atlas — A calmer browser" },
      { name: "description", content: "Atlas is a beautiful native-feeling browser with a built-in AI assistant, daily weather, and a Paper-inspired news feed." },
    ],
  }),
  component: Browser,
});

// ────────────────────────────────────────────────────────────────────────────
// Data
// ────────────────────────────────────────────────────────────────────────────

type NewsArticle = {
  id: string;
  category: string;
  title: string;
  excerpt: string;
  image: string;
  size: "lead" | "regular";
  url: string;
};

const ARTICLES: NewsArticle[] = [
  {
    id: "a1",
    category: "Culture",
    title: "Architecture's New Transparency: The Rise of Liquid Glass Surfaces",
    excerpt:
      "How material scientists and architects are rethinking facades for a softer, more refractive urban silhouette.",
    image: newsArchitecture,
    size: "lead",
    url: "https://www.architecturaldigest.com/",
  },
  {
    id: "a2",
    category: "Science",
    title: "Beyond the Event Horizon: Mapping the Unseen Core of Our Galaxy",
    excerpt:
      "New radiographic imaging reveals a dance of stars more complex than theory once predicted.",
    image: newsSpace,
    size: "regular",
    url: "https://www.nasa.gov/",
  },
  {
    id: "a3",
    category: "Design",
    title: "Tactile Minimalism: Why Functional Art is Returning to the Living Room",
    excerpt:
      "A movement away from cold surfaces toward materials that quietly invite the human touch.",
    image: newsDesign,
    size: "regular",
    url: "https://www.dezeen.com/",
  },
  {
    id: "a4",
    category: "Travel",
    title: "Slow Coastlines: The Quiet Resurgence of the Mediterranean Off-Season",
    excerpt:
      "Travelers are trading peak summers for pastel mornings and empty harbors along the coast.",
    image: newsTravel,
    size: "regular",
    url: "https://www.cntraveler.com/",
  },
];

const SPACES = [
  { id: "general", name: "General", color: "from-sky-400 to-indigo-500" },
  { id: "research", name: "Research", color: "from-amber-400 to-orange-500" },
  { id: "design", name: "Design", color: "from-emerald-400 to-teal-500" },
  { id: "personal", name: "Personal", color: "from-pink-400 to-rose-500" },
];

const SUGGESTED_PROMPTS = [
  "Summarize today's headlines",
  "Open GitHub",
  "Search for the best espresso in San Francisco",
  "What's the weather like tomorrow?",
];

// ────────────────────────────────────────────────────────────────────────────
// Weather (Open-Meteo, no key required)
// ────────────────────────────────────────────────────────────────────────────

type Weather = {
  city: string;
  temp: number;
  high: number;
  low: number;
  precip: number;
  description: string;
  code: number;
};

function weatherText(code: number): string {
  if (code === 0) return "Clear";
  if ([1, 2].includes(code)) return "Mostly Clear";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Partly Cloudy";
}

function WeatherIcon({ code }: { code: number }) {
  const cls = "size-16 text-zinc-700/80";
  if (code === 0) return <Sun className={cls} strokeWidth={1.5} />;
  if ([1, 2].includes(code)) return <CloudSun className={cls} strokeWidth={1.5} />;
  if ([61, 63, 65, 80, 81, 82, 51, 53, 55].includes(code))
    return <CloudRain className={cls} strokeWidth={1.5} />;
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return <CloudSnow className={cls} strokeWidth={1.5} />;
  return <Cloud className={cls} strokeWidth={1.5} />;
}

function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(lat: number, lon: number, city: string) {
      try {
        const u = new URL("https://api.open-meteo.com/v1/forecast");
        u.searchParams.set("latitude", String(lat));
        u.searchParams.set("longitude", String(lon));
        u.searchParams.set("current", "temperature_2m,weather_code,precipitation");
        u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
        u.searchParams.set("temperature_unit", "fahrenheit");
        u.searchParams.set("timezone", "auto");
        const res = await fetch(u.toString());
        const data = await res.json();
        if (cancelled) return;
        const code = data.current?.weather_code ?? 1;
        setWeather({
          city,
          temp: Math.round(data.current?.temperature_2m ?? 68),
          high: Math.round(data.daily?.temperature_2m_max?.[0] ?? 72),
          low: Math.round(data.daily?.temperature_2m_min?.[0] ?? 54),
          precip: Math.round((data.current?.precipitation ?? 0) * 100),
          description: weatherText(code),
          code,
        });
      } catch {
        if (!cancelled)
          setWeather({
            city,
            temp: 68,
            high: 72,
            low: 54,
            precip: 4,
            description: "Partly Cloudy",
            code: 2,
          });
      }
    }

    // Default to San Francisco; try geolocation but don't block
    load(37.7749, -122.4194, "San Francisco");
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const r = await fetch(
              `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&count=1`
            );
            const j = await r.json();
            const city = j.results?.[0]?.name ?? "Nearby";
            load(pos.coords.latitude, pos.coords.longitude, city);
          } catch {
            load(pos.coords.latitude, pos.coords.longitude, "Nearby");
          }
        },
        () => {},
        { timeout: 4000 }
      );
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return weather;
}

// ────────────────────────────────────────────────────────────────────────────
// Browser shell
// ────────────────────────────────────────────────────────────────────────────

type ViewState = { kind: "home" } | { kind: "web"; url: string; title: string };

function Browser() {
  const [view, setView] = useState<ViewState>({ kind: "home" });
  const [history, setHistory] = useState<ViewState[]>([{ kind: "home" }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [activeSpace, setActiveSpace] = useState("general");
  const [addressInput, setAddressInput] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const weather = useWeather();

  const navigateTo = (url: string, title?: string) => {
    let normalized = url.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) {
      if (normalized.includes(".") && !normalized.includes(" ")) {
        normalized = `https://${normalized}`;
      } else {
        normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
      }
    }
    const next: ViewState = {
      kind: "web",
      url: normalized,
      title: title ?? new URL(normalized).hostname.replace(/^www\./, ""),
    };
    const newHistory = [...history.slice(0, historyIdx + 1), next];
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
    setView(next);
    setAddressInput("");
  };

  const goHome = () => {
    const home: ViewState = { kind: "home" };
    const newHistory = [...history.slice(0, historyIdx + 1), home];
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
    setView(home);
  };

  const goBack = () => {
    if (historyIdx === 0) return;
    const idx = historyIdx - 1;
    setHistoryIdx(idx);
    setView(history[idx]);
  };
  const goForward = () => {
    if (historyIdx >= history.length - 1) return;
    const idx = historyIdx + 1;
    setHistoryIdx(idx);
    setView(history[idx]);
  };

  const addressDisplay =
    view.kind === "home" ? "atlas.new/home" : view.url.replace(/^https?:\/\//, "");

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] -top-[20%] size-[60vw] rounded-full bg-sky-200/30 blur-[140px] dark:bg-sky-500/10" />
        <div className="absolute -right-[10%] top-[40%] size-[50vw] rounded-full bg-orange-200/25 blur-[140px] dark:bg-amber-500/10" />
        <div className="absolute bottom-[-20%] left-[20%] size-[50vw] rounded-full bg-rose-200/20 blur-[140px] dark:bg-fuchsia-500/10" />
      </div>

      {/* Top chrome */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-20 items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-2">
          <button
            onClick={goBack}
            disabled={historyIdx === 0}
            className="liquid-glass specular grid size-10 place-items-center rounded-full ring-1 ring-black/5 transition active:scale-95 disabled:opacity-40 dark:ring-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
          </button>
          <button
            onClick={goForward}
            disabled={historyIdx >= history.length - 1}
            className="liquid-glass specular grid size-10 place-items-center rounded-full ring-1 ring-black/5 transition active:scale-95 disabled:opacity-40 dark:ring-white/10"
            aria-label="Forward"
          >
            <ArrowRight className="size-4" strokeWidth={2} />
          </button>
          <button
            onClick={() => view.kind === "web" && navigateTo(view.url)}
            className="liquid-glass specular grid size-10 place-items-center rounded-full ring-1 ring-black/5 transition active:scale-95 dark:ring-white/10"
            aria-label="Reload"
          >
            <RotateCw className="size-4" strokeWidth={2} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (addressInput.trim()) navigateTo(addressInput);
          }}
          className="flex flex-1 justify-center"
        >
          <div className="liquid-glass specular flex h-12 w-full max-w-2xl items-center gap-3 rounded-full px-5 ring-1 ring-black/5 dark:ring-white/10">
            <Lock className="size-3.5 shrink-0 text-zinc-500" />
            <Search className="size-4 shrink-0 text-zinc-400" />
            <input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder={addressDisplay}
              className="flex-1 bg-transparent text-sm font-medium text-zinc-800 placeholder:font-normal placeholder:text-zinc-500 focus:outline-none dark:text-zinc-100"
            />
            <div className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 sm:flex dark:text-emerald-400">
              <Shield className="size-3" />
              Private
            </div>
          </div>
        </form>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDarkMode((v) => !v)}
            className="liquid-glass specular grid size-10 place-items-center rounded-full ring-1 ring-black/5 transition active:scale-95 dark:ring-white/10"
            aria-label="Toggle theme"
          >
            <Moon className="size-4" strokeWidth={2} />
          </button>
          <button
            onClick={goHome}
            className="liquid-glass specular grid size-10 place-items-center rounded-full ring-1 ring-black/5 transition active:scale-95 dark:ring-white/10"
            aria-label="New tab"
          >
            <Plus className="size-4" strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* Main viewport */}
      <main className="pb-32 pt-28">
        {view.kind === "home" ? (
          <HomeView
            weather={weather}
            articles={ARTICLES}
            onOpenArticle={(a) => navigateTo(a.url, a.title)}
            onSearch={(q) => navigateTo(q)}
          />
        ) : (
          <WebView view={view} />
        )}
      </main>

      {/* Bottom space picker */}
      <div className="fixed bottom-8 left-1/2 z-30 -translate-x-1/2">
        <div className="liquid-glass specular flex items-center gap-1 rounded-full px-2 py-2 ring-1 ring-black/5 dark:ring-white/10">
          {SPACES.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSpace(s.id)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                activeSpace === s.id
                  ? "bg-zinc-900/10 text-zinc-900 dark:bg-white/10 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <span
                className={`size-2 rounded-full bg-gradient-to-br ${s.color}`}
              />
              {s.name}
            </button>
          ))}
          <div className="mx-1 h-4 w-px bg-zinc-900/10 dark:bg-white/10" />
          <button
            onClick={goHome}
            className="grid size-7 place-items-center rounded-full text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            aria-label="New space"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* AI assistant */}
      <AssistantOverlay
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        onNavigate={navigateTo}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Home (weather hero + Paper-style feed + spaces)
// ────────────────────────────────────────────────────────────────────────────

function HomeView({
  weather,
  articles,
  onOpenArticle,
  onSearch,
}: {
  weather: Weather | null;
  articles: NewsArticle[];
  onOpenArticle: (a: NewsArticle) => void;
  onSearch: (q: string) => void;
}) {
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Working late";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const dateStr = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    []
  );

  const lead = articles.find((a) => a.size === "lead")!;
  const rest = articles.filter((a) => a.id !== lead.id);

  return (
    <div className="mx-auto max-w-7xl px-8">
      {/* Greeting */}
      <div className="mb-8 flex items-baseline justify-between animate-float-up">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {dateStr}
          </p>
          <h1 className="font-serif text-5xl italic tracking-tight text-zinc-900 dark:text-zinc-100">
            {greeting}.
          </h1>
        </div>
      </div>

      {/* Weather hero */}
      <section className="mb-14 animate-float-up" style={{ animationDelay: "60ms" }}>
        <div className="liquid-glass specular relative flex flex-col gap-8 overflow-hidden rounded-[28px] p-8 ring-1 ring-black/5 sm:flex-row sm:items-end sm:justify-between dark:ring-white/10">
          <div className="absolute -right-20 -top-20 size-64 rounded-full bg-gradient-to-br from-orange-300/40 via-rose-200/30 to-sky-300/40 blur-3xl" />
          <div className="relative">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Local Conditions
            </p>
            <h2 className="mb-6 max-w-md text-balance font-serif text-3xl leading-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">
              {weather
                ? `${weather.description} over ${weather.city}`
                : "Loading current conditions…"}
            </h2>
            <div className="flex items-end gap-8">
              <div>
                <span className="text-5xl font-light tracking-tight">
                  {weather ? `${weather.temp}°` : "—"}
                </span>
                <span className="mt-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Current
                </span>
              </div>
              <div>
                <span className="text-3xl font-light tracking-tight text-zinc-700 dark:text-zinc-300">
                  {weather ? `${weather.high}°` : "—"}
                </span>
                <span className="mt-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                  High
                </span>
              </div>
              <div>
                <span className="text-3xl font-light tracking-tight text-zinc-700 dark:text-zinc-300">
                  {weather ? `${weather.low}°` : "—"}
                </span>
                <span className="mt-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Low
                </span>
              </div>
            </div>
          </div>
          <div className="relative flex items-center gap-6 sm:flex-col sm:items-end">
            <WeatherIcon code={weather?.code ?? 2} />
            <div className="sm:text-right">
              <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">
                Precipitation {weather?.precip ?? 0}%
              </p>
              <p className="text-xs text-zinc-500">Updated just now</p>
            </div>
          </div>
        </div>
      </section>

      {/* Paper-style horizontal feed */}
      <section className="mb-14 animate-float-up" style={{ animationDelay: "120ms" }}>
        <div className="mb-6 flex items-baseline justify-between px-1">
          <h3 className="font-serif text-2xl italic text-zinc-800 dark:text-zinc-200">
            The Daily Digest
          </h3>
          <button className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
            Customize Feed
          </button>
        </div>

        <div className="no-scrollbar -mx-8 flex snap-x snap-mandatory gap-6 overflow-x-auto px-8 pb-6">
          {/* Lead card */}
          <article
            onClick={() => onOpenArticle(lead)}
            className="group flex-none w-[480px] cursor-pointer snap-start"
          >
            <div className="relative mb-5 aspect-[3/4] overflow-hidden rounded-[24px] ring-1 ring-black/5 dark:ring-white/10">
              <img
                src={lead.image}
                alt={lead.title}
                width={896}
                height={1152}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
            </div>
            <div className="max-w-[44ch] px-1">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">
                {lead.category}
              </p>
              <h4 className="mb-3 text-balance font-serif text-2xl leading-tight text-zinc-900 dark:text-zinc-100">
                {lead.title}
              </h4>
              <p className="text-pretty text-sm leading-relaxed text-zinc-500">
                {lead.excerpt}
              </p>
            </div>
          </article>

          {rest.map((a) => (
            <article
              key={a.id}
              onClick={() => onOpenArticle(a)}
              className="group flex-none w-[420px] cursor-pointer snap-start"
            >
              <div className="relative mb-5 aspect-[3/4] overflow-hidden rounded-[24px] ring-1 ring-black/5 dark:ring-white/10">
                <img
                  src={a.image}
                  alt={a.title}
                  width={896}
                  height={1152}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
              </div>
              <div className="max-w-[40ch] px-1">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">
                  {a.category}
                </p>
                <h4 className="mb-3 text-balance font-serif text-xl leading-tight text-zinc-900 dark:text-zinc-100">
                  {a.title}
                </h4>
                <p className="text-pretty text-sm leading-relaxed text-zinc-500">
                  {a.excerpt}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Quick spaces / shortcuts (from option 1 article layout) */}
      <section className="mb-10 animate-float-up" style={{ animationDelay: "180ms" }}>
        <h3 className="mb-6 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Active Spaces
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Product Design", icon: Compass, color: "bg-indigo-500/15 text-indigo-600" },
            { label: "Research Notes", icon: Sparkle, color: "bg-orange-500/15 text-orange-600" },
            { label: "Social Feed", icon: Cloud, color: "bg-emerald-500/15 text-emerald-600" },
            { label: "Atlas AI", icon: Sparkle, color: "bg-sky-500/15 text-sky-600", accent: true },
          ].map((s) => (
            <button
              key={s.label}
              onClick={() => onSearch(s.label)}
              className={`liquid-glass specular flex items-center gap-4 rounded-2xl px-4 py-4 ring-1 ring-black/5 transition hover:-translate-y-0.5 dark:ring-white/10 ${
                s.accent ? "ring-sky-400/40 dark:ring-sky-400/30" : ""
              }`}
            >
              <div className={`grid size-10 place-items-center rounded-xl ${s.color}`}>
                <s.icon className="size-5" />
              </div>
              <span className="text-sm font-medium">{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Suggested AI prompts */}
      <section className="animate-float-up" style={{ animationDelay: "240ms" }}>
        <h3 className="mb-4 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Ask Atlas
        </h3>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onSearch(p)}
              className="liquid-glass specular rounded-full px-4 py-2 text-sm text-zinc-700 ring-1 ring-black/5 transition hover:-translate-y-0.5 dark:text-zinc-200 dark:ring-white/10"
            >
              {p}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Web view (sandboxed iframe; many sites disallow framing — fallback link)
// ────────────────────────────────────────────────────────────────────────────

function WebView({ view }: { view: Extract<ViewState, { kind: "web" }> }) {
  return (
    <div className="mx-auto max-w-7xl px-8">
      <div className="liquid-glass specular relative h-[calc(100vh-12rem)] overflow-hidden rounded-[28px] ring-1 ring-black/5 dark:ring-white/10">
        <iframe
          key={view.url}
          src={view.url}
          title={view.title}
          className="h-full w-full bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
          <a
            href={view.url}
            target="_blank"
            rel="noreferrer"
            className="liquid-glass specular pointer-events-auto rounded-full px-4 py-2 text-xs font-medium text-zinc-700 ring-1 ring-black/5 dark:text-zinc-200 dark:ring-white/10"
          >
            Page won't load? Open in a new window →
          </a>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AI Assistant
// ────────────────────────────────────────────────────────────────────────────

function AssistantOverlay({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (url: string, title?: string) => void;
}) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error } = useChat({
    transport,
    onError: (e) => console.error("chat error", e),
  });

  // Watch for navigate_to tool calls and execute them in the browser
  const handledToolCallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts) {
        // AI SDK v5: tool parts are typed as `tool-${toolName}` with toolCallId
        const anyPart = part as { type: string; toolCallId?: string; input?: { url?: string; reason?: string } };
        if (anyPart.type === "tool-navigate_to" && anyPart.toolCallId) {
          if (handledToolCallsRef.current.has(anyPart.toolCallId)) continue;
          const url = anyPart.input?.url;
          if (url) {
            handledToolCallsRef.current.add(anyPart.toolCallId);
            onNavigate(url, anyPart.input?.reason);
          }
        }
      }
    }
  }, [messages, onNavigate]);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = () => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  };

  const busy = status === "streaming" || status === "submitted";

  return (
    <>
      {/* Floating orb */}
      <button
        onClick={() => onOpenChange(!open)}
        className="fixed bottom-8 right-8 z-50 grid size-16 place-items-center rounded-full transition active:scale-95"
        aria-label="Open AI assistant"
      >
        <span className="absolute inset-0 animate-orb-pulse rounded-full bg-sky-400/35 blur-xl" />
        <span className="liquid-glass specular relative grid size-16 place-items-center rounded-full ring-1 ring-white/60 dark:ring-white/10">
          <span className="orb-glow grid size-9 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-sky-500 to-indigo-500 text-white">
            <Sparkle className="size-4 fill-white" strokeWidth={2} />
          </span>
        </span>
      </button>

      {/* Chat sheet */}
      {open && (
        <div
          className="liquid-glass specular fixed bottom-28 right-8 z-50 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[28px] shadow-2xl ring-1 ring-black/5 animate-float-up dark:ring-white/10"
          style={{ height: "min(38rem, calc(100vh - 10rem))" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="orb-glow grid size-8 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
                <Sparkle className="size-3.5 fill-white" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Atlas AI</p>
                <p className="text-[11px] text-zinc-500">Your browsing companion</p>
              </div>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="grid size-8 place-items-center rounded-full text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.length === 0 && (
              <div className="space-y-4">
                <p className="text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  Hi — I'm Atlas. I can answer questions, summarize what you're reading, or open sites and run searches for you. Try one:
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage({ text: p })}
                      className="rounded-2xl bg-white/50 px-4 py-2.5 text-left text-sm text-zinc-800 ring-1 ring-black/5 transition hover:bg-white/80 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            {busy && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400" />
                <span className="ml-2 italic">Thinking…</span>
              </div>
            )}

            {error && (
              <div className="rounded-2xl bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                Something went wrong. Please try again.
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-black/5 p-4 dark:border-white/10">
            <div className="relative flex items-end gap-2 rounded-3xl bg-white/60 px-4 py-2.5 ring-1 ring-black/5 focus-within:ring-sky-400/40 dark:bg-white/5 dark:ring-white/10">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask anything, or say 'open github.com'…"
                rows={1}
                className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:outline-none dark:text-zinc-100"
              />
              <button
                onClick={submit}
                disabled={busy || !input.trim()}
                className="grid size-9 place-items-center rounded-full bg-zinc-900 text-white transition active:scale-95 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                aria-label="Send"
              >
                {busy ? <Send className="size-4" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .map((p) => (p.type === "text" ? (p as { type: "text"; text: string }).text : ""))
    .join("");

  const toolParts = message.parts.filter((p) =>
    (p as { type: string }).type.startsWith("tool-")
  ) as Array<{
    type: string;
    toolCallId?: string;
    input?: { url?: string; reason?: string };
    state?: string;
  }>;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] space-y-2 ${isUser ? "items-end" : "items-start"}`}>
        {text && (
          <div
            className={
              isUser
                ? "rounded-3xl rounded-tr-md bg-sky-500 px-4 py-2.5 text-sm text-white shadow-sm"
                : "prose-chat text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
            }
          >
            {isUser ? text : <ReactMarkdown>{text}</ReactMarkdown>}
          </div>
        )}
        {toolParts.map((tp) => (
          <div
            key={tp.toolCallId}
            className="rounded-2xl bg-sky-500/10 px-3 py-2 text-xs text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-300"
          >
            <div className="mb-0.5 flex items-center gap-1.5 font-semibold uppercase tracking-wider">
              <Compass className="size-3" />
              {tp.input?.reason ?? "Navigating"}
            </div>
            <div className="truncate text-[11px] opacity-70">{tp.input?.url}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
