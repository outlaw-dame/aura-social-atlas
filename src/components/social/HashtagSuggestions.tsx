import { useEffect, useState } from 'react';
import { hashtagQueryAt, insertHashtag } from '@/lib/mentions';
import { useHashtagSuggestions } from './useOwnPosts';

/**
 * Hashtags Fedizen knows that start with what's typed after "#", in a strip under a text field, as Mastodon's composer
 * offers them (Fedizen's hashtag search: GET /api/v2/search?type=hashtags). Works with any textarea: `input` returns
 * it; the caret is read from the field itself, so it fits Framework7's ListInput as well as a plain textarea. Arrow
 * keys, Enter / Tab and Escape work from a keyboard; typing on simply keeps the tag as written.
 */
export function HashtagSuggestions({ value, onChange, input }: { value: string; onChange: (v: string) => void; input: () => HTMLTextAreaElement | null }) {
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  // Follow the caret while this field has focus.
  useEffect(() => {
    const read = () => { const el = input(); setCaret(el && document.activeElement === el ? el.selectionStart : null); };
    read();
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [input, value]);
  const at = caret == null ? null : hashtagQueryAt(value, caret);
  const open = !!at && dismissed !== at.start;
  const [q, setQ] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(open ? at!.query : null), 180); return () => clearTimeout(t); }, [open, at?.query]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useHashtagSuggestions(open && at!.query === '' ? '' : q);
  // Right after "#", your recent hashtags show at once; once you type, after a short pause.
  const shown = open && (at!.query === '' || q === at!.query) ? tags : [];
  useEffect(() => setActive(0), [at?.query]);

  const pick = (tag: string) => {
    if (!at || caret == null) return;
    const next = insertHashtag(value, at.start, caret, tag);
    onChange(next.text);
    requestAnimationFrame(() => { const el = input(); if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret); } });
  };

  // Keyboard, on the field itself, ahead of its own handlers (a reply's Enter, a mention's arrows).
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

  if (!shown.length) return null;
  return <div className="atlas-mention-bar atlas-tag-bar" role="listbox" aria-label="Hashtags">
    {shown.map((t, i) => <button key={t} type="button" role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
      onMouseDown={e => e.preventDefault()} onClick={() => pick(t)}>#{t}</button>)}
  </div>;
}
