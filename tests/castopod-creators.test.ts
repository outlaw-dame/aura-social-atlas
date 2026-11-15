import { beforeEach, describe, expect, test } from "bun:test";
import { attributionNote, CREDIT_LABEL } from "../src/lib/article-author";
import { clearAuthorCache, resolveArticleAuthors, type Lookup } from "../src/lib/article-author.server";
import { creditsBesidesAuthor } from "../src/lib/fedizen-feed";
import { _clearFediProfileCache, loadFediProfile } from "../src/lib/fedi-profile.server";

/* Shapes follow Castopod's own code (ad-aures/castopod, app/Libraries/PodcastEpisode.php, PodcastActor.php,
 * modules/Fediverse/Objects/ActorObject.php, app/Config/Routes.php, app/Helpers/seo_helper.php). */
const HOST = "https://pods.example.org";
const POD = `${HOST}/@openweb`;
const EP = `${HOST}/@openweb/episodes/who-owns-the-feed`;
const person = { "@context": ["https://www.w3.org/ns/activitystreams"], id: POD, type: "Person", preferredUsername: "openweb", name: "Open Web Radio", url: POD, outbox: `${POD}/outbox`, followers: `${POD}/followers`, icon: { type: "Image", url: `${HOST}/cover.jpg` } };
const podcast = { ...person, type: "Podcast", rssFeed: `${HOST}/@openweb/feed.xml`, category: "Technology › Tech News", language: "en" };
const episode = { id: EP, type: "PodcastEpisode", attributedTo: POD, cc: [`${POD}/followers`], description: { type: "Note", content: "…" }, audio: { type: "Audio", name: "Who owns the feed?" } };
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
