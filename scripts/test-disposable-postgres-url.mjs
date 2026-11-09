import { strict as assert } from 'node:assert';
import { safeDisposablePostgresUrl } from './disposable-postgres-url.mjs';

for (const valid of [
  'postgres://postgres:temporary-ci-only@localhost:5432/atlas_migration_test',
  'postgresql://postgres:temporary-ci-only@127.0.0.1:5432/atlas_migration_test',
]) assert.equal(safeDisposablePostgresUrl(valid), true);

for (const invalid of [
  undefined, '', 'not-a-url',
  'postgres://postgres:pw@localhost:5432/atlas_migration_test_production',
  'postgres://postgres:pw@db.example.com:5432/atlas_migration_test',
  'postgres://postgres:pw@localhost:5433/atlas_migration_test',
  'postgres://postgres:pw@localhost:5432/atlas_migration_test?sslmode=disable',
  'postgres://postgres:pw@localhost:5432/atlas_migration_test#fragment',
  'https://localhost:5432/atlas_migration_test',
  'postgres://postgres:pw@localhost:5432/postgres',
]) assert.equal(safeDisposablePostgresUrl(invalid), false, 'Rejected unsafe target');

console.log('PASS: disposable migration URL validation without a database connection');
