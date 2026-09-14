import type pg from 'pg';
import { transaction } from './database';

class OperationConflict extends Error {
  statusCode = 409;
}

// The caller checks access on every request, including replays.
export async function createOnce<T>(
  pool: pg.Pool,
  scope: string,
  operationId: string | undefined,
  input: unknown,
  create: (client: pg.PoolClient) => Promise<T>,
): Promise<{ value: T; created: boolean }> {
  return transaction(pool, async (client) => {
    if (!operationId) return { value: await create(client), created: true };
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      scope + ':' + operationId,
    ]);
    const previous = await client.query(
      'SELECT input, result FROM creation_operations WHERE scope=$1 AND operation_id=$2',
      [scope, operationId],
    );
    if (previous.rows[0]) {
      const same = await client.query(
        'SELECT input = $3::jsonb AS same FROM creation_operations WHERE scope=$1 AND operation_id=$2',
        [scope, operationId, JSON.stringify(input)],
      );
      if (!same.rows[0].same)
        throw new OperationConflict('Идентификатор операции уже использован с другими данными.');
      return { value: previous.rows[0].result as T, created: false };
    }
    const value = await create(client);
    await client.query(
      'INSERT INTO creation_operations(scope,operation_id,input,result) VALUES ($1,$2,$3,$4)',
      [scope, operationId, JSON.stringify(input), JSON.stringify(value)],
    );
    return { value, created: true };
  });
}
