import { useQuery } from '@tanstack/react-query';
import { Block, BlockFooter, BlockTitle, Icon, Link, List, ListItem } from 'framework7-react';
import { getSpotlight } from '@/lib/spotlight.functions';
import type { SpotlightItem } from '@/lib/spotlight';
import type { PostArticle } from '@/lib/fedizen-feed';
import { NetworkBadge } from '@/lib/networks';
import { VOICE_CATEGORIES } from '@/lib/voices';
import { VOICE_BLURB, compactCount, useVoicesToKnow } from '@/components/social/VoicesToKnow';
import { ArticleCard } from './ArticleAuthors';

/** A Spotlight story as a post's link preview, so the phone draws it with the same card (and its verified creators). */
const asArticle = (it: SpotlightItem): PostArticle => ({
  url: it.url, title: it.title, provider: it.provider, description: it.description, image: it.image,
  byline: it.author, authorUrl: it.authorUrl, authors: it.authorAccounts?.length ? it.authorAccounts : it.authorAccount ? [it.authorAccount] : [],
});

function Source({ it }: { it: SpotlightItem }) {
  return <span className="atlas-spot-meta">{it.source === 'Mastodon' ? <NetworkBadge network="Mastodon" /> : <b>Bonfire</b>} · {it.provider}</span>;
}

/**
 * Phone: Spotlight, as on desktop's Discover — what people across the open web are sharing (Mastodon's trending links
 * and Fedizen's articles), featured stories with pictures to swipe through, then the rest as rows. Stories open on
 * their site; verified creators open in Atlas.
 */
export function MobileSpotlight() {
  const { data, isLoading } = useQuery({ queryKey: ['spotlight'], queryFn: () => getSpotlight(), staleTime: 10 * 60_000 });
  const items = data?.items ?? [];
  const featured = items.filter(it => it.image).slice(0, 5);
  const ids = new Set(featured.map(f => f.id));
  const rest = items.filter(it => !ids.has(it.id)).slice(0, 8);
  return <>
    <BlockTitle><span className="atlas-blocktitle-icon"><Icon ios="f7:flame" md="material:local_fire_department" /> Spotlight</span></BlockTitle>
    {isLoading ? <Block strong inset>Gathering what people are sharing…</Block>
      : !items.length ? <Block strong inset>Nothing trending right now.</Block>
      : <>
        {featured.length > 0 && <div className="atlas-spot-rail" role="region" aria-roledescription="carousel" aria-label="Featured stories">
          {featured.map((it, i) => <div key={it.id} className="atlas-spot-slide" aria-roledescription="slide" aria-label={`${i + 1} of ${featured.length}`}>
            <Source it={it} />
            <ArticleCard article={asArticle(it)} />
          </div>)}
        </div>}
        {rest.length > 0 && <List strong inset dividers mediaList className="atlas-spot-list">
          {rest.map(it => <ListItem key={it.id} link={it.url} external target="_blank" title={it.title} text={it.description}>
            <span slot="subtitle"><Source it={it} /></span>
            {it.image && <img slot="media" className="atlas-spot-thumb" src={it.image} alt="" width={64} height={64} loading="lazy" referrerPolicy="no-referrer" />}
          </ListItem>)}
        </List>}
        {data && data.bonfireCount === 0 && <BlockFooter>No public Fedizen articles are trending yet — new Bonfire articles will appear here as they’re shared.</BlockFooter>}
      </>}
  </>;
}

/**
 * Phone: Voices to know, as on desktop's Discover — real open-web voices (most-followed accounts from FediDB, writers,
 * Castopod podcasts, PeerTube channels), six at a time, rotating; each opens its profile in Atlas.
 */
export function MobileVoicesToKnow() {
  const v = useVoicesToKnow();
  return <>
    <BlockTitle><span className="atlas-blocktitle-icon"><Icon ios="f7:sparkles" md="material:auto_awesome" /> Voices to know</span></BlockTitle>
    <div className="atlas-notice-tabs" role="tablist" aria-label="Kinds of voices">
      {VOICE_CATEGORIES.map(c => <button key={c.id} type="button" role="tab" aria-selected={v.kind === c.id} className={v.kind === c.id ? 'is-on' : undefined} onClick={() => v.setKind(c.id)}>{c.label}</button>)}
    </div>
    <BlockFooter className="atlas-voices-blurb"><span>{VOICE_BLURB[v.kind]}</span>
      <Link onClick={v.next} aria-label="Show more voices"><Icon ios="f7:arrow_2_circlepath" md="material:refresh" /> {(v.page % v.pages) + 1}/{v.pages}</Link>
    </BlockFooter>
    <List strong inset dividers mediaList>
      {v.voices.map(x => <ListItem key={x.id} link="#" onClick={() => v.open(x)} title={x.name} subtitle={x.handle}
>
        {x.avatar ? <img slot="media" className="atlas-avatar" src={x.avatar} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" style={{ objectFit: 'cover' }} />
          : <span slot="media" className="atlas-activity-initial" aria-hidden="true">{x.name.charAt(0)}</span>}
        <div slot="text">
          <span className="atlas-voice-meta"><NetworkBadge network={x.network} /> · {compactCount(x.followers) ? `${compactCount(x.followers)} followers` : x.topic}{!x.inAtlas && ' · opens their site'}</span>
          {x.bio && <span className="atlas-voice-bio">{x.bio}</span>}
        </div>
      </ListItem>)}
    </List>
    {v.fedidbDown && <BlockFooter>FediDB couldn’t be reached; try again later.</BlockFooter>}
  </>;
}
