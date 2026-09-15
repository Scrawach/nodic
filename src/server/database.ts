import pg from 'pg';
import { readFile } from 'node:fs/promises';

export const defaultDatabaseUrl = 'postgres://nodic:nodic_local@127.0.0.1:55432/nodic';

export async function openDatabase(
  connectionString = process.env.DATABASE_URL || defaultDatabaseUrl,
) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // Idle connections can fail while PostgreSQL restarts. pg removes the client;
  // an error listener keeps that recoverable outage from crashing the process.
  const connectionError = () =>
    console.error('PostgreSQL connection lost; pending operations require retry.');
  pool.on('error', connectionError);
  // Checked-out clients have no pool error listener between queries (including
  // while a COMMIT response is lost). Queries still reject on connection failure.
  pool.on('connect', (client) => client.on('error', connectionError));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(714021)');
    await client.query(
      await readFile(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/002-graph-operations.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/003-graph-and-characters.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/004-character-colors.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/005-creation-operations.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/006-graph-history.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/007-deleted-characters.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      await readFile(new URL('./migrations/008-removal-receipts.sql', import.meta.url), 'utf8'),
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    await pool.end();
    throw error;
  } finally {
    client.release();
  }
  return pool;
}

export async function transaction<T>(pool: pg.Pool, action: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
