// @vitest-environment node
import { describe, it, expect } from "vitest";
import { corsHeaders, decide, getBody, readBody } from "./core";
import { handle, userIdOf, type Store } from "./index";

const KEY = "abcdefghijklmnopqrstuv"; // 22 characters: the shortest key
const req = (over: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({ method: "GET", path: "/v1/sections/demo", authorization: `Bearer ${KEY}`, origin: null, ...over });

describe("the server's decisions", () => {
  it("reads a score's sections, or writes them, for the key's account", () => {
    expect(req()).toEqual({ kind: "get", credential: KEY, scoreKey: "demo" });
    expect(req({ method: "PUT", path: "/v1/sections/file%3Aabc-1z" }))
      .toEqual({ kind: "put", credential: KEY, scoreKey: "file:abc-1z" });
  });

  it("refuses what is not the API, or not a well-formed request", () => {
    expect(req({ path: "/" })).toMatchObject({ status: 404 });
    expect(req({ path: "/v1/sections/a/b" })).toMatchObject({ status: 404 });
    expect(req({ method: "DELETE" })).toMatchObject({ status: 405 });
    expect(req({ path: "/v1/sections/%E0%A4%A" })).toMatchObject({ status: 400 });
    expect(req({ path: "/v1/sections/a%20b" })).toMatchObject({ status: 400 });
    expect(req({ authorization: null })).toMatchObject({ status: 401 });
    expect(req({ authorization: "Bearer short" })).toMatchObject({ status: 401 });
    expect(req({ authorization: KEY })).toMatchObject({ status: 401 });
  });

  it("answers a preflight without a key", () => {
    expect(req({ method: "OPTIONS", authorization: null })).toEqual({ kind: "preflight" });
  });

  it("takes a body of sections by the app's own rules, dropping what the app would", () => {
    const body = readBody(JSON.stringify({ sections: [
      { range: { from: 4, to: 7 }, name: "B" },
      { range: { from: 0, to: 3 }, name: " A " },
      { range: { from: 3, to: 1 } },
    ] }));
    expect("sections" in body && body.sections.map((s) => [s.id, s.name])).toEqual([["0-3", "A"], ["4-7", "B"]]);
    expect(readBody("{")).toEqual({ error: "body is not JSON" });
    expect(readBody("[]")).toEqual({ error: "body has no sections list" });
    expect(readBody("x".repeat(256 * 1024 + 1))).toEqual({ error: "body too large" });
  });

  it("hands back nothing for a score never saved, or a row gone bad", () => {
    expect(getBody(null)).toBe('{"sections":[]}');
    expect(getBody("{not json")).toBe('{"sections":[]}');
    expect(getBody('[{"range":{"from":0,"to":1},"name":"x"}]'))
      .toBe('{"sections":[{"range":{"from":0,"to":1},"name":"x"}]}');
  });

  it("lets the app's origins call it, and no other", () => {
    const allowed = "http://localhost:5173, https://grandballoon.github.io";
    expect(corsHeaders("https://grandballoon.github.io", allowed)["Access-Control-Allow-Origin"])
      .toBe("https://grandballoon.github.io");
    expect(corsHeaders("https://elsewhere.example", allowed)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(null, allowed)["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

function memoryStore(): Store & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const k = (u: string, s: string) => `${u} ${s}`;
  return {
    rows,
    get: async (u, s) => rows.get(k(u, s)) ?? null,
    put: async (u, s, body) => void rows.set(k(u, s), body),
    remove: async (u, s) => void rows.delete(k(u, s)),
  };
}

const call = (store: Store, method: string, key: string, body?: unknown) =>
  handle(new Request("https://api.test/v1/sections/demo", {
    method,
    headers: { Authorization: `Bearer ${key}`, Origin: "http://localhost:5173" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }), store, "http://localhost:5173");

describe("the server", () => {
  it("keeps each account's sections apart, and stores no key", async () => {
    const store = memoryStore();
    const other = "zyxwvutsrqponmlkjihgfedcba";
    const put = await call(store, "PUT", KEY, { sections: [{ range: { from: 0, to: 3 }, name: "A" }] });
    expect(put.status).toBe(204);
    expect(put.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(await (await call(store, "GET", KEY)).json())
      .toEqual({ sections: [{ range: { from: 0, to: 3 }, name: "A" }] });
    expect(await (await call(store, "GET", other)).json()).toEqual({ sections: [] });
    expect([...store.rows.keys()].join()).not.toContain(KEY);
    expect([...store.rows.keys()][0]).toContain(await userIdOf(KEY));
  });

  it("forgets a score when its last section goes", async () => {
    const store = memoryStore();
    await call(store, "PUT", KEY, { sections: [{ range: { from: 0, to: 0 }, name: "" }] });
    await call(store, "PUT", KEY, { sections: [] });
    expect(store.rows.size).toBe(0);
  });

  it("refuses a body that is not sections, and writes nothing", async () => {
    const store = memoryStore();
    const res = await call(store, "PUT", KEY, { nope: 1 });
    expect(res.status).toBe(400);
    expect(store.rows.size).toBe(0);
  });

  it("hashes a key the same way every time, to 64 hex digits", async () => {
    expect(await userIdOf(KEY)).toBe(await userIdOf(KEY));
    expect(await userIdOf(KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});
