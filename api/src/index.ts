/* ====================================================================
   The sections server: a Cloudflare Worker over a D1 database. This file
   is the shell — read the request, hash the key, run the one statement
   core.ts decided on, write the response. The decisions, the API, and
   why it is shaped this way are at the top of core.ts; the tables are
   migrations/0001_init.sql.
   ==================================================================== */
import { corsHeaders, decide, getBody, readBody, serialize } from "./core";

/** The parts of D1 this uses — declared here rather than pulling in the
 *  whole of @cloudflare/workers-types for three methods. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
}

/** A user's stored sections, one row per score. Behind an interface so
 *  the handler is tested against memory; d1Store is the real one. */
export interface Store {
  get(userId: string, scoreKey: string): Promise<string | null>;
  put(userId: string, scoreKey: string, body: string, now: number): Promise<void>;
  remove(userId: string, scoreKey: string): Promise<void>;
}

export function d1Store(db: D1Database): Store {
  return {
    async get(userId, scoreKey) {
      const row = await db
        .prepare("SELECT body FROM sections WHERE user_id = ? AND score_key = ?")
        .bind(userId, scoreKey)
        .first<{ body: string }>();
      return row?.body ?? null;
    },
    async put(userId, scoreKey, body, now) {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)").bind(userId, now),
        db
          .prepare(
            `INSERT INTO sections (user_id, score_key, body, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (user_id, score_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
          )
          .bind(userId, scoreKey, body, now),
      ]);
    },
    async remove(userId, scoreKey) {
      await db.prepare("DELETE FROM sections WHERE user_id = ? AND score_key = ?").bind(userId, scoreKey).run();
    },
  };
}

/** A key's user id: its SHA-256, hex. The key itself is never stored. */
export async function userIdOf(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(request: Request, store: Store, allowedOrigins: string, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(request.headers.get("Origin"), allowedOrigins);
  const json = (status: number, body: string): Response =>
    new Response(body, { status, headers: { ...cors, "Content-Type": "application/json" } });

  const d = decide({
    method: request.method,
    path: new URL(request.url).pathname,
    authorization: request.headers.get("Authorization"),
    origin: request.headers.get("Origin"),
  });
  switch (d.kind) {
    case "preflight":
      return new Response(null, { status: 204, headers: cors });
    case "answer":
      return json(d.status, JSON.stringify({ error: d.error }));
    case "get":
      return json(200, getBody(await store.get(await userIdOf(d.credential), d.scoreKey)));
    case "put": {
      const body = readBody(await request.text());
      if ("error" in body) return json(400, JSON.stringify({ error: body.error }));
      const user = await userIdOf(d.credential);
      if (body.sections.length === 0) await store.remove(user, d.scoreKey);
      else await store.put(user, d.scoreKey, serialize(body.sections), now);
      return new Response(null, { status: 204, headers: cors });
    }
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, d1Store(env.DB), env.ALLOWED_ORIGINS ?? ""),
};
