/** Side-effect-free guard for disposable PostgreSQL integration testing. */
export function safeDisposablePostgresUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.pathname === '/atlas_migration_test' &&
      !parsed.search && !parsed.hash &&
      parsed.port === '5432';
  } catch {
    return false;
  }
}
