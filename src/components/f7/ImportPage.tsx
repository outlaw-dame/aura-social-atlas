import { useRef, useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Icon, Link, List, ListItem, Navbar, Page, Progressbar, Segmented } from 'framework7-react';
import { FEDIZEN_IMPORT_URL, KIND_LABEL, NOT_HERE, importSize } from '@/lib/account-import';
import { fileSummary, pickFiles, runImport, startLabel, type PickedFile } from '@/components/social/ImportPage';
import { useAccountImport, type ImportProgress } from '@/components/social/useAccountImport';
import { useAtlasAuth } from '@/components/social/AuthState';

/** Phone: Settings → Import, a pushed page with the same files, choices and progress as desktop's /settings/import. */
export function MobileImportPage() {
  const { user } = useAtlasAuth();
  const imp = useAccountImport();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PickedFile[]>([]), [active, setActive] = useState<number | null>(null);
  const p = imp.progress;
  const run = runImport(imp, setFiles, setActive);
  return <Page>
    <Navbar title="Import" backLink backLinkShowText={false} />
    {!user ? <Block strong inset>Sign in to Atlas and connect Fedizen to import.</Block> : <>
      <input ref={input} type="file" multiple accept=".csv,.json,.txt,text/csv,application/json,text/plain" hidden
        onChange={async e => { const picked = await pickFiles(e.target.files); e.target.value = ''; setFiles(f => [...f, ...picked]); }} />
      <List strong inset>
        <ListItem link="#" title="Choose files" onClick={() => { if (!p.running) input.current?.click(); }}>
          <Icon slot="media" ios="f7:doc_on_doc" md="material:upload_file" />
        </ListItem>
      </List>
      <BlockFooter>Follows, blocks, mutes, lists and keyword filters from Mastodon or another Bonfire account. On Mastodon: Preferences → Import and export → Data export.</BlockFooter>

      {files.map(f => {
        const kind = f.choice ?? f.read.kind, why = NOT_HERE[f.read.kind];
        return <div key={f.id}>
          <BlockTitle>{KIND_LABEL[kind].title}</BlockTitle>
          <Block strong inset>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.7, overflowWrap: 'anywhere' }}>{f.name}{fileSummary(f) ? ` · ${fileSummary(f)}` : ''}</p>
            {'accounts' in f.read && <Segmented strong round style={{ marginTop: 12 }}>
              {(['following', 'blocks', 'mutes'] as const).map(k => <Button key={k} small active={kind === k} disabled={p.running}
                onClick={() => setFiles(fs => fs.map(x => x.id === f.id ? { ...x, choice: k, result: undefined } : x))}>{KIND_LABEL[k].verb}</Button>)}
            </Segmented>}
            {why ? <p style={{ marginBottom: 0 }}>{why} {f.read.kind !== 'unknown' && <Link external target="_blank" href={FEDIZEN_IMPORT_URL}>Fedizen’s importer</Link>}</p>
              : (active === f.id && p.running) || f.result ? <MobileStatus p={active === f.id && p.running ? p : f.result!} onStop={imp.stop} />
              : <Button fill round style={{ marginTop: 12 }} disabled={p.running || (!importSize(f.read) && f.read.kind !== 'filters')} onClick={() => void run(f)}>{startLabel(f)}</Button>}
            {!p.running && <Link style={{ marginTop: 8 }} onClick={() => setFiles(fs => fs.filter(x => x.id !== f.id))}>Remove</Link>}
          </Block>
        </div>;
      })}
    </>}
  </Page>;
}

function MobileStatus({ p, onStop }: { p: ImportProgress; onStop: () => void }) {
  return <div style={{ marginTop: 12 }} aria-live="polite">
    <Progressbar progress={p.total ? (p.done / p.total) * 100 : 0} />
    <p style={{ marginBottom: 0 }}>{p.done} of {p.total}{p.finished ? ` · ${p.done - p.failed.length} done${p.failed.length ? `, ${p.failed.length} not` : ''}` : ''}</p>
    {p.running && <Button small tonal round style={{ marginTop: 8 }} onClick={onStop}>Stop</Button>}
    {p.failed.length > 0 && <details style={{ marginTop: 8 }}><summary>What didn’t work</summary>
      <ul style={{ maxHeight: 200, overflowY: 'auto', paddingLeft: 18 }}>{p.failed.map((x, j) => <li key={j}><b>{x.what}</b> · {x.why}</li>)}</ul>
    </details>}
  </div>;
}
