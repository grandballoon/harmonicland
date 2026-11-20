import { describe, it, expect, beforeEach } from "vitest";
import { mountSoundRow, type MidiPorts, type SoundRow } from "./sound-row";
import type { Output } from "./types";

/* The picker against fake ports and an in-memory Storage: which output it
   hands over, what it remembers, and how it follows ports coming and going. */
const out = (name: string): Output => ({
  strike() {}, advance() {}, pedal() {}, flush() {}, latency: () => 0, liveOn() {}, liveOff() {}, detach() {},
  toString: () => name,
} as Output);
const piano = out("piano");

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

let ports: MIDIOutput[] = [];
let granted = false;
let portsChanged: (() => void) | null = null;
const outputs = new Map<string, Output>();
const midi: MidiPorts = {
  open: async () => {},
  permitted: async () => granted,
  ports: () => ports,
  onPorts: (fn) => { portsChanged = fn; return () => {}; },
  output: (p) => {
    if (!outputs.has(p.id)) outputs.set(p.id, out(p.name!));
    return outputs.get(p.id)!;
  },
};
const port = (id: string, name: string) => ({ id, name, state: "connected" }) as unknown as MIDIOutput;

let storage: MemoryStorage;
let used: Output[];
let offset: number;
let status: string;
let shaped: boolean | null;
let el: { select: HTMLSelectElement; slider: HTMLInputElement; readout: HTMLElement; hint: HTMLElement; shape: HTMLInputElement };

let row: SoundRow;
const mount = () => {
  el = {
    select: document.createElement("select"),
    slider: Object.assign(document.createElement("input"), { type: "range", min: "0", max: "300", step: "5" }),
    readout: document.createElement("output"),
    hint: document.createElement("p"),
    shape: Object.assign(document.createElement("input"), { type: "checkbox" }),
  };
  row = mountSoundRow(el, {
    piano, midi, use: (o) => void used.push(o), setOffset: (s) => void (offset = s),
    setShape: (on) => void (shaped = on),
    status: (t) => void (status = t), storage: () => storage as unknown as Storage,
  });
};
const choose = async (value: string) => {
  el.select.value = value;
  el.select.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
};
const options = () => [...el.select.options].map((o) => o.text);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ports = [];
  granted = false;
  portsChanged = null;
  outputs.clear();
  storage = new MemoryStorage();
  used = [];
  offset = -1;
  status = "";
  shaped = null;
});

