/** Real open-web writers and creators for "Voices to know"; shown a few at a time on rotation. */
export type Voice = { id: string; name: string; handle: string; network: string; topic: string; bio: string; url: string };

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
  if (list.length <= size) return list;
  const start = ((page * size) % list.length + list.length) % list.length;
  return Array.from({ length: size }, (_, i) => list[(start + i) % list.length]);
}
