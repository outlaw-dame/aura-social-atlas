import { Download, FileText, Trash2 } from "lucide-react";
import type { AtlasDownload } from "@/lib/atlas-tabs";

export function DownloadsView({
  downloads,
  onClear,
}: {
  downloads: AtlasDownload[];
  onClear: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-4">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Atlas · Library
          </p>
          <h1 className="font-serif text-4xl italic tracking-tight">Downloads</h1>
        </div>
        <button
          onClick={onClear}
          className="liquid-glass specular flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-black/5 dark:ring-white/10"
        >
          <Trash2 className="size-3.5" /> Clear all
        </button>
      </div>

      {downloads.length === 0 ? (
        <div className="liquid-glass specular grid place-items-center rounded-3xl py-20 ring-1 ring-black/5 dark:ring-white/10">
          <Download className="mb-3 size-10 text-zinc-400" strokeWidth={1.5} />
          <p className="text-sm text-zinc-500">No downloads yet.</p>
        </div>
      ) : (
        <ul className="liquid-glass specular divide-y divide-black/5 overflow-hidden rounded-3xl ring-1 ring-black/5 dark:divide-white/10 dark:ring-white/10">
          {downloads.map((d) => (
            <li key={d.id} className="flex items-center gap-4 px-5 py-4">
              <div className="grid size-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600">
                <FileText className="size-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{d.name}</p>
                <p className="text-xs text-zinc-500">
                  {d.size} · from{" "}
                  <a className="story-link" href={d.url} target="_blank" rel="noreferrer">
                    {new URL(d.url).hostname}
                  </a>{" "}
                  · {new Date(d.receivedAt).toLocaleString()}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                  d.status === "complete"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : d.status === "in_progress"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }`}
              >
                {d.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
