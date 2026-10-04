// FAILS_trackerOptions_default_confirm (proofs/Harmonicland/Mic.lean).
// Claim (src/mic/settings.ts:58-59): "Sensitivity moves the two strike thresholds together,
// around the defaults at 0.5."
import { DEFAULT_TRACKER } from "/Users/lukesovernconley/Code/harmonicland/src/mic/note-tracker";
import { DEFAULT_SETTINGS, trackerOptions } from "/Users/lukesovernconley/Code/harmonicland/src/mic/settings";
const o = trackerOptions(DEFAULT_SETTINGS.sensitivity);
console.log("DEFAULT_SETTINGS.sensitivity =", DEFAULT_SETTINGS.sensitivity);
console.log("onsetThreshold   : trackerOptions ->", o.onsetThreshold, " DEFAULT_TRACKER ->", DEFAULT_TRACKER.onsetThreshold);
console.log("confirmThreshold : trackerOptions ->", o.confirmThreshold, " DEFAULT_TRACKER ->", DEFAULT_TRACKER.confirmThreshold);
console.log("  claim : both equal the defaults at sensitivity 0.5");
console.log("  actual: confirmThreshold", Math.abs(o.confirmThreshold - DEFAULT_TRACKER.confirmThreshold) < 1e-9 ? "equal" : "DIFFERS");
