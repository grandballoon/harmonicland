import { describe, it, expect } from "vitest";
import {
  triadPitchClasses, transform, translate, voiceTriad,
  type Cursor, type Transform, type LatticeStep,
} from "./tonnetz-lattice";

const C = (col: number, row: number, orient: "up" | "down"): Cursor => ({ col, row, orient });
const origin = C(0, 0, "up");

const pcsSet = (c: Cursor) => {
  const { root, third, fifth } = triadPitchClasses(c);
  return new Set([root, third, fifth]);
};

describe("triadPitchClasses", () => {
  it("up (0,0) is C major {root:0, third:4, fifth:7}", () => {
    expect(triadPitchClasses(origin)).toEqual({ root: 0, third: 4, fifth: 7 });
  });
});

describe("voiceTriad", () => {
  it("up (0,0) at octave 4 is [60,64,67]", () => {
    expect(voiceTriad(origin, 4)).toEqual([60, 64, 67]);
  });
});

describe("transform", () => {
  const transforms: Transform[] = ["P", "L", "R"];

  it("is an involution — applying twice returns to the start", () => {
    const starts: Cursor[] = [
      C(0, 0, "up"), C(0, 0, "down"), C(2, -1, "up"), C(-1, 3, "down"),
    ];
    for (const s of starts) {
      for (const t of transforms) {
        expect(transform(transform(s, t), t)).toEqual(s);
      }
    }
  });

  it("P from up (0,0) → C minor {0,3,7}", () => {
    expect(pcsSet(transform(origin, "P"))).toEqual(new Set([0, 3, 7]));
  });

  it("L from up (0,0) → E minor {4,7,11}", () => {
    expect(pcsSet(transform(origin, "L"))).toEqual(new Set([4, 7, 11]));
  });

  it("R from up (0,0) → A minor {0,4,9}", () => {
    expect(pcsSet(transform(origin, "R"))).toEqual(new Set([0, 4, 9]));
  });

  it("each transform preserves exactly two pitch classes", () => {
    for (const t of transforms) {
      const before = pcsSet(origin);
      const after  = pcsSet(transform(origin, t));
      const common = [...before].filter(p => after.has(p));
      expect(common).toHaveLength(2);
    }
  });
});

describe("translate", () => {
  const cases: Array<[LatticeStep, number]> = [
    ["fifthUp",      7],
    ["fifthDown",    5], // -7 ≡ 5 mod 12
    ["majThirdUp",   4],
    ["majThirdDown", 8], // -4 ≡ 8 mod 12
    ["minThirdUp",   3],
    ["minThirdDown", 9], // -3 ≡ 9 mod 12
  ];

  for (const [step, delta] of cases) {
    it(`${step} shifts every pitch class by ${delta} mod 12`, () => {
      const before = triadPitchClasses(origin);
      const after  = triadPitchClasses(translate(origin, step));
      for (const role of ["root", "third", "fifth"] as const) {
        expect((after[role] - before[role] + 12) % 12).toBe(delta);
      }
    });
  }

  it("preserves orientation", () => {
    const steps: LatticeStep[] = ["fifthUp", "majThirdDown", "minThirdUp"];
    for (const s of steps) {
      expect(translate(C(0, 0, "up"),   s).orient).toBe("up");
      expect(translate(C(0, 0, "down"), s).orient).toBe("down");
    }
  });
});
