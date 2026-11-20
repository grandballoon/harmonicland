import { describe, it, expect, beforeEach } from "vitest";
import { mountRecordingRow, type RecordingRow, type RecordingRowElements } from "./recording-row";
import { memoryAlignmentStore, type AlignmentStore } from "./alignment-store";
import { Core } from "./core";
import type { Recording } from "./outputs/recording";
import type { Output, Score } from "./types";

/* The row against a recording that is a position and a list of what it
   was told, and a clock that is a variable: what it offers, what it shows,
   what it remembers, and what a run of taps makes of the score. */
const score = Core.makeScore(
  Array.from({ length: 16 }, (_, i) => ({ pitch: 60, onset: i * 0.5, duration: 0.5 })),
  [0, 2, 4, 6, 8],
);
const live = { liveOn() {}, liveOff() {}, detach() {} } as unknown as Output;

let pos: number;
let told: string[];
const recording = (key = "rec:a"): Recording => ({
  key,
  duration: 60,
  position: () => pos,
  play(from) {
    pos = from;
    told.push(`play ${from}`);
  },
  pause: () => void told.push("pause"),
  close: () => void told.push("close"),
});

let store: AlignmentStore;
let now: number;
let offered: ({ name: string; output: Output } | null)[];
let shown: Score[];
let status: string;
let opens: (file: File) => Promise<Recording>;
let el: RecordingRowElements;
let row: RecordingRow;

const settle = () => new Promise((r) => setTimeout(r, 0));
const choose = async (name = "prelude.mp3") => {
  Object.defineProperty(el.file, "files", { value: [new File(["x"], name)], configurable: true });
  el.file.dispatchEvent(new Event("change"));
  await settle();
};
/** The recording has reached `at`, and a barline is tapped there. */
const tapAt = (at: number) => {
  pos = at;
  row.tap();
};

beforeEach(() => {
  pos = 0;
  told = [];
  store = memoryAlignmentStore();
  now = 0;
  offered = [];
  shown = [];
  status = "";
  opens = async () => recording();
  el = {
    file: Object.assign(document.createElement("input"), { type: "file" }),
    name: document.createElement("span"),
    tap: document.createElement("button"),
    clear: document.createElement("button"),
    remove: document.createElement("button"),
    readout: document.createElement("span"),
  };
  row = mountRecordingRow(el, {
    store,
    open: (f) => opens(f),
    clock: { now: () => now, isPlaying: () => false },
    live,
    offer: (c) => void offered.push(c),
    show: (s) => void shown.push(s),
    park: (t) => void (now = t),
    status: (t) => void (status = t),
  });
  row.setScore("file:a", score);
});

describe("attaching a recording", () => {
  it("has nothing to tap or clear until there is one", () => {
    expect(el.tap.disabled).toBe(true);
    expect(el.clear.disabled).toBe(true);
    expect(el.remove.hidden).toBe(true);
  });

  it("offers it to be sounded, by the file's name", async () => {
    await choose("prelude.mp3");
    expect(offered.map((c) => c?.name)).toEqual(["prelude.mp3"]);
    expect(el.name.textContent).toBe("prelude.mp3");
    expect(el.tap.disabled).toBe(false);
    expect(el.remove.hidden).toBe(false);
  });

  it("leaves the score as written while no barlines are placed", async () => {
    await choose();
    expect(shown).toEqual([]);
    expect(el.readout.textContent).toContain("no barlines placed");
    expect(el.clear.disabled).toBe(true);
  });

  it("retimes the score at once when this recording's barlines are remembered", async () => {
    store.save("file:a", "rec:a", [{ bar: 0, at: 5 }, { bar: 4, at: 21 }]);
    await choose();
    expect(shown.length).toBe(1);
    expect(shown[0].duration).toBe(16);
    expect(el.readout.textContent).toBe("2 of 5 barlines placed");
  });

  it("does not borrow another recording's barlines", async () => {
    store.save("file:a", "rec:other", [{ bar: 0, at: 5 }]);
    await choose();
    expect(shown).toEqual([]);
  });

  it("says so when the file cannot be played, and offers nothing", async () => {
    opens = async () => { throw new Error("this browser can't play it"); };
    await choose("notes.txt");
    expect(status).toBe("Couldn't open notes.txt: this browser can't play it");
    expect(offered).toEqual([]);
  });

  it("replaces the one before it", async () => {
    await choose("one.mp3");
    opens = async () => recording("rec:b");
    await choose("two.mp3");
    expect(offered.map((c) => c?.name ?? null)).toEqual(["one.mp3", null, "two.mp3"]);
    expect(told).toContain("close");
  });

  it("drops a file that arrives after the score has changed", async () => {
    let arrive: (r: Recording) => void = () => {};
    opens = () => new Promise((r) => { arrive = r; });
    void choose();
    await settle();
    row.setScore("file:b", score);
    arrive(recording());
    await settle();
    expect(offered).toEqual([]);
    expect(told).toEqual(["close"]);
  });
});

