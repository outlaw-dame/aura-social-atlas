import {
  AppWindow,
  Layers,
  Palette,
  Plug,
  Search as SearchIcon,
  Shield,
  User,
  UserCircle2,
} from "lucide-react";
import { useState } from "react";

type Section =
  | "account"
  | "tabs"
  | "privacy"
  | "profiles"
  | "apps"
  | "appearance"
  | "search";

const NAV: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "tabs", label: "Tabs", icon: Layers },
  { id: "privacy", label: "Privacy & Security", icon: Shield },
  { id: "profiles", label: "Profiles", icon: UserCircle2 },
  { id: "apps", label: "Connected Apps", icon: Plug },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "search", label: "Search", icon: SearchIcon },
];

export function SettingsView({
  darkMode,
  onDarkModeChange,
}: {
  darkMode: boolean;
  onDarkModeChange: (v: boolean) => void;
}) {
  const [section, setSection] = useState<Section>("account");

  return (
    <div className="mx-auto flex max-w-5xl gap-6 px-8 py-4">
      {/* Settings nav */}
      <nav className="liquid-glass specular sticky top-4 h-fit w-56 shrink-0 rounded-3xl p-3 ring-1 ring-black/5 dark:ring-white/10">
        <p className="px-3 pb-3 pt-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Settings
        </p>
        <ul className="space-y-0.5">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setSection(n.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                  section === n.id
                    ? "bg-white/80 text-zinc-900 ring-1 ring-sky-400/30 dark:bg-white/10 dark:text-white"
                    : "text-zinc-600 hover:bg-white/50 dark:text-zinc-300 dark:hover:bg-white/5"
                }`}
              >
                <n.icon className="size-4" />
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Section */}
      <div className="liquid-glass specular flex-1 rounded-3xl p-8 ring-1 ring-black/5 dark:ring-white/10">
        {section === "account" && <Account />}
        {section === "tabs" && <Tabs />}
        {section === "privacy" && <Privacy />}
        {section === "profiles" && <Profiles />}
        {section === "apps" && <Apps />}
        {section === "appearance" && (
          <Appearance darkMode={darkMode} onDarkModeChange={onDarkModeChange} />
        )}
        {section === "search" && <SearchSettings />}
      </div>
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-serif text-3xl italic tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-black/5 py-4 last:border-0 dark:border-white/10">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 rounded-full transition ${
        on ? "bg-sky-500" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${
          on ? "left-[1.125rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Account() {
  return (
    <>
      <Heading title="Account" subtitle="Your Atlas identity, sync, and subscription." />
      <div className="mb-6 flex items-center gap-4">
        <div className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-2xl font-semibold text-white">
          A
        </div>
        <div>
          <p className="text-lg font-medium">Atlas Explorer</p>
          <p className="text-sm text-zinc-500">explorer@atlas.app</p>
        </div>
        <button className="ml-auto rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
          Manage
        </button>
      </div>
      <Row label="Cloud sync" hint="Sync tabs, pins, and stacks across devices.">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="Atlas+ subscription" hint="Higher AI limits, advanced spaces, priority support.">
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
          Trial
        </span>
      </Row>
      <Row label="Sign out" hint="Remove your account from this device.">
        <button className="text-xs font-medium text-rose-600">Sign out</button>
      </Row>
    </>
  );
}

function Tabs() {
  return (
    <>
      <Heading title="Tabs" subtitle="Control how Atlas opens, groups, and archives tabs." />
      <Row label="Vertical sidebar" hint="Always show tabs in a vertical list (Dia-style).">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="Auto-stack related tabs" hint="Group tabs from related sources (Opera One-style).">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="Archive after" hint="Close inactive tabs automatically.">
        <select className="rounded-md bg-white/70 px-3 py-1 text-sm ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/10">
          <option>12 hours</option>
          <option>24 hours</option>
          <option>7 days</option>
          <option>Never</option>
        </select>
      </Row>
      <Row label="Confirm before closing many tabs">
        <Toggle on onChange={() => {}} />
      </Row>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Heading
        title="Privacy & Security"
        subtitle="Atlas blocks trackers by default and never sells your data."
      />
      <Row label="Block third-party trackers">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="Block fingerprinting" hint="Reduces cross-site tracking signals.">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="HTTPS-only mode">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="Send 'Do Not Track' request">
        <Toggle on onChange={() => {}} />
      </Row>
      <Row label="Clear browsing data" hint="Cookies, cache, history.">
        <button className="rounded-full bg-rose-500/10 px-4 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">
          Clear…
        </button>
      </Row>
    </>
  );
}

function Profiles() {
  const profiles = [
    { id: "p1", name: "Personal", color: "from-sky-400 to-indigo-500" },
    { id: "p2", name: "Work", color: "from-emerald-400 to-teal-500" },
    { id: "p3", name: "Travel", color: "from-pink-400 to-rose-500" },
  ];
  return (
    <>
      <Heading
        title="Profiles"
        subtitle="Keep separate histories, logins, and pinned tabs for each part of your life."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {profiles.map((p) => (
          <div
            key={p.id}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white/60 p-4 ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10"
          >
            <div
              className={`grid size-14 place-items-center rounded-full bg-gradient-to-br ${p.color} text-lg font-semibold text-white`}
            >
              {p.name.slice(0, 1)}
            </div>
            <p className="text-sm font-medium">{p.name}</p>
            <button className="text-[11px] uppercase tracking-wider text-sky-600">Switch</button>
          </div>
        ))}
        <button className="grid place-items-center rounded-2xl border border-dashed border-black/15 p-4 text-sm text-zinc-500 hover:bg-white/40 dark:border-white/15 dark:hover:bg-white/5">
          + New profile
        </button>
      </div>
    </>
  );
}

function Apps() {
  const apps = [
    { name: "GitHub", status: "Connected", desc: "Search repos and open issues inline." },
    { name: "Notion", status: "Connected", desc: "Send pages and clips to your workspace." },
    { name: "Linear", status: "Not connected", desc: "Create issues from any tab." },
    { name: "Spotify", status: "Connected", desc: "Powers the mini-player." },
  ];
  return (
    <>
      <Heading
        title="Connected Apps"
        subtitle="Atlas integrates with the tools you already use."
      />
      <ul className="divide-y divide-black/5 dark:divide-white/10">
        {apps.map((a) => (
          <li key={a.name} className="flex items-center gap-4 py-4">
            <div className="grid size-10 place-items-center rounded-xl bg-zinc-900/5 dark:bg-white/10">
              <AppWindow className="size-5 text-zinc-700 dark:text-zinc-300" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-zinc-500">{a.desc}</p>
            </div>
            <button
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                a.status === "Connected"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              }`}
            >
              {a.status === "Connected" ? "Manage" : "Connect"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Appearance({
  darkMode,
  onDarkModeChange,
}: {
  darkMode: boolean;
  onDarkModeChange: (v: boolean) => void;
}) {
  return (
    <>
      <Heading title="Appearance" subtitle="Theme, density, and Liquid Glass intensity." />
      <Row label="Theme" hint="Atlas adapts surfaces and glass to your system.">
        <div className="flex gap-2">
          {(["Light", "Dark", "Auto"] as const).map((t) => {
            const isActive =
              (t === "Dark" && darkMode) || (t === "Light" && !darkMode);
            return (
              <button
                key={t}
                onClick={() => t !== "Auto" && onDarkModeChange(t === "Dark")}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                  isActive
                    ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                    : "bg-white/60 ring-black/10 dark:bg-white/5 dark:ring-white/10"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Glass intensity" hint="Background blur and translucency.">
        <input type="range" min={0} max={100} defaultValue={72} className="accent-sky-500" />
      </Row>
      <Row label="Reduce motion">
        <Toggle on={false} onChange={() => {}} />
      </Row>
    </>
  );
}

function SearchSettings() {
  const engines = [
    { name: "Atlas AI", desc: "Conversational answers powered by Atlas." },
    { name: "Google", desc: "google.com/search" },
    { name: "DuckDuckGo", desc: "Privacy-first results." },
    { name: "Kagi", desc: "Premium, ad-free search." },
    { name: "Brave", desc: "Independent index." },
  ];
  return (
    <>
      <Heading title="Search" subtitle="Choose your default engine and AI behavior." />
      <ul className="divide-y divide-black/5 dark:divide-white/10">
        {engines.map((e, i) => (
          <li key={e.name} className="flex items-center gap-3 py-3">
            <input
              type="radio"
              name="engine"
              defaultChecked={i === 0}
              className="size-4 accent-sky-500"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">{e.name}</p>
              <p className="text-xs text-zinc-500">{e.desc}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <Row label="Show AI answers above results">
          <Toggle on onChange={() => {}} />
        </Row>
        <Row label="Open AI assistant on highlight">
          <Toggle on={false} onChange={() => {}} />
        </Row>
      </div>
    </>
  );
}
