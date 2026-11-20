/* ====================================================================
   The sections server's decisions, pure: a request's method, path,
   headers and body in; what to do, or what to answer, out. index.ts is
   the shell that reads the request, runs the database call this asks
   for, and writes the response.

   The API (the client is src/sections-api.ts):

     GET /v1/sections/:scoreKey  -> 200 { sections: [{ range, name }] }
     PUT /v1/sections/:scoreKey  <- { sections: [{ range, name }] } -> 204

   Every request carries `Authorization: Bearer <key>` — today an
   anonymous key minted in the browser (src/identity.ts). The server
   stores only the key's SHA-256, as the user's id: the key is the
   account's name and password both. A real sign-in later issues a
   different credential and claims an anonymous id's rows; nothing here
   but `credential` needs to change for that.

   Sections are validated with the app's own parser (src/sections.ts), so
   the server accepts exactly what the app would load, and stored as the
   JSON the app sends — one row per user per score.
   ==================================================================== */
import { parse, type Section } from "../../src/sections";

/** What a key may look like. Keep in step with src/identity.ts, isKey. */
const KEY = /^[A-Za-z0-9_-]{22,128}$/;
/** A score's key: the app's own (`file:<hash>-<len>`, `demo`, a library
 *  piece's id) — printable, short. */
const SCORE_KEY = /^[\x21-\x7e]{1,256}$/;
/** Generous for a list of bar ranges with names; small enough to refuse
 *  anything that is not one. */
export const MAX_BODY = 256 * 1024;
export const MAX_SECTIONS = 2000;

export interface Req {
  method: string;
  path: string;
  authorization: string | null;
  origin: string | null;
}

export type Decision =
  | { kind: "preflight" }
  | { kind: "answer"; status: number; error: string }
  | { kind: "get"; credential: string; scoreKey: string }
  | { kind: "put"; credential: string; scoreKey: string };

export function decide({ method, path, authorization }: Req): Decision {
  const m = /^\/v1\/sections\/([^/]+)$/.exec(path);
  if (!m) return { kind: "answer", status: 404, error: "not found" };
  if (method === "OPTIONS") return { kind: "preflight" };
  if (method !== "GET" && method !== "PUT") return { kind: "answer", status: 405, error: "method not allowed" };
  let scoreKey: string;
  try {
    scoreKey = decodeURIComponent(m[1]);
  } catch {
    return { kind: "answer", status: 400, error: "bad score key" };
  }
  if (!SCORE_KEY.test(scoreKey)) return { kind: "answer", status: 400, error: "bad score key" };
  const credential = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!credential || !KEY.test(credential)) return { kind: "answer", status: 401, error: "missing or malformed key" };
  return { kind: method === "GET" ? "get" : "put", credential, scoreKey };
}

/** A PUT's body as sections, or why not. Entries the app would drop on
 *  load are dropped here too, by the same parser. */
export function readBody(text: string): { sections: readonly Section[] } | { error: string } {
  if (text.length > MAX_BODY) return { error: "body too large" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "body is not JSON" };
  }
  const raw = (data as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(raw)) return { error: "body has no sections list" };
  if (raw.length > MAX_SECTIONS) return { error: "too many sections" };
  return { sections: parse(raw) };
}

/** What is stored, and what a GET sends back: the range and the name. */
export const serialize = (sections: readonly Section[]): string =>
  JSON.stringify(sections.map(({ range, name }) => ({ range, name })));

/** A stored row back out as the body of a GET. A missing row is no
 *  sections; a row that no longer parses is too, rather than an error. */
export function getBody(stored: string | null): string {
  if (stored === null) return '{"sections":[]}';
  try {
    return `{"sections":${serialize(parse(JSON.parse(stored)))}}`;
  } catch {
    return '{"sections":[]}';
  }
}

/** CORS: the browser may call from the app's own origins, listed in the
 *  ALLOWED_ORIGINS variable, comma-separated. No cookies are involved —
 *  the key travels in a header — so this guards against other sites
 *  spending the server, not against forged requests. */
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin !== null && (list.includes("*") || list.includes(origin));
  return {
    ...(ok && { "Access-Control-Allow-Origin": origin }),
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
