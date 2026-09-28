import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountChainBar, type ChainBar } from "./backchain-bar";

/* Driven against index.html's own #chain markup, so a renamed class in the
   page fails here rather than silently in the app. */
const page = readFileSync(join(__dirname, "..", "index.html"), "utf8");

let root: HTMLElement;
let calls: string[];
let bar: ChainBar;

const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
const toggle = () => q<HTMLButtonElement>(".chain-toggle");
const walk = () => q<HTMLSpanElement>(".chain-walk");
const box = () => q<HTMLInputElement>(".chain-at");

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").getElementById("chain")!.outerHTML;
  root = document.getElementById("chain")!;
  calls = [];
  bar = mountChainBar(root, {
    onStart: () => calls.push("start"),
    onStop: () => calls.push("stop"),
    onGo: (at) => calls.push(`go ${at}`),
  });
});

describe("the backchain bar", () => {
  it("is off, and dead until there is a score", () => {
    expect(toggle().disabled).toBe(true);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(walk().hidden).toBe(true);
    bar.setEnabled(true);
    expect(toggle().disabled).toBe(false);
  });

  it("starts a chain, and stops the one running", () => {
    bar.setEnabled(true);
    toggle().click();
    bar.show({ at: 0, count: 5 });
    toggle().click();
    expect(calls).toEqual(["start", "stop"]);
  });

  it("shows which link is looping, counted from 1", () => {
    bar.show({ at: 2, count: 5 });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(walk().hidden).toBe(false);
    expect(box().value).toBe("3");
    expect(box().max).toBe("5");
    expect(q(".chain-of").textContent).toBe("5");
    bar.show(null);
    expect(walk().hidden).toBe(true);
  });

  it("adds the note before with ↑, and drops the first with ↓", () => {
    bar.show({ at: 2, count: 5 });
    q<HTMLButtonElement>(".chain-longer").click();
    q<HTMLButtonElement>(".chain-shorter").click();
    expect(calls).toEqual(["go 3", "go 1"]);
  });

  it("goes no shorter than the last note, and no longer than the whole", () => {
    bar.show({ at: 0, count: 3 });
    expect(q<HTMLButtonElement>(".chain-shorter").disabled).toBe(true);
    expect(q<HTMLButtonElement>(".chain-longer").disabled).toBe(false);
    bar.show({ at: 2, count: 3 });
    expect(q<HTMLButtonElement>(".chain-longer").disabled).toBe(true);
  });

  it("jumps to a link typed in, and puts back what is looping when it is not a number", () => {
    bar.show({ at: 1, count: 5 });
    box().value = "4";
    box().dispatchEvent(new Event("change"));
    box().value = "";
    box().dispatchEvent(new Event("change"));
    expect(calls).toEqual(["go 3"]);
    expect(box().value).toBe("2");
  });
});
