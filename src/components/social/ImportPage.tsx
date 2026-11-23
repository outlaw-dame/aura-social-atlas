import { useRef, useState } from 'react';
import { ArrowUpRight, FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FEDIZEN_IMPORT_URL, KIND_LABEL, NOT_HERE, importSize, readImport, type ImportFile } from '@/lib/account-import';
import { useAccountImport, type ImportProgress } from './useAccountImport';
import { useAtlasAuth } from './AuthState';

export type PickedFile = { id: number; name: string; text: string; read: ImportFile; choice?: 'following' | 'blocks' | 'mutes'; result?: ImportProgress };
let nextId = 0;
const MAX_BYTES = 20 * 1024 * 1024;

/** Reads the chosen files (Mastodon's and Bonfire's exports) for the import list. Shared with the phone page. */
export async function pickFiles(files: FileList | null): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const f of Array.from(files ?? []).slice(0, 12)) {
    if (f.size > MAX_BYTES) { out.push({ id: ++nextId, name: f.name, text: '', read: { kind: 'unknown' } }); continue; }
    const text = await f.text();
    out.push({ id: ++nextId, name: f.name, text, read: readImport(f.name, text) });
  }
  return out;
}

/** The start button: what it does and to how many ("Follow 312", "Add 40 to circles", "Add filters"). */
export function startLabel(p: PickedFile) {
  const kind = p.choice ?? p.read.kind, n = importSize(p.read);
  return kind === 'lists' ? `Add ${n} to circles` : kind === 'filters' ? KIND_LABEL.filters.verb : `${KIND_LABEL[kind].verb} ${n}`;
}

/** A line saying what a file holds, e.g. "312 people to follow · 2 lines skipped". */
export function fileSummary(p: PickedFile) {
  const n = importSize(p.read);
  const skipped = 'skipped' in p.read && p.read.skipped ? ` · ${p.read.skipped} line${p.read.skipped === 1 ? '' : 's'} skipped (not a full handle)` : '';
  return p.read.kind === 'filters' ? 'Mastodon filter export' : n ? `${n} ${n === 1 ? 'entry' : 'entries'}${skipped}` : '';
}

/**
 * Settings → Import (desktop /settings/import): bring follows, blocks, mutes, lists and keyword filters from a Mastodon
 * or Bonfire account. Atlas redoes them on Fedizen as the person, one at a time; what Fedizen's API can't do (blocked
 * servers, bookmarks) points to Fedizen's own importer.
 */
export function ImportPage() {
  const { user } = useAtlasAuth();
  const imp = useAccountImport();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PickedFile[]>([]), [active, setActive] = useState<number | null>(null);
  const run = runImport(imp, setFiles, setActive);
  if (!user) return <p className="mt-6 text-sm text-muted-foreground">Sign in to Atlas and connect Fedizen to import.</p>;

  const p = imp.progress;
  return <div className="mt-6">
    <p className="text-sm text-muted-foreground">Bring your follows, blocks, mutes, lists and keyword filters from Mastodon or another Bonfire account. On Mastodon: Preferences → Import and export → Data export, then download the CSV files.</p>
    <input ref={input} type="file" multiple accept=".csv,.json,.txt,text/csv,application/json,text/plain" className="hidden"
      onChange={async e => { const picked = await pickFiles(e.target.files); e.target.value = ''; setFiles(f => [...f, ...picked]); }} />
    <Button variant="outline" className="mt-4 rounded-full" disabled={p.running} onClick={() => input.current?.click()}><FileUp />Choose files</Button>

    {files.length > 0 && <ul className="mt-6 divide-y divide-border border-y border-border">
      {files.map(f => {
        const kind = f.choice ?? f.read.kind, why = NOT_HERE[f.read.kind];
        const accounts = 'accounts' in f.read;
        return <li key={f.id} className="py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{KIND_LABEL[kind].title}</p>
              <p className="truncate text-xs text-muted-foreground">{f.name}{fileSummary(f) ? ` · ${fileSummary(f)}` : ''}</p>
            </div>
            {!p.running && <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove ${f.name}`} onClick={() => setFiles(fs => fs.filter(x => x.id !== f.id))}><X /></Button>}
          </div>
          {accounts && <div role="radiogroup" aria-label={`What to do with ${f.name}`} className="mt-3 flex gap-1">
            {(['following', 'blocks', 'mutes'] as const).map(k => <Button key={k} size="sm" variant="ghost" role="radio" aria-checked={kind === k} disabled={p.running}
              className={`rounded-full ${kind === k ? 'social-selected' : 'text-muted-foreground'}`}
              onClick={() => setFiles(fs => fs.map(x => x.id === f.id ? { ...x, choice: k, result: undefined } : x))}>{KIND_LABEL[k].verb}</Button>)}
          </div>}
          {why ? <p className="mt-2 text-sm text-muted-foreground">{why} {f.read.kind !== 'unknown' && <a className="inline-flex items-center gap-1 text-accent hover:underline" href={FEDIZEN_IMPORT_URL} target="_blank" rel="noopener noreferrer">Fedizen’s importer<ArrowUpRight className="size-3" /></a>}</p>
            : active === f.id && p.running ? <ImportStatus p={p} onStop={imp.stop} />
            : f.result ? <ImportStatus p={f.result} onStop={imp.stop} />
            : <Button className="mt-3 rounded-full" size="sm" disabled={p.running || !importSize(f.read) && f.read.kind !== 'filters'} onClick={() => void run(f)}>{startLabel(f)}</Button>}
        </li>;
      })}
    </ul>}
  </div>;
}

function ImportStatus({ p, onStop }: { p: ImportProgress; onStop: () => void }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return <div className="mt-3" aria-live="polite">
    <div className="flex items-center gap-3">
      <progress className="h-1.5 flex-1 accent-[var(--accent)]" value={p.done} max={p.total || 1} aria-label="Import progress" />
      <span className="text-xs tabular-nums text-muted-foreground">{p.done} of {p.total}</span>
      {p.running && <Button size="sm" variant="ghost" className="rounded-full" onClick={onStop}>Stop</Button>}
    </div>
    {p.finished && <p role="status" className="mt-2 text-sm">{p.done - p.failed.length} done{p.failed.length ? `, ${p.failed.length} not` : ''}{p.done < p.total ? ` · stopped at ${pct}%` : ''}.</p>}
    {p.failed.length > 0 && <details className="mt-2 text-sm text-muted-foreground"><summary className="cursor-pointer">What didn’t work</summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">{p.failed.map((x, i) => <li key={i}><span className="font-medium text-foreground">{x.what}</span> · {x.why}</li>)}</ul>
    </details>}
  </div>;
}

/** Starts a file's import and keeps its result on the file, so each file shows how its own import went. */
export function runImport(imp: ReturnType<typeof useAccountImport>, setFiles: (u: (fs: PickedFile[]) => PickedFile[]) => void, setActive: (id: number | null) => void) {
  return async (f: PickedFile) => {
    setActive(f.id); imp.reset();
    const end = await imp.run(f.choice && 'accounts' in f.read ? readImport(f.name, f.text, f.choice) : f.read);
    setActive(null);
    if (end) setFiles(fs => fs.map(x => x.id === f.id ? { ...x, result: end } : x));
  };
}
