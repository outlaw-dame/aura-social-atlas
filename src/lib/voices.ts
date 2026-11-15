/** Real open-web voices for "Voices to know": writers, the fediverse's most-followed accounts (FediDB), podcasters
 *  (Castopod) and video channels (PeerTube); shown a few at a time on rotation. */
export type VoiceCategory = 'popular' | 'writer' | 'podcast' | 'video';
export type Voice = { id: string; name: string; handle: string; network: string; topic: string; bio: string; url: string;
  category?: VoiceCategory; avatar?: string; followers?: number };

export const VOICE_CATEGORIES: { id: VoiceCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'popular', label: 'Popular' }, { id: 'writer', label: 'Writers' },
  { id: 'podcast', label: 'Podcasters' }, { id: 'video', label: 'Video' },
];
export const categoryOf = (v: Voice): VoiceCategory => v.category ?? 'writer';

/**
 * PeerTube channels people recommend (Josh Griffiths, "PeerTube channels you should watch"), with handles from their
 * channel URLs; FediDB's popular PeerTube accounts join them when it lists any.
 */
export const videoVoices: Voice[] = [
  { id: 'pt-linuxexperiment', name: 'The Linux Experiment', handle: '@thelinuxexperiment_channel@tilvids.com', network: 'PeerTube', topic: 'Technology', bio: 'Daily #Linux news, distros, hardware and gaming.', url: 'https://tilvids.com/c/thelinuxexperiment_channel', category: 'video' },
  { id: 'pt-veronica', name: 'Veronica Explains', handle: '@veronicaexplains@tinkerbetter.tube', network: 'PeerTube', topic: 'Technology', bio: 'Approachable #tech videos, mostly Linux, plus internet critiques.', url: 'https://tinkerbetter.tube/c/veronicaexplains', category: 'video' },
  { id: 'pt-sqhistorian', name: 'Space Quest Historian', handle: '@spacequesthistorian@spectra.video', network: 'PeerTube', topic: 'Culture', bio: 'History and reviews of classic and modern adventure #games.', url: 'https://spectra.video/c/spacequesthistorian', category: 'video' },
  { id: 'pt-ctrlaltrees', name: 'ctrl-alt-rees', handle: '@ctrlaltrees@makertube.net', network: 'PeerTube', topic: 'Technology', bio: 'Retro tech and #retrogaming.', url: 'https://makertube.net/c/ctrlaltrees', category: 'video' },
  { id: 'pt-vwestlife', name: 'VWestlife', handle: '@vwestlife@makertube.net', network: 'PeerTube', topic: 'Technology', bio: 'Old electronics: history, teardowns and repairs.', url: 'https://makertube.net/c/vwestlife', category: 'video' },
  { id: 'pt-transit', name: 'Transit', handle: '@transit@video.canadiancivil.com', network: 'PeerTube', topic: 'Culture', bio: '#Urbanism and public transit, with guest creators.', url: 'https://video.canadiancivil.com/c/transit', category: 'video' },
  { id: 'pt-middy', name: 'Middy’s Essays', handle: '@middys_essays@spectra.video', network: 'PeerTube', topic: 'Culture', bio: 'Video essays on #games.', url: 'https://spectra.video/c/middys_essays', category: 'video' },
  { id: 'pt-puppet', name: 'Operation: Puppet', handle: '@operationpuppet@puppet.zone', network: 'PeerTube', topic: 'Culture', bio: 'Puppet-building livestreams, tutorials and a comedy show.', url: 'https://puppet.zone/c/operationpuppet', category: 'video' },
];

/** Podcasts on Castopod that are part of the fediverse themselves; the Castopod Index adds its most popular. */
export const podcastVoices: Voice[] = [
  { id: 'cp-fedipodcast', name: 'FediPodcast', handle: '@FediPodcast@fedipodcast.castopod.org', network: 'Castopod', topic: 'Technology', bio: 'A podcast about the #fediverse, made with Castopod.', url: 'https://fedipodcast.castopod.org/@FediPodcast', category: 'podcast' },
  { id: 'cp-castopod', name: 'Castopod on Castopod', handle: '@castopod@on.castopod.org', network: 'Castopod', topic: 'Technology', bio: 'News and conversations from the people making Castopod. #podcasting', url: 'https://on.castopod.org/@castopod', category: 'podcast' },
];

export const VOICES_PER_PAGE = 6;

