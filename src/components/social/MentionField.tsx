import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { searchFedizenPeople } from '@/lib/fedizen.functions';
import type { FedizenPerson } from '@/lib/fedizen-feed';
import { insertMention, mentionQueryAt, mentionSegments, mergeSuggestions } from '@/lib/mentions';
import { useAtlasAuth } from './AuthState';

type Person = Pick<FedizenPerson, 'handle' | 'name' | 'avatar'>;

/** Fedizen people matching what follows "@", asked for after a short pause in typing. */
function usePeopleSearch(query: string | null) {
  const { user } = useAtlasAuth();
  const search = useServerFn(searchFedizenPeople);
  const [q, setQ] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(query), 180); return () => clearTimeout(t); }, [query]);
  const uid = user?.id;
  return useQuery({
    queryKey: ['fedizen-people', uid, q],
    queryFn: () => search({ data: { expectedAtlasUserId: uid!, q: q! } }),
    enabled: !!uid && !!q && /^[A-Za-z0-9_.-]{1,64}(@[A-Za-z0-9.-]{0,253})?$/.test(q),
    staleTime: 5 * 60_000,
  });
}

function Face({ p }: { p: Person }) {
  const [broken, setBroken] = useState(false);
  return p.avatar && !broken
    ? <img src={p.avatar} alt="" width={28} height={28} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
    : <span aria-hidden="true">{p.name.charAt(0)}</span>;
}

/**
 * A reply box that does mentions the way iMessage does: type "@" and the start of a name, and the people it could be
 * appear in a strip under the box (just above the keyboard on a phone) with their picture and name. Picking one puts
 * their handle in the text, tinted in the accent colour so it reads as a person; plain typing stays plain. The tint is
 * drawn by a copy of the text behind a transparent-text textarea, so the field stays an ordinary, accessible textarea.
 */
export function MentionField({ value, onChange, confirmed, onConfirm, people = [], placeholder, autoFocus, maxLength = 5000, onSubmit, label }: {
  value: string; onChange: (v: string) => void;
  /** Mention tokens to tint ("@ana"); the reply's opening mention starts here. */
  confirmed: string[]; onConfirm: (token: string) => void;
  /** People to offer first (the author being replied to). */
  people?: Person[];
  placeholder?: string; autoFocus?: boolean; maxLength?: number; onSubmit?: () => void; label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const at = mentionQueryAt(value, caret);
  const open = !!at && dismissed !== at.start;
  const found = usePeopleSearch(open && at!.query.length > 0 ? at!.query : null);
  const suggestions = open ? mergeSuggestions(at!.query, people, found.data?.people ?? []) : [];
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [at?.query]);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const t = ref.current;
    if (t && pending.current != null) { t.setSelectionRange(pending.current, pending.current); setCaret(pending.current); pending.current = null; }
  }, [value]);
  const sync = () => { const t = ref.current; if (t) { setCaret(t.selectionStart ?? t.value.length); if (mirror.current) mirror.current.scrollTop = t.scrollTop; } };

  const pick = (p: Person) => {
    if (!at) return;
    const next = insertMention(value, at.start, caret, p.handle);
    onConfirm(next.text.slice(at.start, next.caret).trim());
    pending.current = next.caret;
    onChange(next.text);
    ref.current?.focus();
  };

  return <div className="atlas-mention">
    <div className="atlas-mention-field">
      <div ref={mirror} className="atlas-mention-mirror" aria-hidden="true">
        {mentionSegments(value, confirmed).map((s, i) => (s.mention ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}{'​'}
      </div>
      <textarea ref={ref} value={value} maxLength={maxLength} placeholder={placeholder} autoFocus={autoFocus} aria-label={label}
        role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="atlas-mention-list"
        aria-activedescendant={suggestions.length ? `atlas-mention-${active}` : undefined}
        onChange={e => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
        onSelect={sync} onClick={sync} onKeyUp={sync} onScroll={sync}
        onKeyDown={e => {
          if (suggestions.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); setActive(a => (a + 1) % suggestions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + suggestions.length) % suggestions.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setDismissed(at!.start); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit?.(); }
        }} />
    </div>
    {open && <div id="atlas-mention-list" className="atlas-mention-bar" role="listbox" aria-label="People to mention">
      <button type="button" className="atlas-mention-typed" onMouseDown={e => e.preventDefault()} onClick={() => setDismissed(at!.start)}>“@{at!.query}”</button>
      {suggestions.map((p, i) => <button key={p.handle} id={`atlas-mention-${i}`} type="button" role="option" aria-selected={i === active}
        className={i === active ? 'active' : ''} onMouseDown={e => e.preventDefault()} onClick={() => pick(p)} title={p.handle}>
        <Face p={p} /><span>{p.name}</span>
      </button>)}
      {!suggestions.length && found.isFetching && <span className="atlas-mention-hint">Looking…</span>}
    </div>}
  </div>;
}
