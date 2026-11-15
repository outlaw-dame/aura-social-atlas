import { describe, test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { claimMedia, releaseMedia } from './media-focus';

describe('One thing plays at a time', () => {
  test('whatever starts pauses every other owner, and a released owner is left alone', () => {
    const paused: string[] = [];
    claimMedia('audio', () => paused.push('audio'));
    claimMedia('video', () => paused.push('video'));
    claimMedia('embed:https://tube.example.org/w/x', () => paused.push('embed'));
    deepStrictEqual(paused, ['audio', 'audio', 'video']);
    releaseMedia('embed:https://tube.example.org/w/x');
    claimMedia('audio', () => paused.push('audio'));
    deepStrictEqual(paused.slice(3), ['video']);
  });
});
