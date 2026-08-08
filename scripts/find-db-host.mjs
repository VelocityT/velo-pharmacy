/**
 * npm run db:find
 *
 * Finds which Supabase endpoint actually serves your project, and
 * rewrites .env with the answer.
 *
 * Why this is not just a TCP check: aws-0 and aws-1 are both AWS load
 * balancers and BOTH accept TCP connections whether or not your
 * project lives behind them. The tenant lookup happens later, in the
 * Postgres startup handshake. So this performs the real handshake and
 * stops at the server's first reply:
 *
 *   AuthenticationRequest      → correct node (we never send the password;
 *                                being ASKED for one is the proof)
 *   "Tenant or user not found" → wrong node, try the other
 *
 * P1001 has several causes that produce an identical message. This
 * separates them instead of leaving you to guess.
 */

import { lookup } from "node:dns/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probe } from "./pg-probe.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

function fromEnv() {
  if (!existsSync(envPath)) return {};
  const t = readFileSync(envPath, "utf8");
  return {
    ref: /postgres\.([a-z0-9]{20})/.exec(t)?.[1],
    region: /aws-\d-([a-z0-9-]+)\.pooler/.exec(t)?.[1],
    pass: /postgresql:\/\/postgres\.[a-z0-9]+:([^@]+)@/.exec(t)?.[1],
  };
}

const env = fromEnv();
const ref = arg("ref") ?? env.ref;
const region = arg("region") ?? env.region ?? "ap-southeast-1";

if (!ref) {
  console.log(
    "\n  No project ref found. Pass one:\n" +
      "    npm run db:find -- --ref=<20-char-ref> --region=ap-southeast-1\n",
  );
  process.exit(1);
}

const user = `postgres.${ref}`;

console.log(`\n  Finding the pooler that serves ${ref}`);
console.log(`  region: ${region}     (handshake only — your password is never sent)`);
console.log("  " + "─".repeat(70));

const candidates = [
  { host: `aws-0-${region}.pooler.supabase.com`, port: 6543, role: "DATABASE_URL", label: "transaction pooler" },
  { host: `aws-1-${region}.pooler.supabase.com`, port: 6543, role: "DATABASE_URL", label: "transaction pooler" },
  { host: `aws-0-${region}.pooler.supabase.com`, port: 5432, role: "DIRECT_URL", label: "session pooler" },
  { host: `aws-1-${region}.pooler.supabase.com`, port: 5432, role: "DIRECT_URL", label: "session pooler" },
];

const results = [];
for (const c of candidates) {
  let ip = null;
  try {
    ip = (await lookup(c.host)).address;
  } catch {
    console.log(`  ✗  ${c.host}:${c.port}  — DNS does not resolve`);
    results.push({ ...c, serves: false });
    continue;
  }

  const r = await probe({ host: c.host, port: c.port, user });
  const serves = r.ok && r.kind === "AUTH_REQUESTED";

  const mark = serves ? "✓" : r.kind === "WRONG_TENANT" ? "·" : "✗";
  const note = serves
    ? `SERVES THIS PROJECT — asked for ${r.detail}`
    : r.kind === "WRONG_TENANT"
      ? "not this project's node"
      : `${r.kind}${r.detail ? `: ${r.detail}` : ""}`;

  console.log(`  ${mark}  ${c.host}:${c.port}  [${ip}]`);
  console.log(`     ${c.label} — ${note}`);
  results.push({ ...c, serves, kind: r.kind, detail: r.detail });
}

console.log("  " + "─".repeat(70));

const pooled = results.find((r) => r.role === "DATABASE_URL" && r.serves);
const direct = results.find((r) => r.role === "DIRECT_URL" && r.serves);

// ── Diagnosis ─────────────────────────────────────────────────
if (!pooled && !direct) {
  const anyTenantError = results.some((r) => r.kind === "WRONG_TENANT");
  const anyTimeout = results.some((r) => r.kind === "TIMEOUT" || r.kind === "CONNECT_ERROR");

  if (anyTenantError) {
    console.log(
      `\n  Every node replied "tenant not found". The project ref in .env is\n` +
        `  probably wrong, or the project is paused.\n` +
        `  Supabase free tier pauses after 7 days idle — check the dashboard.\n`,
    );
  } else if (anyTimeout) {
    console.log(
      `\n  Nothing answered. Wrong region, or this network blocks the port.\n` +
        `  Try:  npm run db:find -- --region=ap-south-1\n`,
    );
  } else {
    console.log(`\n  No endpoint served this project. Copy the exact string from`);
    console.log(`  the Supabase dashboard's Connect button.\n`);
  }
  process.exit(1);
}

if (pooled && !direct) {
  console.log(
    `\n  Transaction pooler works but the session pooler does not.\n` +
      `  Migrations need 5432, so either:\n` +
      `    a) run 'npm run db:migrate' once from a mobile hotspot, or\n` +
      `    b) ask me to apply the schema through the Supabase MCP instead.\n`,
  );
}

// ── Rewrite .env ──────────────────────────────────────────────
if (pooled && direct && env.pass) {
  const txt = readFileSync(envPath, "utf8");
  const fixed = txt
    .replace(
      /DATABASE_URL="[^"]*"/,
      `DATABASE_URL="postgresql://${user}:${env.pass}@${pooled.host}:6543/postgres?pgbouncer=true&connection_limit=1"`,
    )
    .replace(
      /DIRECT_URL="[^"]*"/,
      `DIRECT_URL="postgresql://${user}:${env.pass}@${direct.host}:5432/postgres"`,
    );

  if (fixed !== txt) {
    writeFileSync(envPath, fixed);
    console.log(`\n  ✓ .env rewritten with the endpoints that serve this project:`);
  } else {
    console.log(`\n  ✓ .env already correct:`);
  }
  console.log(`      DATABASE_URL → ${pooled.host}:6543`);
  console.log(`      DIRECT_URL   → ${direct.host}:5432`);
  console.log(`\n  Next:  npm run db:migrate\n`);
} else if (pooled || direct) {
  console.log(`\n  Update .env by hand:`);
  if (pooled) console.log(`      DATABASE_URL host → ${pooled.host}:6543`);
  if (direct) console.log(`      DIRECT_URL   host → ${direct.host}:5432`);
  console.log();
}
