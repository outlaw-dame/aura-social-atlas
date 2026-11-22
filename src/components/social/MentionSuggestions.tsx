import { useEffect, useState } from 'react';
import { insertMention, mentionQueryAt, mergeSuggestions } from '@/lib/mentions';
import { Face, usePeopleSearch, type Person } from './MentionField';

/**
 * People to mention for what's typed after "@", in a strip under a text field — each with their picture and name, as
 * in replies (MentionField) — for the composers, whose fields are plain textareas (desktop) or Framework7's ListInput
 * (phone). `input` returns the field; the caret is read from it. Picking someone writes their handle (short for
 * Fedizen's own people). Arrow keys, Enter / Tab and Escape work from a keyboard.
 */
export function MentionSuggestions({ value, onChange, input }: { value: string; onChange: (v: string) => void; input: () => HTMLTextAreaElement | null }) {
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const read = () => { const el = input(); setCaret(el && document.activeElement === el ? el.selectionStart : null); };
    read();
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [input, value]);
  const at = caret == null ? null : mentionQueryAt(value, caret);
  const open = !!at && at.query.length > 0 && dismissed !== at.start;
  const found = usePeopleSearch(open ? at!.query : null);
  const shown: Person[] = open ? mergeSuggestions(at!.query, [], found.data?.people ?? [], 5) : [];
  useEffect(() => setActive(0), [at?.query]);

  const pick = (p: Person) => {
    if (!at || caret == null) return;
    const next = insertMention(value, at.start, caret, p.handle);
    onChange(next.text);
    requestAnimationFrame(() => { const el = input(); if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret); } });
  };

  useEffect(() => {
    const el = input();
    if (!el || !shown.length) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') setActive(a => (a + 1) % shown.length);
      else if (e.key === 'ArrowUp') setActive(a => (a - 1 + shown.length) % shown.length);
      else if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') pick(shown[active]);
      else if (e.key === 'Escape') setDismissed(at!.start);
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    el.addEventListener('keydown', key);
    return () => el.removeEventListener('keydown', key);
  });

  if (!open) return null;
  return <div className="atlas-mention-bar" role="listbox" aria-label="People to mention">
    {shown.map((p, i) => <button key={p.handle} type="button" role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
      onMouseDown={e => e.preventDefault()} onClick={() => pick(p)} title={p.handle}>
      <Face p={p} /><span>{p.name}</span>
    </button>)}
    {!shown.length && found.isFetching && <span className="atlas-mention-hint">Looking…</span>}
  </div>;
}
