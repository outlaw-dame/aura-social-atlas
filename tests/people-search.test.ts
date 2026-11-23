import { describe, expect, test } from 'bun:test';
import { searchPeople } from '../src/lib/people-search';

// Invented accounts.
const people = [
  { id: '1', name: 'Zoë Martín', handle: '@zoe@example.social' },
  { id: '2', name: 'Ben Ortiz', handle: '@ben@lemmy.example' },
  { id: '3', name: 'Ana', handle: '@ana_b@example.social' },
];

describe('finding someone in a long list of blocked or muted people', () => {
  test('an empty search keeps everyone, in order', () => expect(searchPeople(people, '  ')).toEqual(people));
  test('matches the name or the handle, ignoring case and accents', () => {
    expect(searchPeople(people, 'zoe').map(p => p.id)).toEqual(['1']);
    expect(searchPeople(people, 'MARTIN').map(p => p.id)).toEqual(['1']);
    expect(searchPeople(people, 'lemmy').map(p => p.id)).toEqual(['2']);
  });
  test('a leading @ and several words work as typed', () => {
    expect(searchPeople(people, '@ana_b').map(p => p.id)).toEqual(['3']);
    expect(searchPeople(people, 'example.social zoe').map(p => p.id)).toEqual(['1']);
    expect(searchPeople(people, 'ben zoe')).toEqual([]);
  });
});
