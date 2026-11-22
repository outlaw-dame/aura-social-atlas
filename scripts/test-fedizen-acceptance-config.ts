import { strict as assert } from 'node:assert';
import { missingFedizenTestKeys, requireFedizenTestKeys } from './fedizen-acceptance-config';

const required = ['FEDIZEN_TEST_READ_TOKEN', 'FEDIZEN_TEST_EXPECTED_HANDLE'];
assert.deepEqual(missingFedizenTestKeys({}, required), required);
assert.deepEqual(missingFedizenTestKeys({
  FEDIZEN_TEST_READ_TOKEN: '    ',
  FEDIZEN_TEST_EXPECTED_HANDLE: 'disposable@fedizen.net',
}, required), ['FEDIZEN_TEST_READ_TOKEN']);
assert.deepEqual(missingFedizenTestKeys({
  FEDIZEN_TEST_READ_TOKEN: 'token-never-print-this',
  FEDIZEN_TEST_EXPECTED_HANDLE: 'disposable@fedizen.net',
}, required), []);
assert.throws(
  () => requireFedizenTestKeys({}, required),
  e => e instanceof Error && e.message.includes('FEDIZEN_TEST_READ_TOKEN') &&
    !e.message.includes('token-never-print-this'),
);
console.log('PASS: secret presence diagnostic never prints credential values');
