import { z } from "zod";

/**
 * Environment validation.
 *
 * JWT_SECRET has NO fallback value and the process refuses to boot
 * without one. A hardcoded `|| "somestring"` default is how a
 * repo-reader mints admin tokens in production — this was a real
 * finding in the Velocare hospital ERP audit. Not repeating it.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NODE_MODE: z.enum(["CLOUD", "ONPREM_SERVER", "EDGE_COUNTER"]).default("CLOUD"),
  NODE_KEY: z.string().min(1).default("CLOUD"),

  DATABASE_URL: z.string().url(),
  // Direct (unpooled) connection — migrations only.
  DIRECT_URL: z.string().url().optional(),

  JWT_SECRET: z
    .string({ required_error: "JWT_SECRET is required — refusing to start." })
    .min(32, "JWT_SECRET must be at least 32 characters."),
  JWT_EXPIRES_IN: z.string().default("12h"),

  SYNC_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  SYNC_PEER_URL: z.string().url().optional().or(z.literal("")),
  SYNC_NODE_TOKEN: z.string().optional(),
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  SEQUENCE_BLOCK_SIZE: z.coerce.number().int().positive().default(1000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isOnPrem = env.NODE_MODE === "ONPREM_SERVER";
export const isEdge = env.NODE_MODE === "EDGE_COUNTER";
export const isCloud = env.NODE_MODE === "CLOUD";
