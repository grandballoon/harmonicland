/* ====================================================================
   SECTIONS_API — the client of the sections server (api/). Two calls,
   one per verb, each carrying the account's credential (identity.ts):

     GET /v1/sections/:scoreKey  -> { sections: [{ range, name }] }
     PUT /v1/sections/:scoreKey  <- { sections: [{ range, name }] }

   A request that fails — no network, a server error, a timeout — rejects,
   and the cloud store (section-store.ts) keeps the edit for later. What
   comes back is untrusted, so it goes through the same `parse` as
   anything read from storage.
   ==================================================================== */
import { parse } from "./sections";
import { toJSON, type RemoteSections } from "./section-store";

/** Long enough for a cold start, short enough not to hold a save hostage. */
const TIMEOUT_MS = 8000;

export function sectionsApi(
  base: string,
  credential: () => string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): RemoteSections {
  const url = (k: string): string => `${base.replace(/\/+$/, "")}/v1/sections/${encodeURIComponent(k)}`;
  const call = async (k: string, init: RequestInit): Promise<Response> => {
    const res = await fetchFn(url(k), {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${credential()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`sections API: ${res.status}`);
    return res;
  };
  return {
    async get(k) {
      const body = await (await call(k, { method: "GET" })).json();
      return parse(body?.sections);
    },
    async put(k, sections) {
      await call(k, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: toJSON(sections) }),
      });
    },
  };
}
