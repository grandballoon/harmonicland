// Repro for Pitch.lean: FAILS_spanOf_clamped_above, FAILS_spanOf_clamped_below.
// Claim (src/pitch.ts:92-95): spanOf returns "the span that holds every key
// from `lo` to `hi` ... clamped to the 88"; KeySpan (pitch.ts:74) is "every key
// from `lo` to `hi`, inclusive".
import { spanOf, whitesIn, LOW, HIGH } from "/Users/lukesovernconley/Code/harmonicland/src/pitch";

const show = (lo: number, hi: number, pad: number): void => {
  const s = spanOf(lo, hi, pad);
  console.log(`spanOf(${lo}, ${hi}, ${pad}) =`, JSON.stringify(s),
    `| whitesIn(...).length = ${whitesIn(s).length}`);
  console.log(`   claim: ${LOW} <= lo <= hi <= ${HIGH}.  actual: lo<=hi is ${s.lo <= s.hi},`,
    `lo<=${HIGH} is ${s.lo <= HIGH}, hi>=${LOW} is ${s.hi >= LOW}`);
};

console.log("-- wholly above C8 (pitch 120 = C9, a legal MIDI note) --");
show(120, 120, 3);
show(120, 120, 0);
console.log("-- wholly below A0 (pitch 10, a legal MIDI note) --");
show(10, 10, 3);
console.log("-- control: inside the 88 --");
show(61, 66, 3);

// The real caller: isolated-keys.ts:67 passes the lowest/highest SCORE pitch.
// These imports may fail outside a browser; reported if so.
try {
  const { Core } = await import("/Users/lukesovernconley/Code/harmonicland/src/core");
  const { focusOf, placement } = await import("/Users/lukesovernconley/Code/harmonicland/src/outputs/isolated-keys");
  for (const pitch of [120, 10]) {
    const score = Core.makeScore([{ pitch, onset: 0, duration: 1 }]);
    const f = focusOf(score, null);
    console.log(`-- caller: focusOf(score with one note at pitch ${pitch}) =`, JSON.stringify(f));
    console.log("   placement(1200, 600, shown) =", JSON.stringify(placement(1200, 600, f!.shown)),
      "(a keyboard region; expected finite positive w and h)");
    const r = placement(1200, 600, f!.shown)!;
    console.log(`   raw: w=${r.w} h=${r.h} y=${r.y}`);
  }
} catch (e) {
  console.log("caller modules did not load under vite-node:", String(e));
}
