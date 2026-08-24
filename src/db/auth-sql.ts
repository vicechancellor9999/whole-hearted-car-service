import postgres from "postgres";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";

type PostgresClient = ReturnType<typeof postgres>;
type QueryRunner = (
  text: string,
  parameters: readonly unknown[],
) => Promise<unknown>;

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
    client.unsafe(text, parameters as never[]),
  );

  return {
    ...executor,
    async transaction(callback) {
      const result = await client.begin(async (transaction) => ({
        value: await callback(
          createExecutor((text, parameters) =>
            transaction.unsafe(text, parameters as never[]),
          ),
        ),
      }));
      return result.value;
    },
  };
}
