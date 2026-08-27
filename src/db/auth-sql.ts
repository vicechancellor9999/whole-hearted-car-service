import postgres from "postgres";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";

type PostgresClient = ReturnType<typeof postgres>;
type QueryRunner = (
  text: string,
  parameters: readonly unknown[],
) => Promise<unknown>;

export function normalizeSqlParameters(
  parameters: readonly unknown[],
): unknown[] {
  return parameters.map((value) =>
    value instanceof Date ? value.toISOString() : value
  );
}

export function createPostgresAuthSqlDatabase(
  client: PostgresClient,
): AuthSqlDatabase {
  const createExecutor = (run: QueryRunner): AuthSqlExecutor => ({
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      return (await run(text, parameters)) as Row[];
    },
  });

  const executor = createExecutor((text, parameters) =>
    client.unsafe(text, normalizeSqlParameters(parameters) as never[]),
  );

  return {
    ...executor,
    async transaction(callback) {
      const result = await client.begin(async (transaction) => ({
        value: await callback(
          createExecutor((text, parameters) =>
            transaction.unsafe(
              text,
              normalizeSqlParameters(parameters) as never[],
            ),
          ),
        ),
      }));
      return result.value;
    },
  };
}
