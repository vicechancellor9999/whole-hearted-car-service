import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { AuthService } from "@/modules/auth/auth-service";
import { DatabaseAuthRepository } from "@/modules/auth/session-repository";
import { parseAppEnv } from "@/lib/env";

const INVALID_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$bCwk6NwXn/fw46GcrPOujQ$vKjQNpdddOFM/PM0MyncszdelwftGSV35hbKN3XFpCw";

export function createAuthRuntime(
  source: Record<string, unknown> = process.env,
) {
  const env = parseAppEnv(source);
  const databaseClient = createDatabaseClient(source);
  const repository = new DatabaseAuthRepository(
    createPostgresAuthSqlDatabase(databaseClient.sql),
  );

  return {
    env,
    service: new AuthService(repository, {
      sessionTokenPepper: env.SESSION_TOKEN_PEPPER,
      invalidPasswordHash: INVALID_PASSWORD_HASH,
    }),
    close: databaseClient.close,
  };
}