describe("a new score", () => {
  it("lets go of the last one's recording without showing anything", async () => {
    store.save("file:a", "rec:a", [{ bar: 0, at: 5 }]);
    await choose();
    shown = [];
    row.setScore("file:b", score);
    expect(offered[offered.length - 1]).toBe(null);
    expect(told).toContain("close");
    expect(shown).toEqual([]);
    expect(el.tap.disabled).toBe(true);
  });
});

describe("tapping barlines", () => {
  beforeEach(() => choose());

  it("plays the recording from the top when nothing is placed", () => {
    el.tap.click();
    expect(row.tapping()).toBe(true);
    expect(told).toEqual(["play 0"]);
    expect(el.tap.textContent).toBe("Done");
    expect(el.readout.textContent).toBe("tap as bar 1 begins");
  });

  it("places a barline per tap and retimes the score when done", () => {
    el.tap.click();
    [5, 6, 10].forEach(tapAt);
    row.finish();
    expect(row.tapping()).toBe(false);
    expect(store.load("file:a", "rec:a")).toEqual([{ bar: 0, at: 5 }, { bar: 1, at: 6 }, { bar: 2, at: 10 }]);
    expect(shown[shown.length - 1].bars.map((b) => b.start)).toEqual([0, 1, 5, 9]);
    expect(told[told.length - 1]).toBe("pause");
    expect(status).toBe("Placed 3 barlines from bar 1 · Play to check them");
  });

  it("shows nothing new until the tapping is done", () => {
    el.tap.click();
    [5, 6, 10].forEach(tapAt);
    expect(shown).toEqual([]);
  });

  it("parks the playhead on each bar as it is tapped in", () => {
    el.tap.click();
    tapAt(5);
    expect(now).toBe(0);
    tapAt(6);
    expect(now).toBe(2);
    tapAt(10);
    expect(now).toBe(4);
  });

  it("returns the playhead to where the tapping began", () => {
    el.tap.click();
    [5, 6, 10].forEach(tapAt);
    row.finish();
    expect(now).toBe(0);
  });

  it("takes two taps in a blink as one", () => {
    el.tap.click();
    tapAt(5);
    tapAt(5.05);
    row.finish();
    expect(store.load("file:a", "rec:a")).toEqual([{ bar: 0, at: 5 }]);
  });

  it("ends by itself on the barline that closes the piece", () => {
    el.tap.click();
    [1, 3, 5, 7, 9].forEach(tapAt);
    expect(row.tapping()).toBe(false);
    expect(store.load("file:a", "rec:a").length).toBe(5);
    expect(shown[shown.length - 1].duration).toBe(8);
  });

  it("keeps what was there when nothing is tapped", () => {
    el.tap.click();
    el.tap.click();
    expect(row.tapping()).toBe(false);
    expect(shown).toEqual([]);
    expect(status).toBe("No barlines tapped");
  });

  it("starts from the bar under the playhead, a little before it in the recording", () => {
    el.tap.click();
    [5, 6, 10, 12, 14].forEach(tapAt);
    // the retimed bar 3 begins 5s into the score, 10s into the recording
    now = 5.5;
    told = [];
    el.tap.click();
    expect(told).toEqual(["play 7"]);
    expect(now).toBe(5);
    expect(el.readout.textContent).toBe("tap as bar 3 begins");
  });

  it("replaces the barlines it passes and keeps the rest", () => {
    el.tap.click();
    [5, 6, 10, 12, 14].forEach(tapAt);
    now = 5.5;
    el.tap.click();
    tapAt(10.4);
    row.finish();
    expect(store.load("file:a", "rec:a").map((a) => a.at)).toEqual([5, 6, 10.4, 12, 14]);
  });

  it("cannot be cleared or removed from under the hand tapping", () => {
    el.tap.click();
    expect(el.clear.disabled).toBe(true);
    expect(el.remove.disabled).toBe(true);
  });
});

describe("clearing and removing", () => {
  beforeEach(async () => {
    store.save("file:a", "rec:a", [{ bar: 0, at: 5 }, { bar: 4, at: 21 }]);
    await choose();
  });

  it("Clear forgets the barlines and shows the score as written", () => {
    el.clear.click();
    expect(store.load("file:a", "rec:a")).toEqual([]);
    expect(shown[shown.length - 1]).toBe(score);
    expect(offered[offered.length - 1]?.name).toBe("prelude.mp3");
  });

  it("Remove withdraws the recording, keeps its barlines, and shows the score as written", () => {
    el.remove.click();
    expect(offered[offered.length - 1]).toBe(null);
    expect(shown[shown.length - 1]).toBe(score);
    expect(store.load("file:a", "rec:a").length).toBe(2);
    expect(el.name.textContent).toBe("");
    expect(status).toBe("Removed prelude.mp3");
  });
});
