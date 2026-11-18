/**
 * Live updates in the Lab. In the app they arrive from Fedizen's stream (/api/live → LiveUpdates.tsx) or a
 * conversation's 45-second re-read (useThread.ts). Here the Lab plays them: a new reply joins the sample ISS
 * conversation and the same live event the app's stream would send is dispatched, so the app reacts exactly as it
 * does to Fedizen (reads the conversation again, shows the reply in place, marked New).
 */
import type { FedizenPost } from '@/lib/fedizen-feed';
import { LIVE_NOTICE_EVENT, LIVE_POST_EVENT } from '@/components/social/LiveUpdates';
import { ISS, ISS_REPLIES, post } from './data/posts';
import type { PersonKey } from './data/people';

const SCRIPT: [PersonKey, string, string, string][] = [
  ['ana', 'r3', 'en', 'Report back please! Ours is clouded out.'],
  ['kenji', 'r2b', 'ja', '東京も曇りです。クラブに入れてください。'],
  ['kenji', 'r4a', 'ja', '広角レンズ、14〜24mmくらいがおすすめです。'],
  ['priya', 'root', 'en', 'It just went over Leicester. Brightest I’ve seen it all year.'],
];
const idOf = (k: string) => (k === 'root' ? ISS.id : `01LABISS${k.toUpperCase().padEnd(6, '0')}`);

export const labLive = {
  replies: [] as FedizenPost[],
  /** Posts deleted this page load (by the reader, or by their authors in the Lab's demo). */
  removed: new Set<string>(),
  /** A reply arrives in the sample conversation, as Fedizen's live stream would announce it. */
  addReply() {
    const [by, parent, lang, text] = SCRIPT[this.replies.length % SCRIPT.length];
    const p = post(text, { id: `01LABLIVE${String(this.replies.length).padStart(5, '0')}`, by, min: 0, language: lang, replyTo: { statusId: idOf(parent) } });
    this.replies.push(p);
    window.dispatchEvent(new CustomEvent(LIVE_POST_EVENT, { detail: { post: p, edited: false } }));
    return p;
  },
  /** A reply already there is edited. */
  editReply() {
    const p = ISS_REPLIES.find(x => x.paragraphs[0].startsWith('Same in Manchester'));
    if (!p) return;
    p.paragraphs = ['Same in Manchester, and now it’s raining too. We should start a club for clouded-out observers.'];
    p.editedAt = new Date().toISOString();
    window.dispatchEvent(new CustomEvent(LIVE_POST_EVENT, { detail: { post: p, edited: true } }));
  },
  /** A reply with replies of its own is deleted by its author: the next read leaves it out, and the app keeps a
   *  placeholder so its replies keep their place. */
  deleteReply() {
    const p = ISS_REPLIES.find(x => x.paragraphs[0].startsWith('Heavens-Above'));
    if (!p) return;
    this.removed.add(p.id);
    window.dispatchEvent(new Event(LIVE_NOTICE_EVENT));
  },
};
