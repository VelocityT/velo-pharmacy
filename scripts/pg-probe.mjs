/**
 * Postgres wire-protocol handshake probe.
 *
 * A TCP connect to a Supabase pooler proves nothing: aws-0 and aws-1
 * are both AWS load balancers and both accept connections whether or
 * not your project lives behind them. The tenant lookup happens later,
 * during the Postgres startup handshake — which is exactly where
 * Prisma was failing while my TCP probe reported "reachable".
 *
 * So do the real handshake, and stop at the first server reply:
 *
 *   'R' AuthenticationRequest  → the pooler KNOWS this tenant.
 *                                Correct node. (We never send the
 *                                password; being asked is the answer.)
 *   'E' "Tenant or user not found"
 *                              → wrong pooler node. Try the other one.
 *   'E' anything else          → surfaced verbatim.
 *
 * No password is ever transmitted. Zero dependencies.
 */

import { createConnection } from "node:net";
import { connect as tlsConnect } from "node:tls";

const SSL_REQUEST = 80877103;
const PROTOCOL_3 = 196608;

function sslRequest() {
  const b = Buffer.alloc(8);
  b.writeInt32BE(8, 0);
  b.writeInt32BE(SSL_REQUEST, 4);
  return b;
}

function startupMessage(user, database) {
  const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`, "utf8");
  const b = Buffer.alloc(8 + params.length);
  b.writeInt32BE(8 + params.length, 0);
  b.writeInt32BE(PROTOCOL_3, 4);
  params.copy(b, 8);
  return b;
}

/** ErrorResponse is a series of (type byte, C-string) pairs, 0-terminated. */
function parseError(payload) {
  const fields = {};
  let i = 0;
  while (i < payload.length && payload[i] !== 0) {
    const type = String.fromCharCode(payload[i]);
    const end = payload.indexOf(0, i + 1);
    if (end === -1) break;
    fields[type] = payload.toString("utf8", i + 1, end);
    i = end + 1;
  }
  return fields;
}

const AUTH = {
  0: "OK (no password required)",
  3: "cleartext password",
  5: "MD5 password",
  10: "SASL / SCRAM-SHA-256",
  11: "SASL continue",
  12: "SASL final",
};

export function probe({ host, port, user, database = "postgres", timeoutMs = 10000 }) {
  return new Promise((resolve) => {
    const finish = (r) => {
      clearTimeout(timer);
      try {
        sock?.destroy();
        secure?.destroy();
      } catch {}
      resolve(r);
    };

    const timer = setTimeout(() => finish({ ok: false, kind: "TIMEOUT" }), timeoutMs);

    let sock, secure;
    try {
      sock = createConnection({ host, port });
    } catch (e) {
      return finish({ ok: false, kind: "CONNECT_ERROR", detail: String(e) });
    }

    sock.on("error", (e) => finish({ ok: false, kind: "CONNECT_ERROR", detail: e.message }));

    sock.once("connect", () => sock.write(sslRequest()));

    sock.once("data", (first) => {
      if (first[0] === 0x4e /* 'N' */) {
        return finish({ ok: false, kind: "NO_TLS", detail: "Server refused TLS" });
      }
      if (first[0] !== 0x53 /* 'S' */) {
        return finish({ ok: false, kind: "BAD_SSL_REPLY", detail: `byte ${first[0]}` });
      }

      secure = tlsConnect(
        { socket: sock, servername: host, rejectUnauthorized: false },
        () => secure.write(startupMessage(user, database)),
      );

      secure.on("error", (e) => finish({ ok: false, kind: "TLS_ERROR", detail: e.message }));

      let buf = Buffer.alloc(0);
      secure.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 5) return;

        const type = String.fromCharCode(buf[0]);
        const len = buf.readInt32BE(1);
        if (buf.length < len + 1) return;
        const payload = buf.subarray(5, len + 1);

        if (type === "R") {
          const method = payload.readInt32BE(0);
          return finish({
            ok: true,
            kind: "AUTH_REQUESTED",
            detail: AUTH[method] ?? `method ${method}`,
          });
        }

        if (type === "E") {
          const f = parseError(payload);
          const msg = f.M ?? "unknown error";
          const wrongTenant = /tenant|user not found|not found/i.test(msg);
          return finish({
            ok: false,
            kind: wrongTenant ? "WRONG_TENANT" : "SERVER_ERROR",
            detail: msg,
            code: f.C,
          });
        }

        finish({ ok: false, kind: "UNEXPECTED", detail: `message type '${type}'` });
      });
    });
  });
}
