import { useEffect, useRef, useState } from 'react';
import { Block, Button, Icon, List, ListInput, ListItem, Popup, Page, Navbar, NavLeft, NavRight, Link, Sheet, Toggle, f7 } from 'framework7-react';
import { GifPicker } from '@/components/social/GifPicker';
import { MAX_ALT, MAX_CW, PICKER_ACCEPT, altReminderText } from '@/lib/compose-media';
import { missingAlt, useReading } from '@/lib/reading-prefs';
import { usePublish, type Audience } from '@/components/social/usePublish';
import { QuotedPost } from '@/components/social/QuotedPost';
import { useComposeIntent } from '@/lib/compose-intent';

const AUDIENCE_ICON: Record<Audience, { ios: string; md: string }> = {
  public: { ios: 'f7:globe', md: 'material:public' }, unlisted: { ios: 'f7:moon', md: 'material:nights_stay' },
  private: { ios: 'f7:lock', md: 'material:lock' }, direct: { ios: 'f7:at', md: 'material:alternate_email' },
};

/**
 * Phone: a new post for Fedizen, full screen as iOS composers are — Cancel and Post in the bar, the text, an optional
 * content warning, up to 4 photos or one video with alt text, whether the media is sensitive, and who can see it.
 * Without a Fedizen connection that can post, it stays a private draft. See usePublish.
 */
