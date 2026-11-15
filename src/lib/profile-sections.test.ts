import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { activityLabel, profileSections, sectionFromTab } from '../components/social/profile-sections';

describe('Profile tabs', () => {
  test('Activity replaces Posts and Replies; Featured follows it', () => {
    strictEqual(profileSections.join(','), 'Activity,Featured,Media,Collections,Saved,Circles');
  });
  test('old links still open the right tab', () => {
    strictEqual(sectionFromTab('posts', profileSections), 'Activity');
    strictEqual(sectionFromTab('Replies', profileSections), 'Activity');
    strictEqual(sectionFromTab('feeds', profileSections), 'Circles');
    strictEqual(sectionFromTab('lists', profileSections), 'Circles');
    strictEqual(sectionFromTab('featured', profileSections), 'Featured');
    strictEqual(sectionFromTab('nope', profileSections), undefined);
    strictEqual(sectionFromTab(undefined, profileSections), undefined);
  });
  test('Activity says what it is showing', () => {
    strictEqual(activityLabel({ replies: false, boosts: false }), 'posts and quote posts');
    strictEqual(activityLabel({ replies: true, boosts: true }), 'posts, quote posts, replies and boosts');
  });
});
