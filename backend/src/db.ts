import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema';

/**
 * We use Node's built-in SQLite (node:sqlite, Node 22.13+): nothing to compile,
 * so `npm install` works on Windows/Mac/Linux without a C++ toolchain.
 * This tiny wrapper gives the rest of the code a small, familiar API.
 */
export interface Stmt {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
export interface Tx<T> { (): T; immediate(): T }
export interface DB {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  /** Wraps fn in a transaction. `.immediate()` takes the write lock up front (BEGIN IMMEDIATE). */
  transaction<T>(fn: () => T): Tx<T>;
  close(): void;
}

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000'); // wait for the write lock instead of failing
  raw.exec(SCHEMA);

  const runIn = <T>(begin: string, fn: () => T) => () => {
    raw.exec(begin);
    try {
      const result = fn();
      raw.exec('COMMIT');
      return result;
    } catch (e) {
      try { raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e; // any error (e.g. "seat taken") undoes everything done in the transaction
    }
  };

  return {
    prepare: (sql) => raw.prepare(sql) as unknown as Stmt,
    exec: (sql) => raw.exec(sql),
    transaction: <T,>(fn: () => T) => {
      const t = runIn('BEGIN', fn) as Tx<T>;
      t.immediate = runIn('BEGIN IMMEDIATE', fn);
      return t;
    },
    close: () => raw.close(),
  };
}
