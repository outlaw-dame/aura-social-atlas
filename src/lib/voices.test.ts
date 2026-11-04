import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { voices, voicesPage } from './voices';

describe('Voices to know rotation', () => {
  test('shows 6 voices at a time', () => {
    strictEqual(voicesPage(0).length, 6);
    strictEqual(voicesPage(2).length, 6);
  });
  test('next page shows different voices', () => {
    strictEqual(voicesPage(1)[0].id, voices[6].id);
  });
});
