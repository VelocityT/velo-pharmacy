import { z } from "zod";

/**
 * Environment validation — LAZY.
 *
 * The obvious implementation validates at module load:
 *
 *     const parsed = schema.safeParse(raw());
 *     if (!parsed.success) throw ...
 *
 * That is wrong for Next.js. `next build` imports every route handler
 * during "Collecting page data", which imports this file, which throws
 * — so the build fails unless runtime secrets are present at build
 * time. A build should never need a database URL or a signing key.
 *
 * Instead, validation happens on FIRST PROPERTY ACCESS and is then
 * cached. Route handlers only read env when a request arrives, so:
 *   · `next build` never touches it        → builds anywhere
 *   · a real request with bad config fails loudly and immediately
 *
 * JWT_SECRET still has no fallback. A hardcoded default is how someone
 * who has read the repo mints admin tokens.
 */

/**
 * Treat an empty string as absent.
 *
 * A `.default()` only applies to `undefined`. Vercel (and any UI that
 * lets you create a variable before pasting its value) can deliver
 * `NODE_MODE=""`, which then fails validation instead of falling back
 * to the default — a confusing failure that reads as "not configured"
 * when the variable is plainly there in the dashboard.
 *
 * Required values (DATABASE_URL, JWT_SECRET) still fail on empty,
 * which is correct: a blank signing key must never be accepted.
 */
const raw = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NODE_MODE: z.enum(["CLOUD", "ONPREM_SERVER", "EDGE_COUNTER"]).default("CLOUD"),
  NODE_KEY: z.string().min(1).default("CLOUD"),

  DATABASE_URL: z.string().url(),
  /** Direct (unpooled) connection — migrations only. */
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

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(raw());
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Name what IS present, so "the variable exists but is blank" is
    // distinguishable from "the variable was never added".
    const present = Object.keys(process.env)
      .filter((k) => /^(NODE_MODE|NODE_KEY|DATABASE_URL|DIRECT_URL|JWT_SECRET|JWT_EXPIRES_IN|SYNC_|SEQUENCE_)/.test(k))
      .map((k) => `${k}=${process.env[k] ? `set (${String(process.env[k]).length} chars)` : "EMPTY"}`)
      .join("\n    ");

    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `What this process actually received:\n    ${present || "(none)"}\n\n` +
        `Set these in Vercel → Settings → Environments → Production, ` +
        `or in the repository-root .env for local work.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * Reads validate on first access, not at import. Everything downstream
 * uses `env.X` exactly as before — the laziness is invisible.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_t, prop: string) => load()[prop as keyof Env],
  has: (_t, prop: string) => prop in load(),
  ownKeys: () => Reflect.ownKeys(load()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

/** Mode helpers are functions, not constants — constants would evaluate at import. */
export const isOnPrem = () => env.NODE_MODE === "ONPREM_SERVER";
export const isEdge = () => env.NODE_MODE === "EDGE_COUNTER";
export const isCloud = () => env.NODE_MODE === "CLOUD";
