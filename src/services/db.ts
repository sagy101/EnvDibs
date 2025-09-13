import type { D1Database } from '../types';

// We rely on uniqueness constraints and guarded INSERTs for correctness.
export async function withTransaction<T>(_db: D1Database, fn: () => Promise<T>): Promise<T> {
  return fn();
}
