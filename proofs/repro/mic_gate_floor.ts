// FAILS_floor_ge_min_with_negative_rise (proofs/Harmonicland/Mic.lean).
// Claim (src/mic/gate.ts:36-38): "clamp so the floor stays a number" — the floor never goes
// below FLOOR_MIN_DB (-100). Holds only for riseDbPerSecond >= 0; GateOptions is any numbers.
// The app only ever uses DEFAULT_GATE (transcriber.ts:45), where it is 0.5.
import { DEFAULT_GATE, NoiseGate } from "/Users/lukesovernconley/Code/harmonicland/src/mic/gate";
for (const riseDbPerSecond of [DEFAULT_GATE.riseDbPerSecond, -10]) {
  const g = new NoiseGate({ ...DEFAULT_GATE, riseDbPerSecond });
  const floors: number[] = [];
  for (let i = 0; i < 3; i++) { g.frame(-Infinity); floors.push(g.floorDb); }
  console.log(`riseDbPerSecond ${riseDbPerSecond}: floor after 1, 2, 3 frames of digital silence:`, floors.join(", "), " (claim: never below -100)");
}
