/* ====================================================================
   ALIGNMENT_STORE — where tapped barlines live between visits: the
   browser's localStorage, one entry per score AND recording. Two
   recordings of one piece are two performances, each with its own
   barlines, and the same recording opened again finds its own. Behind an
   interface for the reasons section-store.ts gives, and guarded the same
   way: a load that fails is no anchors, a save that fails forgets on
   reload.
   ==================================================================== */
import { parse, type Anchor } from "./alignment";

export interface AlignmentStore {
  load(scoreKey: string, recordingKey: string): readonly Anchor[];
  save(scoreKey: string, recordingKey: string, anchors: readonly Anchor[]): void;
}

/** Versioned, so a future change of shape can read the old one. */
const PREFIX = "harmonicland.alignment.v1:";
const keyOf = (scoreKey: string, recordingKey: string): string => `${PREFIX}${scoreKey}|${recordingKey}`;

export function localAlignmentStore(storage: () => Storage | null = () => globalThis.localStorage ?? null): AlignmentStore {
  return {
    load(scoreKey, recordingKey) {
      try {
        const raw = storage()?.getItem(keyOf(scoreKey, recordingKey));
        return raw ? parse(JSON.parse(raw)) : [];
      } catch {
        return [];
      }
    },
    save(scoreKey, recordingKey, anchors) {
      try {
        const s = storage();
        if (!s) return;
        if (anchors.length === 0) s.removeItem(keyOf(scoreKey, recordingKey));
        else s.setItem(keyOf(scoreKey, recordingKey), JSON.stringify(anchors.map(({ bar, at }) => ({ bar, at }))));
      } catch {
        // quota or permissions: this visit keeps working, the next forgets
      }
    },
  };
}

/** A store that forgets on reload — for tests. */
export function memoryAlignmentStore(): AlignmentStore {
  const data = new Map<string, readonly Anchor[]>();
  return {
    load: (s, r) => data.get(keyOf(s, r)) ?? [],
    save: (s, r, a) => void data.set(keyOf(s, r), a),
  };
}
