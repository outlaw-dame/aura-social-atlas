import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { changeFedizenBlock, changeFedizenCircleMember, followFedizenAccount, getFedizenCircles, muteFedizenAccount, saveFedizenCircle } from '@/lib/fedizen.functions';
import type { ImportFile } from '@/lib/account-import';
import { parseImport } from './filter-options';
import { useFilterActions } from './useIntelligence';
import { useAtlasAuth } from './AuthState';

export type ImportProgress = { done: number; total: number; failed: { what: string; why: string }[]; running: boolean; finished: boolean };
const IDLE: ImportProgress = { done: 0, total: 0, failed: [], running: false, finished: false };

const WHY: Record<string, string> = {
  'not-found': 'Not found on Fedizen',
  'not-connected': 'Fedizen isn’t connected',
  'needs-permission': 'Atlas needs permission to act for you',
  expired: 'Fedizen ended Atlas’s access',
  unavailable: 'Fedizen couldn’t do it',
};
/** Problems that stop the whole run: nothing after them would work either. */
const FATAL = new Set(['not-connected', 'needs-permission', 'expired']);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Carries out an import on Fedizen as the person, one request at a time (Fedizen's rate limits are per account), so a
 * long list takes a while but never floods it. A failure Fedizen might get past is tried once more after a pause; a
 * handle Fedizen can't find is noted and skipped. Stop ends the run after the request in flight.
 */
export function useAccountImport() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const follow = useServerFn(followFedizenAccount), block = useServerFn(changeFedizenBlock), mute = useServerFn(muteFedizenAccount);
  const circles = useServerFn(getFedizenCircles), saveCircle = useServerFn(saveFedizenCircle), member = useServerFn(changeFedizenCircleMember);
  const filters = useFilterActions();
  const [progress, setProgress] = useState<ImportProgress>(IDLE);
  const stop = useRef(false);

  const run = async (file: ImportFile): Promise<ImportProgress | null> => {
    if (!user) return null;
    const me = { expectedAtlasUserId: user.id };
    stop.current = false;

    if (file.kind === 'filters') {
      const groups = parseImport(file.text);
      const total = groups.reduce((n, g) => n + g.texts.length, 0);
      setProgress({ ...IDLE, total, running: true });
      const failed: ImportProgress['failed'] = [];
      for (const g of groups) { const err = await filters.add(g.texts, g.options); if (err) failed.push({ what: `${g.texts.length} filters`, why: err }); }
      const end = { done: total, total, failed, running: false, finished: true };
      setProgress(end);
      return end;
    }

    type Step = { what: string; go: () => Promise<{ ok: boolean; error?: string }> };
    let steps: Step[] = [];
    if (file.kind === 'following') steps = file.accounts.map(a => ({ what: a, go: () => follow({ data: { ...me, acct: a, on: true } }) }));
    else if (file.kind === 'blocks') steps = file.accounts.map(a => ({ what: a, go: () => block({ data: { ...me, block: a } }) }));
    else if (file.kind === 'mutes') steps = file.accounts.map(a => ({ what: a, go: () => mute({ data: { ...me, acct: a, on: true } }) }));
    else if (file.kind === 'lists') {
      // Circles are matched by name (ignoring case); the missing ones are made first.
      const have = await circles({ data: me }).catch(() => null);
      if (!have || have.error) { const end = { ...IDLE, failed: [{ what: 'Your circles', why: WHY[have?.error ?? 'unavailable'] }], finished: true }; setProgress(end); return end; }
      const ids = new Map(have.circles.map(c => [c.title.toLowerCase(), c.id]));
      const idFor = async (name: string) => {
        const known = ids.get(name.toLowerCase());
        if (known) return known;
        const r = await saveCircle({ data: { ...me, title: name, summary: '' } });
        if (!r.ok) return null;
        ids.set(name.toLowerCase(), r.circle.id);
        return r.circle.id;
      };
      steps = file.members.map(m => ({ what: `${m.account} → ${m.list}`, go: async () => {
        const id = await idFor(m.list);
        return id ? member({ data: { ...me, id, add: m.account } }) : { ok: false, error: 'unavailable' };
      } }));
    } else return null;

    const failed: ImportProgress['failed'] = [];
    setProgress({ done: 0, total: steps.length, failed, running: true, finished: false });
    let doneOk = 0;
    for (let i = 0; i < steps.length; i++) {
      if (stop.current) break;
      let r = await steps[i].go().catch(() => ({ ok: false, error: 'unavailable' }));
      if (!r.ok && r.error === 'unavailable') { await sleep(15_000); r = await steps[i].go().catch(() => ({ ok: false, error: 'unavailable' })); }
      if (!r.ok) {
        failed.push({ what: steps[i].what, why: WHY[r.error ?? 'unavailable'] ?? WHY.unavailable });
        if (FATAL.has(r.error ?? '')) { const end = { done: i + 1, total: steps.length, failed: [...failed], running: false, finished: true }; setProgress(end); return end; }
      }
      else doneOk++;
      setProgress({ done: i + 1, total: steps.length, failed: [...failed], running: true, finished: false });
    }
    const end = { done: stop.current ? failed.length + doneOk : steps.length, total: steps.length, failed, running: false, finished: true };
    setProgress(end);
    void Promise.all(['fedizen-blocks', 'fedizen-mutes', 'fedizen-circles', 'fedizen-home', 'fedizen-foryou'].map(k => qc.invalidateQueries({ queryKey: [k] })));
    return end;
  };

  return { progress, run, stop: () => { stop.current = true; }, reset: () => setProgress(IDLE) };
}
