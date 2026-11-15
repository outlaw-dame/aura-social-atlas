import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { ACCENTS, accentHex, foregroundFor } from './accent';
import { followLabels } from './follow-labels';

describe('Accent color', () => {
  test('text on the accent is white when it reaches 3:1, else near-black', () => {
    strictEqual(foregroundFor('#FA243C'), '#FFFFFF');
    strictEqual(foregroundFor('#007AFF'), '#FFFFFF');
    strictEqual(foregroundFor('#FFCC00'), '#1C1C1E');
    strictEqual(foregroundFor('#00C7BE'), '#1C1C1E');
  });
  test('every accent is a 6-digit hex and unknown ids fall back to Atlas Red', () => {
    for (const a of ACCENTS) strictEqual(/^#[0-9A-F]{6}$/i.test(a.hex), true);
    strictEqual(accentHex('nope' as never), '#FA243C');
  });
});

describe('Follow wording', () => {
  test('podcasts are subscribed to; people are followed', () => {
    strictEqual(followLabels('podcast', false).off, 'Subscribe');
    strictEqual(followLabels('podcast', false).on, 'Subscribed');
    strictEqual(followLabels('podcast', true).off, 'Request to subscribe');
    strictEqual(followLabels('person', false).off, 'Follow');
  });
});
