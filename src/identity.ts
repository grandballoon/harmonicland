/* ====================================================================
   IDENTITY — who the sections on the server belong to. Today that is an
   anonymous key: a random secret minted in this browser on first visit,
   sent with every request as a bearer token. The server keeps only its
   hash, so the key is both the name and the password of an anonymous
   account. Carrying it to another browser (the tray's sync row) carries
   the account.

   This is the seam a real sign-in replaces: the sections API asks for a
   credential and nothing else, so a session token from an identity
   service can stand where this key stands, and the server can attach an
   anonymous account's sections to the signed-in user it becomes.
   ==================================================================== */

export interface Identity {
  /** The credential to send, minting one on first use. */
  key(): string;
  /** True only on the visit that minted the key: there was no account
   *  before, so whatever this browser already saved should be uploaded. */
  readonly fresh: boolean;
  /** Become the account a key from another browser names. */
  adopt(key: string): void;
}

const KEY = "harmonicland.identity.v1";

/** What a key may look like: what `mint` makes, give or take. Also what
 *  the server accepts — keep the two in step (api/src/core.ts). */
export const isKey = (k: string): boolean => /^[A-Za-z0-9_-]{22,128}$/.test(k);

/** 128 random bits, base64url. */
export function mint(random: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The key kept in localStorage. Storage that cannot be read or written
 *  still yields a key — for this visit only. */
export function storedIdentity(storage: () => Storage | null = () => globalThis.localStorage ?? null): Identity {
  let key: string | null = null;
  let fresh = false;
  try {
    key = storage()?.getItem(KEY) ?? null;
  } catch {
    key = null;
  }
  if (key === null || !isKey(key)) {
    key = mint();
    fresh = true;
    try {
      storage()?.setItem(KEY, key);
    } catch {
      // this visit has an account; the next mints another
    }
  }
  return {
    key: () => key!,
    fresh,
    adopt(k) {
      if (!isKey(k)) throw new Error("not a sync key");
      key = k;
      try {
        storage()?.setItem(KEY, k);
      } catch {
        // as above
      }
    },
  };
}
