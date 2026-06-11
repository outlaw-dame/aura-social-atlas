import { Music, Pause, PictureInPicture2, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function MiniPlayer({ onClose }: { onClose: () => void }) {
  const [pos, setPos] = useState({ x: 24, y: typeof window !== "undefined" ? window.innerHeight - 160 : 600 });
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0.42);
  const dragging = useRef<{ ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setProgress((p) => (p >= 1 ? 0 : p + 0.005)), 250);
    return () => clearInterval(i);
  }, [playing]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      setPos({ x: e.clientX - dragging.current.ox, y: e.clientY - dragging.current.oy });
    }
    function onUp() {
      dragging.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      className="liquid-glass specular fixed z-50 flex w-72 items-center gap-3 rounded-2xl p-3 ring-1 ring-black/5 shadow-2xl dark:ring-white/10"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dragging.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top };
      }}
    >
      <div className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-white">
        <Music className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Liquid Skies</p>
        <p className="truncate text-[11px] text-zinc-500">Astral Currents · Side B</p>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-full bg-zinc-900 dark:bg-white" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <button className="grid size-6 place-items-center text-zinc-600 dark:text-zinc-300">
            <SkipBack className="size-3.5" />
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="grid size-7 place-items-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button className="grid size-6 place-items-center text-zinc-600 dark:text-zinc-300">
            <SkipForward className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button title="Picture in picture" className="grid size-5 place-items-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            <PictureInPicture2 className="size-3" />
          </button>
          <button onClick={onClose} title="Close" className="grid size-5 place-items-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            <X className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
