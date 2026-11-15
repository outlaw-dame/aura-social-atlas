import { beforeEach, describe, expect, test } from "bun:test";
import { attributionNote, CREDIT_LABEL } from "../src/lib/article-author";
import { clearAuthorCache, episodeFor, resolveArticleAuthors, resolveAuthorsFor, type Lookup } from "../src/lib/article-author.server";
import { clock, durationSeconds, episodeFromObject } from "../src/lib/podcast-episode";
import { creditsBesidesAuthor } from "../src/lib/fedizen-feed";
import { _clearFediProfileCache, loadFediProfile } from "../src/lib/fedi-profile.server";

/* Shapes follow Castopod's own code (ad-aures/castopod, app/Libraries/PodcastEpisode.php, PodcastActor.php,
 * modules/Fediverse/Objects/ActorObject.php, app/Config/Routes.php, app/Helpers/seo_helper.php). */
const HOST = "https://pods.example.org";
const POD = `${HOST}/@openweb`;
const EP = `${HOST}/@openweb/episodes/who-owns-the-feed`;
const person = { "@context": ["https://www.w3.org/ns/activitystreams"], id: POD, type: "Person", preferredUsername: "openweb", name: "Open Web Radio", url: POD, outbox: `${POD}/outbox`, followers: `${POD}/followers`, icon: { type: "Image", url: `${HOST}/cover.jpg` } };
const podcast = { ...person, type: "Podcast", rssFeed: `${HOST}/@openweb/feed.xml`, category: "Technology › Tech News", language: "en" };
const episode = {
  id: EP, type: "PodcastEpisode", attributedTo: POD, cc: [`${POD}/followers`], published: "2026-11-10T09:00:00+00:00",
  description: { type: "Note", mediaType: "text/markdown", content: "…" },
  image: { type: "Image", mediaType: "image/jpeg", url: `${HOST}/media/ep-cover.jpg` },
  audio: { id: `${HOST}/audio/ep.mp3`, type: "Audio", name: "Who owns the feed?", size: 41234567, duration: 2581.4, url: { href: `${HOST}/audio/ep.mp3`, type: "Link", mediaType: "audio/mpeg" } },
};
const episodePage = `<html><head><title>Who owns the feed?</title><link rel="alternate" type="application/activity+json" href="${EP}"><script type="application/ld+json">{"@type":"PodcastEpisode"}</script></head><body></body></html>`;

/** Content negotiation by Accept, as Castopod's router does. */
function castopod(extra: Record<string, { accept?: string; type: string; body: unknown }[]> = {}) {
  const seen: string[] = [];
  const routes: Record<string, { accept?: string; type: string; body: unknown }[]> = {
    [EP]: [{ accept: "application/activity+json", type: "application/activity+json", body: episode }, { type: "text/html", body: episodePage }],
    [POD]: [{ accept: "application/podcast-activity+json", type: "application/activity+json", body: podcast }, { accept: "application/activity+json", type: "application/activity+json", body: person }],
    [`https://pods.example.org/.well-known/webfinger?resource=${encodeURIComponent("acct:openweb@pods.example.org")}`]: [{ type: "application/jrd+json", body: { links: [{ rel: "self", type: "application/activity+json", href: POD }] } }],
    ...extra,
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const accept = String((init?.headers as Record<string, string>)?.accept ?? "");
    seen.push(`${url} ${accept.split(",")[0]}`);
    const r = (routes[url] ?? []).find((x) => !x.accept || accept.startsWith(x.accept));
    if (!r) return new Response("nope", { status: 404 });
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { headers: { "content-type": r.type } });
  };
  return { fetchImpl, seen };
}
const dns: Lookup = async () => ["93.184.216.34"];
beforeEach(() => { clearAuthorCache(); _clearFediProfileCache(); });

