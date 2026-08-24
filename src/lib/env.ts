import { z } from "zod";

const appEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
        "DATABASE_URL must use PostgreSQL",
      ),
    APP_ORIGIN: z.url(),
    APP_TIMEZONE: z.literal("America/Jamaica"),
    SESSION_COOKIE_NAME: z.literal("wh_session"),
    SESSION_TOKEN_PEPPER: z.string().min(32),
    UPLOAD_ROOT: z.string().startsWith("/"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.APP_ORIGIN.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        message: "APP_ORIGIN must use HTTPS in production",
        path: ["APP_ORIGIN"],
      });
    }
  });

export type AppEnv = z.infer<typeof appEnvSchema>;

export function parseAppEnv(source: Record<string, unknown>): AppEnv {
  return appEnvSchema.parse(source);
}
