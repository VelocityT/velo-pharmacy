/**
 * npm run env:check
 *
 * Diagnoses the .env before you waste time on a migration that was
 * never going to connect. Checks the three things that actually go
 * wrong on Windows, in the order they go wrong:
 *
 *   1. The file is named .env.txt — Notepad appends .txt silently
 *      unless the filename was quoted. By far the most common cause.
 *   2. It's in the wrong folder — apps/cloud/.env instead of the root.
 *   3. The password contains characters that break URL parsing.
 *
 * Prints nothing sensitive: passwords are masked.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

let problems = 0;
const fail = (m, fix) => {
  problems++;
  console.log(`\n  ✗ ${m}`);
  if (fix) console.log(`    → ${fix}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);

console.log("\n  Environment check\n  " + "─".repeat(60));

// ── 1. Does the file exist, and is it actually called ".env"? ──
if (!existsSync(envPath)) {
  fail(`No .env at ${envPath}`);

  const strays = readdirSync(root).filter(
    (f) => f.toLowerCase().startsWith(".env") && f !== ".env" && f !== ".env.example",
  );
  if (strays.length) {
    console.log(`    Found instead: ${strays.join(", ")}`);
    if (strays.some((f) => f.toLowerCase().endsWith(".txt"))) {
      console.log(
        `    Notepad added .txt. Rename it:\n` +
          `      Rename-Item ".env.txt" ".env"`,
      );
    }
  }
  if (existsSync(join(root, "apps", "cloud", ".env"))) {
    console.log(
      `    There IS one at apps\\cloud\\.env — it belongs at the root.\n` +
        `      Move-Item apps\\cloud\\.env .env`,
    );
  }
  console.log(
    `\n    Create it without Notepad's .txt problem:\n` +
      `      Copy-Item .env.example .env ; notepad .env\n`,
  );
  process.exit(1);
}
ok(".env found at the repository root");

// ── 2. Parse ──────────────────────────────────────────────────
const vars = {};
for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  vars[line.slice(0, i).trim()] = line
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

// ── 3. Required keys ──────────────────────────────────────────
for (const k of ["NODE_MODE", "DATABASE_URL", "DIRECT_URL", "JWT_SECRET"]) {
  if (!vars[k]) fail(`${k} is missing or empty`);
}

if (vars.JWT_SECRET && vars.JWT_SECRET.length < 32) {
  fail(
    `JWT_SECRET is only ${vars.JWT_SECRET.length} characters; 32 required`,
    `PowerShell:  [Convert]::ToBase64String((1..48|%{Get-Random -Max 256}))`,
  );
} else if (vars.JWT_SECRET) {
  ok(`JWT_SECRET present (${vars.JWT_SECRET.length} chars)`);
}

// ── 4. Connection strings ─────────────────────────────────────
const RISKY = { "/": "%2F", "@": "%40", "#": "%23", "?": "%3F", ":": "%3A", $: "%24" };

/**
 * A bare "%" is only a problem when it is NOT already the start of a
 * valid escape. Flagging every "%" would reject a correctly-encoded
 * password like 98wb%247E%2F, which is exactly backwards.
 */
const hasLoosePercent = (s) => /%(?![0-9A-Fa-f]{2})/.test(s);

function checkUrl(name, url, expectPort) {
  if (!url) return;

  const m = /^postgresql:\/\/([^:]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/.exec(url);
  if (!m) {
    fail(
      `${name} is not a parseable Postgres URL`,
      `Expected: postgresql://user:password@host:port/database`,
    );
    // Unencoded "/" is the usual reason the regex above fails.
    const after = url.slice("postgresql://".length);
    const at = after.lastIndexOf("@");
    if (at > -1 && after.slice(0, at).includes("/")) {
      console.log(
        `    The password contains an unencoded "/" — it ends the host\n` +
          `    section, so the URL parses wrong and you get an auth error.\n` +
          `    Encode it as %2F, or reset to an alphanumeric password.`,
      );
    }
    return;
  }

  const [, user, pass, host, port, db] = m;
  const masked = pass.length > 4 ? pass.slice(0, 2) + "*".repeat(pass.length - 4) + pass.slice(-2) : "****";

  const bad = Object.keys(RISKY).filter((c) => pass.includes(c));
  if (hasLoosePercent(pass)) bad.push("%");
  if (bad.length) {
    fail(
      `${name} password contains ${bad.map((c) => `"${c}"`).join(", ")} unencoded`,
      `Encode: ${bad.map((c) => `${c} → ${c === "%" ? "%25" : RISKY[c]}`).join("  ")}   ` +
        `(or reset to an alphanumeric password — simpler)`,
    );
  }

  if (String(port) !== String(expectPort)) {
    fail(
      `${name} uses port ${port}; expected ${expectPort}`,
      expectPort === 6543
        ? `DATABASE_URL must be the Transaction pooler (6543)`
        : `DIRECT_URL must be the Session pooler (5432)`,
    );
  }

  if (name === "DATABASE_URL" && host.includes("pooler") && !url.includes("pgbouncer=true")) {
    fail(
      `DATABASE_URL is missing ?pgbouncer=true`,
      `Without it you get 'prepared statement "s0" already exists' on the 2nd request`,
    );
  }

  if (name === "DIRECT_URL" && /^db\..*\.supabase\.co$/.test(host)) {
    fail(
      `DIRECT_URL uses Supabase's "Direct connection" host`,
      `That host is IPv6-only and most Indian ISPs are IPv4. Use the ` +
        `Session pooler string (…pooler.supabase.com:5432).`,
    );
  }

  if (!bad.length) ok(`${name}  ${user}:${masked}@${host}:${port}/${db.split("?")[0]}`);
}

checkUrl("DATABASE_URL", vars.DATABASE_URL, 6543);
checkUrl("DIRECT_URL", vars.DIRECT_URL, 5432);

// ── 5. Verdict ────────────────────────────────────────────────
console.log("  " + "─".repeat(60));
if (problems === 0) {
  console.log("\n  All good. Next:  npm run db:migrate\n");
} else {
  console.log(`\n  ${problems} problem(s) above. Fix, then run this again.\n`);
  process.exit(1);
}