export function ComposeSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const p = usePublish();
  // Boost → Quote on any post: the app opens this sheet; attach the post.
  const intent = useComposeIntent();
  const lastIntent = useRef(0);
  useEffect(() => {
    if (!intent || intent.n === lastIntent.current) return;
    lastIntent.current = intent.n;
    p.setQuote(intent.quote);
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [gifOpen, setGifOpen] = useState(false);
  const mediaFull = p.media.some(m => m.kind === 'video') || p.media.length >= 4;
  // Who may quote (lib/quote-policy), as an action sheet: the current choice in bold, as iOS marks it.
  const quoteShown = p.quoteLock === 'private' ? 'nobody' : p.quotePolicy;
  const chooseQuotes = () => f7.actions.create({ buttons: [
    [{ text: 'Who can quote this post', label: true }, ...p.quotePolicies.map(q => ({ text: q.label, bold: q.id === p.quotePolicy, onClick: () => p.setQuotePolicy(q.id) }))],
    [{ text: 'Cancel', color: 'red' }],
  ] }).open();
  const over = p.length > p.limits.maxChars;
  const prefs = useReading();
  const altFields = useRef(new Map<string, HTMLInputElement>());
  const post = async () => {
    const r = await p.send();
    if (r) { f7.toast.create({ text: 'Posted', closeTimeout: 1500 }).open(); onClose(); }
  };
  // Alt text reminder (Settings → Posting), as Ivory asks: Add alt text goes back to the first undescribed one.
  const send = async () => {
    const lacking = missingAlt(prefs, p.media);
    if (!lacking.length) return post();
    const w = altReminderText(lacking.length, p.media.length);
    f7.dialog.create({
      title: w.title, text: w.body, verticalButtons: false,
      buttons: [
        { text: w.add, strong: true, onClick: () => { const el = altFields.current.get(lacking[0].key); el?.scrollIntoView({ block: 'center' }); el?.focus(); } },
        { text: w.post, onClick: () => void post() },
      ],
    }).open();
  };
  // A quote is for this time only: closing without posting drops it (the text stays as a draft).
  const closed = () => { if (p.quote && !p.sending) p.setQuote(null); onClose(); };
  return <Popup opened={opened} onPopupClosed={closed} swipeToClose="to-bottom" className="atlas-compose" push>
    <Page>
      <Navbar title={p.quote ? 'Quote post' : p.canPost ? 'New post' : 'Draft'}>
        <NavLeft><Link onClick={onClose}>Cancel</Link></NavLeft>
        <NavRight>{p.canPost
          ? <Button fill small round disabled={!p.ready || over} onClick={() => void send()} className="atlas-compose-post">{p.sending ? 'Posting…' : 'Post'}</Button>
          : <Link onClick={onClose}>Done</Link>}</NavRight>
      </Navbar>
      {!p.canPost ? <>
        <List strong inset><ListInput type="textarea" placeholder="What’s on your mind?" value={draft} onInput={(e: { target: HTMLTextAreaElement }) => setDraft(e.target.value)} resizable /></List>
        <Block><p style={{ margin: 0, fontSize: 13, opacity: 0.6 }}>{p.connected ? 'Reconnect Fedizen so Atlas can post for you.' : 'Connect Fedizen to post. Until then this is a private draft.'}</p></Block>
      </> : <>
        {p.cwOn && <List strong inset className="atlas-compose-cw">
          <ListInput type="text" label="Content warning" placeholder="What it’s about" value={p.cw} maxlength={MAX_CW} onInput={(e: { target: HTMLInputElement }) => p.setCw(e.target.value)} clearButton />
        </List>}
        <List strong inset>
          <ListInput type="textarea" placeholder={p.quote ? 'Add your thoughts' : 'What’s on your mind?'} value={p.text} onInput={(e: { target: HTMLTextAreaElement }) => p.setText(e.target.value)} resizable inputStyle={{ minHeight: 120 }} />
        </List>
        {p.quote && <div className="atlas-compose-quote"><QuotedPost post={p.quote} onRemove={p.sending ? undefined : () => p.setQuote(null)} /></div>}
        {p.media.length > 0 && <div className={`atlas-compose-media ${p.media.length > 1 ? 'is-grid' : ''}`}>
          {p.media.map(m => <figure key={m.key}>
            <div className="atlas-compose-thumb">
              {m.kind === 'video' ? <video src={m.url} muted playsInline preload="metadata" /> : <img src={m.url} alt={m.alt} />}
              {(m.state === 'preparing' || m.state === 'uploading') && <span className="atlas-compose-busy">{m.state === 'preparing' ? 'Preparing…' : 'Uploading…'}</span>}
              <button type="button" aria-label={`Remove ${m.kind}`} disabled={p.sending} onClick={() => p.remove(m.key)}><Icon ios="f7:xmark" md="material:close" /></button>
            </div>
            {m.state === 'failed' ? <figcaption role="alert" className="atlas-compose-error">{m.error}</figcaption>
              : <figcaption>
                <span className="atlas-compose-alt">
                  <textarea ref={el => { if (el) altFields.current.set(m.key, el as unknown as HTMLInputElement); else altFields.current.delete(m.key); }} aria-label={`Alt text for this ${m.kind}`} value={m.alt} maxLength={MAX_ALT} disabled={p.sending || m.describing} rows={m.alt.length > 40 ? 3 : 1}
                    placeholder={m.describing ? 'Writing alt text…' : m.kind === 'video' ? 'Describe the video' : 'Describe the photo'} onChange={e => p.setAlt(m.key, e.target.value)} />
                  {m.kind === 'image' && !m.gif && p.canGenerateAlt && <button type="button" aria-label="Write alt text with AI" disabled={p.sending || m.describing || m.state === 'preparing'} onClick={() => void p.generateAlt(m.key)}>
                    {m.describing ? <span className="preloader preloader-small" /> : <Icon ios="f7:sparkles" md="material:auto_awesome" />}
                  </button>}
                </span>
                {m.error && <span role="alert" className="atlas-compose-error">{m.error}</span>}
              </figcaption>}
          </figure>)}
        </div>}
        <List strong inset dividers>
          <ListItem link="#" title={p.media.some(m => m.kind === 'video') || p.media.length >= 4 ? 'Media added' : 'Add photos or a video'} onClick={() => pick.current?.click()} disabled={p.sending}>
            <Icon slot="media" ios="f7:photo_on_rectangle" md="material:add_photo_alternate" />
          </ListItem>
          {p.gifs && <ListItem link="#" title="Add a GIF" onClick={() => setGifOpen(true)} disabled={p.sending || mediaFull}>
            <span slot="media" className="atlas-gif-glyph" aria-hidden>GIF</span>
          </ListItem>}
          <ListItem title="Content warning">
            <Icon slot="media" ios="f7:exclamationmark_triangle" md="material:warning" />
            <Toggle slot="after" checked={p.cwOn} onToggleChange={() => p.setCwOn(!p.cwOn)} />
          </ListItem>
          {p.media.length > 0 && <ListItem title="Sensitive media" footer={p.sensitiveLocked ? 'On while the post has a content warning' : undefined}>
            <Icon slot="media" ios="f7:eye_slash" md="material:visibility_off" />
            <Toggle slot="after" checked={p.sensitive} disabled={p.sensitiveLocked} onToggleChange={() => p.setSensitive(!p.sensitive)} />
          </ListItem>}
        </List>
        <List strong inset dividers>
          {p.audiences.map(a => <ListItem key={a.id} radio radioIcon="end" name="atlas-audience" title={a.label} footer={a.note} checked={p.audience === a.id} onChange={() => p.setAudience(a.id)}>
            <Icon slot="media" ios={AUDIENCE_ICON[a.id].ios} md={AUDIENCE_ICON[a.id].md} />
          </ListItem>)}
        </List>
        <List strong inset>
          <ListItem link={p.quoteLock ? undefined : '#'} title="Quotes" after={p.quoteLock === 'sensitive' ? 'Fedizen’s default' : p.quotePolicies.find(q => q.id === quoteShown)?.short}
            footer={p.quoteLock === 'private' ? 'Followers-only and mentions-only posts can’t be quoted' : p.quoteLock === 'sensitive' ? 'Can’t be set while media is marked sensitive without a content warning' : undefined}
            onClick={p.quoteLock || p.sending ? undefined : chooseQuotes}>
            <Icon slot="media" ios="f7:quote_bubble" md="material:format_quote" />
          </ListItem>
        </List>
        <Block className="atlas-compose-foot">
          {p.notice && <p role="alert" className="atlas-compose-error">{p.notice}</p>}
          <span className={over ? 'atlas-compose-error' : ''}>{p.limits.maxChars - p.length} characters left</span>
        </Block>
        <input ref={pick} type="file" accept={PICKER_ACCEPT} multiple hidden onChange={e => { if (e.target.files) p.add(e.target.files); e.target.value = ''; }} />
      </>}
    </Page>
    <Sheet opened={gifOpen} onSheetClosed={() => setGifOpen(false)} swipeToClose backdrop push className="atlas-gif-sheet" style={{ height: '72vh' }}>
      {gifOpen && <GifPicker autoFocus={false} onPick={g => { if (p.addGif(g)) setGifOpen(false); else f7.toast.create({ text: 'This post has all the media it can take', closeTimeout: 2000 }).open(); }} />}
    </Sheet>
  </Popup>;
}
