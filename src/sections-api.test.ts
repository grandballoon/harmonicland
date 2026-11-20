import { describe, it, expect } from "vitest";
import { sectionsApi } from "./sections-api";
import { add } from "./sections";

describe("the sections API client", () => {
  it("sends the key, and the sections as the server takes them", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = sectionsApi("https://api.test/", () => "KEY", async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 204 });
    });
    await api.put("file:a b", add([], { from: 0, to: 3 }, "A"));
    expect(calls[0].url).toBe("https://api.test/v1/sections/file%3Aa%20b");
    expect(calls[0].init.method).toBe("PUT");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer KEY");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ sections: [{ range: { from: 0, to: 3 }, name: "A" }] });
  });

  it("reads back only what parses", async () => {
    const api = sectionsApi("https://api.test", () => "KEY", async () =>
      Response.json({ sections: [{ range: { from: 2, to: 2 }, name: "x" }, { range: { from: 3 } }] }));
    expect((await api.get("demo")).map((s) => s.id)).toEqual(["2-2"]);
  });

  it("rejects when the server refuses, so the edit is kept for later", async () => {
    const api = sectionsApi("https://api.test", () => "KEY", async () => new Response("{}", { status: 500 }));
    await expect(api.get("demo")).rejects.toThrow("500");
    await expect(api.put("demo", [])).rejects.toThrow("500");
  });
});
