// Minimal type declarations for Cloudflare Workers + D1

export type D1Result<T = unknown> = { results?: T[]; success?: boolean; error?: string };
export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(col?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  raw<T = unknown>(): Promise<T[]>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[], tx?: boolean): Promise<D1Result<T>[]>;
  dump(): Promise<ArrayBuffer>;
  exec<T = unknown>(query: string): Promise<D1Result<T>>;
}

export interface Env {
  DB: D1Database;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN?: string;
  ADMIN_USERS?: string; // comma-separated Slack user IDs (optional in Phase 1)
}

// Minimal ExecutionContext shape to satisfy TS without external types
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}
