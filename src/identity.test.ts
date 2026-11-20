import { describe, it, expect, beforeEach } from "vitest";
import { isKey, mint, storedIdentity } from "./identity";

describe("the anonymous identity", () => {
  beforeEach(() => localStorage.clear());

  it("mints a key once, and is fresh only on that visit", () => {
    const first = storedIdentity();
    expect(first.fresh).toBe(true);
    expect(isKey(first.key())).toBe(true);
    const again = storedIdentity();
    expect(again.fresh).toBe(false);
    expect(again.key()).toBe(first.key());
  });

  it("mints 128 random bits, base64url, that the server will accept", () => {
    const k = mint((b) => b.fill(255));
    expect(k).toBe("_____________________w");
    expect(isKey(k)).toBe(true);
    expect(mint()).not.toBe(mint());
  });

  it("adopts another browser's key, and refuses what is not one", () => {
    const id = storedIdentity();
    const other = mint();
    id.adopt(other);
    expect(id.key()).toBe(other);
    expect(storedIdentity().key()).toBe(other);
    expect(() => id.adopt("not a key")).toThrow();
  });

  it("still has a key when storage is unavailable", () => {
    const id = storedIdentity(() => null);
    expect(isKey(id.key())).toBe(true);
    expect(id.fresh).toBe(true);
  });
});