describe("Castopod episodes and podcasts get creator tags", () => {
  test("an episode link credits its podcast (PodcastEpisode → attributedTo)", async () => {
    const { fetchImpl } = castopod();
    const [a] = await resolveArticleAuthors(EP, fetchImpl, dns);
    expect(a).toMatchObject({ name: "Open Web Radio", acct: "@openweb@pods.example.org", actor: POD, verifiedBy: "activitypub", work: "episode" });
    expect(CREDIT_LABEL[a.work!]).toBe("More from the podcast");
    expect(attributionNote(a)).toBe("From the episode’s own ActivityPub record");
  });

  test("when the page comes back as HTML (a shared link with tracking, a cache), its activity+json alternate leads to the episode", async () => {
    const shared = `${EP}?utm_source=mastodon`;
    const { fetchImpl } = castopod({ [shared]: [{ type: "text/html", body: episodePage }] });
    expect((await resolveArticleAuthors(shared, fetchImpl, dns))[0]).toMatchObject({ actor: POD, work: "episode" });
  });

  test("a podcast's own page credits the podcast, recognised by its podcast view", async () => {
    const { fetchImpl } = castopod();
    const [a] = await resolveArticleAuthors(POD, fetchImpl, dns);
    expect(a).toMatchObject({ acct: "@openweb@pods.example.org", work: "podcast" });
    expect(attributionNote(a)).toBe("The link is this account’s own page");
  });

  test("a profile link elsewhere is an account, not a podcast", async () => {
    const id = "https://social.example.org/users/ann";
    const ann = { id, type: "Person", preferredUsername: "ann", name: "Ann" };
    const { fetchImpl } = castopod({ [id]: [{ type: "application/activity+json", body: ann }] });
    expect((await resolveArticleAuthors(id, fetchImpl, dns))[0]).toMatchObject({ acct: "@ann@social.example.org", work: "account" });
  });

  test("an actor served for another host's page isn't credited", async () => {
    const page = "https://mirror.example.net/@openweb";
    const { fetchImpl } = castopod({ [page]: [{ type: "application/activity+json", body: person }] });
    expect(await resolveArticleAuthors(page, fetchImpl, dns)).toEqual([]);
  });

  test("a same-host actor id that redirects to someone else's account isn't credited", async () => {
    const page = `${HOST}/@decoy`;
    const alice = { id: "https://social.example.net/users/alice", type: "Person", preferredUsername: "alice", name: "Alice" };
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      if (url === page) return new Response(JSON.stringify({ ...person, id: `${HOST}/go/alice` }), { headers: { "content-type": "application/activity+json" } });
      if (url === `${HOST}/go/alice`) return new Response(null, { status: 302, headers: { location: alice.id } });
      if (url === alice.id) return new Response(JSON.stringify(alice), { headers: { "content-type": "application/activity+json" } });
      return new Response("nope", { status: 404 });
    };
    expect(await resolveArticleAuthors(page, fetchImpl, dns)).toEqual([]);
  });

  test("a podcast sharing its own episode isn't tagged with itself", () => {
    const credit = { name: "Open Web Radio", acct: "@openweb@pods.example.org", url: POD, verifiedBy: "activitypub" as const, work: "episode" as const };
    expect(creditsBesidesAuthor({ handle: "@OpenWeb@pods.example.org" }, [credit])).toEqual([]);
    expect(creditsBesidesAuthor({ handle: "@ann@social.example.org" }, [credit])).toEqual([credit]);
  });

  test("the podcast's profile in Atlas shows it as a podcast with its feed and category", async () => {
    const { fetchImpl } = castopod();
    const p = (await loadFediProfile({ actor: POD }, 2000, fetchImpl, dns))!;
    expect(p).toMatchObject({ kind: "podcast", acctVerified: true, podcast: { feed: `${HOST}/@openweb/feed.xml`, category: "Technology › Tech News" } });
  });
});

describe("Playable episodes", () => {
  test("resolving an episode link also yields a playable episode with its verified podcast", async () => {
    const { fetchImpl } = castopod();
    await resolveAuthorsFor([EP], 2000, fetchImpl, dns);
    expect(episodeFor(EP)).toEqual({
      url: EP, title: "Who owns the feed?", image: `${HOST}/media/ep-cover.jpg`,
      audio: { src: `${HOST}/audio/ep.mp3`, type: "audio/mpeg" }, duration: 2581, published: "2026-11-10T09:00:00+00:00",
      podcast: expect.objectContaining({ acct: "@openweb@pods.example.org", work: "episode" }),
    });
  });

  test("no episode when its podcast can't be verified", async () => {
    const elsewhere = "https://other.example.net/@openweb";
    const { fetchImpl } = castopod({ [EP]: [{ type: "application/activity+json", body: { ...episode, attributedTo: elsewhere } }], [elsewhere]: [{ type: "application/activity+json", body: { ...person, id: elsewhere } }] });
    await resolveAuthorsFor([EP], 2000, fetchImpl, dns);
    expect(episodeFor(EP)).toBeUndefined();
  });

  test("audio must be a public https audio file; titles are cleaned", () => {
    const pod = { name: "P", acct: "@p@pods.example.org", url: POD, verifiedBy: "activitypub" as const };
    expect(episodeFromObject({ ...episode, audio: { ...episode.audio, id: "http://x.org/a.mp3", url: { href: "http://x.org/a.mp3", mediaType: "audio/mpeg" } } }, pod)).toBeNull();
    expect(episodeFromObject({ ...episode, audio: { ...episode.audio, id: undefined, url: { href: `${HOST}/v.mp4`, mediaType: "video/mp4" } } }, pod)).toBeNull();
    expect(episodeFromObject({ ...episode, audio: { ...episode.audio, name: "Ep\u202E 1" } }, pod)?.title).toBe("Ep 1");
    expect(episodeFromObject({ ...episode, type: "Note" }, pod)).toBeNull();
  });

  test("durations from seconds or xsd:duration; clock formatting", () => {
    expect(durationSeconds(2581.4)).toBe(2581);
    expect(durationSeconds("PT1H2M3S")).toBe(3723);
    expect(durationSeconds("PT")).toBeUndefined();
    expect(durationSeconds(-4)).toBeUndefined();
    expect(clock(3723)).toBe("1:02:03");
    expect(clock(65)).toBe("1:05");
  });
});
