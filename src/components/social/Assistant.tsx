import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, PenLine, Send, Sparkle, X } from "lucide-react";
import { Button } from '@/components/ui/button';
const SUGGESTED_PROMPTS = ["What is the open social web?", "How do Mastodon and Bluesky differ?", "Explain RSS feeds"];
export function AssistantOverlay({
  open,
  onOpenChange,
  onNavigate,
  showLauncher = true,
  onCompose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (url: string, title?: string) => void;
  showLauncher?: boolean;
  onCompose?: () => void;
}) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error } = useChat({
    transport,
    onError: (e) => console.error("chat error", e),
  });

  const handledToolCallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts) {
        const anyPart = part as {
          type: string;
          toolCallId?: string;
          input?: { url?: string; reason?: string };
        };
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

  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onScroll = () => { setHidden(true); clearTimeout(t); t = setTimeout(() => setHidden(false), 700); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(t); };
  }, []);

  const busy = status === "streaming" || status === "submitted";

  return (
    <>
      {showLauncher && <button
        onClick={() => onOpenChange(!open)}
        className={`fixed bottom-5 right-5 z-50 grid size-12 place-items-center rounded-full transition duration-300 active:scale-95 sm:bottom-8 sm:right-8 sm:size-14 ${hidden && !open ? "pointer-events-none translate-y-6 opacity-0" : "opacity-100"}`}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
      >
        <span className="absolute inset-0 animate-orb-pulse rounded-full bg-sky-400/35 blur-xl" aria-hidden="true" />
        <span className="liquid-glass specular relative grid size-full place-items-center rounded-full ring-1 ring-white/60 dark:ring-white/10">
          <span className="orb-glow grid size-8 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-sky-500 to-indigo-500 text-white">
            <Sparkle className="size-4 fill-white" strokeWidth={2} aria-hidden="true" />
          </span>
        </span>
      </button>}

      {open && (
        <div
          role="dialog"
          aria-label="Atlas AI assistant"
          className="fixed bottom-24 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl animate-float-up sm:bottom-28 sm:right-8"
          style={{ height: "min(30rem, calc(100dvh - 8rem))" }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="orb-glow grid size-8 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
                <Sparkle className="size-3.5 fill-white" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-semibold">Atlas AI</p>
                <p className="text-[11px] text-zinc-500">Your discovery companion</p>
              </div>
            </div>
            <div className="flex items-center gap-1">{onCompose && <Button variant="ghost" size="icon" aria-label="Return to composer" title="Compose" onClick={onCompose}><PenLine /></Button>}<button
              onClick={() => onOpenChange(false)}
              className="grid size-8 place-items-center rounded-full text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X className="size-4" />
            </button></div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-4">
                <p className="text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  Hi — I'm Atlas. I can answer questions or run searches across the open social web. Try one:
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage({ text: p })}
                      className="rounded-2xl bg-muted px-3 py-2 text-left text-sm text-foreground ring-1 ring-border transition hover:bg-accent/10 dark:bg-muted dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10"
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

          <div className="border-t border-black/5 p-3 dark:border-white/10">
            <div className="relative flex items-end gap-2 rounded-3xl bg-muted px-4 py-2 ring-1 ring-border focus-within:ring-sky-400/40 dark:bg-white/5 dark:ring-white/10">
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
                placeholder="Ask Atlas anything…"
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
  if (!text) return null;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`prose-chat max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "bg-muted text-foreground ring-1 ring-border dark:bg-muted dark:text-zinc-100 dark:ring-white/10"
        }`}
      >
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    </div>
  );
}