describe("sound row", () => {
  it("offers the piano, and MIDI behind a choice that asks for it", () => {
    mount();
    expect(options()).toEqual(["Built-in piano", "MIDI device…"]);
    expect(el.select.value).toBe("piano");
    expect(el.hint.hidden).toBe(true);
    expect(offset).toBe(0);
  });

  it("choosing MIDI connects, lists the ports, and plays through the first", async () => {
    ports = [port("a", "IAC Driver Bus 1"), port("b", "Digital Piano")];
    mount();
    await choose("connect");
    expect(options()).toEqual(["Built-in piano", "IAC Driver Bus 1", "Digital Piano"]);
    expect(used.map(String)).toEqual(["IAC Driver Bus 1"]);
    expect(el.select.value).toBe("port:a");
    expect(el.hint.hidden).toBe(false); // the GarageBand note, while on MIDI
    expect(status).toBe("Sound · IAC Driver Bus 1");
  });

  it("says so when there are no ports, and stays on the piano", async () => {
    mount();
    await choose("connect");
    expect(used).toEqual([]);
    expect(el.select.value).toBe("piano");
    expect(el.hint.hidden).toBe(false);
    expect(status).toMatch(/No MIDI outputs/);
  });

  it("keeps a delay per output, and applies the one in use", async () => {
    ports = [port("a", "IAC")];
    mount();
    el.slider.value = "40";
    el.slider.dispatchEvent(new Event("input"));
    expect(offset).toBeCloseTo(0.04, 9);
    await choose("connect");
    expect(offset).toBe(0); // the synth has its own, not yet set
    el.slider.value = "120";
    el.slider.dispatchEvent(new Event("input"));
    expect(el.readout.textContent).toBe("120 ms");
    await choose("piano");
    expect(offset).toBeCloseTo(0.04, 9);
    expect(el.slider.value).toBe("40");
  });

  it("falls back to the piano when the port goes, and takes it back when it returns", async () => {
    ports = [port("a", "IAC")];
    mount();
    await choose("connect");
    ports = [];
    portsChanged!();
    expect(used.at(-1)).toBe(piano);
    expect(status).toMatch(/IAC disconnected/);
    ports = [port("a2", "IAC")]; // back, under a new id
    portsChanged!();
    expect(String(used.at(-1))).toBe("IAC");
  });

  it("restores a remembered synth on the next visit when MIDI is already allowed", async () => {
    ports = [port("a", "IAC")];
    mount();
    await choose("connect");
    used = [];
    granted = true;
    mount(); // a new visit, same storage
    await flush();
    expect(used.map(String)).toEqual(["IAC"]);
  });

  it("never asks for MIDI on a visit that has not been granted it", async () => {
    ports = [port("a", "IAC")];
    mount();
    await choose("connect");
    used = [];
    granted = false;
    mount();
    await flush();
    expect(used).toEqual([]);
    expect(el.select.value).toBe("piano");
  });

  it("shapes plain scores unless told not to, and remembers", () => {
    mount();
    expect(shaped).toBe(true);
    expect(el.shape.checked).toBe(true);
    el.shape.checked = false;
    el.shape.dispatchEvent(new Event("change"));
    expect(shaped).toBe(false);
    mount(); // a new visit
    expect(shaped).toBe(false);
    expect(el.shape.checked).toBe(false);
  });

  it("offers a recording when there is one, and plays through it", () => {
    mount();
    const take = out("take");
    row.setRecording({ name: "prelude.mp3", output: take });
    expect(options()).toEqual(["Built-in piano", "Recording · prelude.mp3", "MIDI device…"]);
    expect(el.select.value).toBe("recording");
    expect(used).toEqual([take]);
  });

  it("goes back to what was chosen before when the recording is withdrawn", async () => {
    ports = [port("a", "IAC Bus 1")];
    mount();
    await choose("connect");
    row.setRecording({ name: "prelude.mp3", output: out("take") });
    row.setRecording(null);
    expect(options()).toEqual(["Built-in piano", "IAC Bus 1"]);
    expect(used[used.length - 1]).toBe(outputs.get("a"));
  });

  it("can be left for the piano and come back to while it is on offer", async () => {
    mount();
    const take = out("take");
    row.setRecording({ name: "prelude.mp3", output: take });
    await choose("piano");
    await choose("recording");
    expect(used).toEqual([take, piano, take]);
    expect(status).toBe("Sound · prelude.mp3");
  });

  it("keeps a delay of the recording's own, and does not remember choosing it", async () => {
    mount();
    row.setRecording({ name: "prelude.mp3", output: out("take") });
    el.slider.value = "120";
    el.slider.dispatchEvent(new Event("input"));
    expect(offset).toBeCloseTo(0.12);
    await choose("piano");
    expect(offset).toBe(0);
    mount(); // the next visit: the file is gone
    expect(el.select.value).toBe("piano");
    row.setRecording({ name: "prelude.mp3", output: out("take") });
    expect(offset).toBeCloseTo(0.12);
  });

  it("plays through a second recording that replaces the first", () => {
    mount();
    const one = out("one");
    const two = out("two");
    row.setRecording({ name: "one.mp3", output: one });
    row.setRecording({ name: "two.mp3", output: two });
    expect(used).toEqual([one, two]);
    expect(options()).toContain("Recording · two.mp3");
  });
});