export const voices: Voice[] = [
  { id: 'bschillace', name: 'Dr. Brandy Schillace', handle: '@bschillace@mastodon.social', network: 'Mastodon', topic: 'Science', bio: 'Historian, science writer, novelist and editor of Medical Humanities. Writes on #medicine, #history and fiction.', url: 'https://mastodon.social/@bschillace' },
  { id: 'mattbirchler', name: 'Matt Birchler', handle: '@mattbirchler@micro.blog', network: 'Micro.blog', topic: 'Technology', bio: 'Independent #tech writer behind Birchtree, plus podcasts and videos.', url: 'https://micro.blog/mattbirchler' },
  { id: 'axbom', name: 'Per Axbom', handle: '@axbom@micro.blog', network: 'Micro.blog', topic: 'Design', bio: 'Designer, writer and educator on #digitalethics and responsible innovation.', url: 'https://micro.blog/axbom' },
  { id: 'manton', name: 'Manton Reece', handle: '@manton@micro.blog', network: 'Micro.blog', topic: 'Technology', bio: 'Founder of Micro.blog and author of Indie Microblogging. #indieweb', url: 'https://micro.blog/manton' },
  { id: 'stephenxwebb', name: 'Stephen Webb', handle: '@stephenxwebb@mastodon.social', network: 'Mastodon', topic: 'Science', bio: 'Physics, #astronomy and nonfiction books.', url: 'https://mastodon.social/@stephenxwebb' },
  { id: 'colehaddon', name: 'Cole Haddon', handle: '@colehaddon@mastodon.social', network: 'Mastodon', topic: 'Culture', bio: 'Novels, screenwriting and graphic novels.', url: 'https://mastodon.social/@colehaddon' },
  { id: 'natania', name: 'Natania Barron', handle: '@natania@mastodon.world', network: 'Mastodon', topic: 'Culture', bio: 'Historical #fantasy novelist and fashion history enthusiast.', url: 'https://mastodon.world/@natania' },
  { id: 'shanahan', name: 'Mike Shanahan', handle: '@shanahan@mastodon.world', network: 'Mastodon', topic: 'Science', bio: 'Nature, #biodiversity and environmental journalism.', url: 'https://mastodon.world/@shanahan' },
  { id: 'microsff', name: 'O. Westin', handle: '@MicroSFF@mastodon.art', network: 'Mastodon', topic: 'Culture', bio: 'Tiny science fiction and fantasy stories. #microfiction', url: 'https://mastodon.art/@MicroSFF' },
  { id: 'soniasulaiman', name: 'Sonia Sulaiman', handle: '@SoniaSulaiman@wandering.shop', network: 'Mastodon', topic: 'Culture', bio: 'Speculative fiction, #folklore and short stories.', url: 'https://wandering.shop/@SoniaSulaiman' },
  { id: 'clive', name: 'Clive Thompson', handle: '@clive@saturation.social', network: 'Mastodon', topic: 'Technology', bio: 'Technology and internet culture writer.', url: 'https://saturation.social/@clive' },
  { id: 'jensorensen', name: 'Jen Sorensen', handle: '@jensorensen@mastodon.social', network: 'Mastodon', topic: 'Culture', bio: 'Editorial cartoons, #comics and commentary.', url: 'https://mastodon.social/@jensorensen' },
  { id: 'writingslowly', name: 'Richard — Writing Slowly', handle: '@writingslowly@micro.blog', network: 'Micro.blog', topic: 'Culture', bio: 'Sydney blogger on the craft of #writing, reading and everyday life.', url: 'https://micro.blog/writingslowly' },
  { id: 'jean', name: 'Jean MacDonald', handle: '@jean@micro.blog', network: 'Micro.blog', topic: 'Travel', bio: 'Writer, photographer and podcaster sharing life on the Oregon coast.', url: 'https://micro.blog/jean' },
  { id: 'cordelia', name: 'Cordelia Naumann', handle: 'write.as/cordelianaumann', network: 'Write.as', topic: 'Culture', bio: 'Nightjar — #poetry and essays.', url: 'https://write.as/cordelianaumann/' },
  { id: 'paoloamoroso', name: 'Paolo Amoroso', handle: 'journal.paoloamoroso.com', network: 'Write.as', topic: 'Technology', bio: 'Technology, programming and personal reflections.', url: 'https://journal.paoloamoroso.com/' },
  { id: 'mattbaer', name: 'Matt Baer', handle: 'write.as/matt', network: 'Write.as', topic: 'Technology', bio: 'Builder of Write.as on independent publishing and the #openweb.', url: 'https://write.as/matt/' },
  { id: 'sturgis', name: 'Lee Sturgis', handle: 'sturgis.nz', network: 'Write.as', topic: 'Culture', bio: 'Speculative and #scifi fiction.', url: 'https://sturgis.nz/' },
];

/** The page of voices to show; wraps around so every page is full. */
export function voicesPage(page: number, list: Voice[] = voices, size = VOICES_PER_PAGE): Voice[] {
  if (!list.length) return [];
  if (list.length <= size) return list;
  const start = ((page * size) % list.length + list.length) % list.length;
  return Array.from({ length: size }, (_, i) => list[(start + i) % list.length]);
}
