import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const journal = JSON.parse(readFileSync(file('../drizzle/migrations/meta/_journal.json'), 'utf8'));
const entries = journal.entries ?? [];
const tags = entries.map(row => row.tag);

assert.equal(tags.at(-1), '0002_fedizen_connections');
assert.equal(new Set(tags).size, tags.length);
assert.equal(tags.some(t => t.includes('fedizen_oauth_ownership')), false,
  'Unapproved ownership migration must NEVER be executable via Drizzle journal');
assert.equal(existsSync(file('../drizzle/migrations/0003_fedizen_oauth_ownership.sql')), false,
  'Pending ownership SQL must be outside the auto-applied migrations directory');
assert.equal(existsSync(file('../drizzle/migrations/meta/0003_snapshot.json')), false,
  'Do not leave misleading snapshot metadata for an unapplied migration');
const approvedLater = readFileSync(
  file('../drizzle/reviewed-not-applied/0003_fedizen_oauth_ownership.sql'), 'utf8',
);
assert.match(approvedLater, /ON DELETE CASCADE/);
assert.match(approvedLater, /UNIQUE \(user_id\)/);
console.log('PASS: unsafe automatic Drizzle migration path is disarmed; reviewed SQL retained');
