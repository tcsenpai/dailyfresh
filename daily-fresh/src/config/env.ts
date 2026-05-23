import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const EnvSchema = z.object({
  DAILY_DEV_PAT: z.string().min(20, "DAILY_DEV_PAT missing or too short"),
  OPENAI_URL: z.string().url().optional(),
  OPENAI_TOKEN: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3737),
  BASE_URL: z.string().url().default("http://localhost:3737"),
  DB_PATH: z.string().default("./data/daily-fresh.db"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(50),
  COOKIE_SECRET: z
    .string()
    .min(16, "COOKIE_SECRET must be at least 16 chars")
    .default("dev-only-secret-please-rotate-in-production-xx"),
});

export type Env = z.infer<typeof EnvSchema>;

function hydrateFromDotenv(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || !m[1]) continue;
    const key = m[1];
    const rawValue = m[2] ?? "";
    if (process.env[key] !== undefined) continue;
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

function loadEnv(): Env {
  hydrateFromDotenv(resolve(import.meta.dir, "../../../.env"));
  hydrateFromDotenv(resolve(import.meta.dir, "../../.env"));

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:");
    console.error(JSON.stringify(z.treeifyError(parsed.error), null, 2));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
