/**
 * Runs plugin.js against a fake Penpot API.
 *
 * Covers the slot insertion paths that used to be blocked: swapping a copy that
 * is already in the slot, appending a fresh instance, and the canvas fallback
 * when Penpot still refuses a nested copy.
 *
 * Usage: node test/mock-run.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "plugin.js"), "utf8");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

// ---------------------------------------------------------------- fixtures

function makeShape({ id, name, type = "board", copy = false, children = [], appendFails = false }) {
  const shape = {
    id,
    name,
    type,
    x: 100,
    y: 200,
    width: 50,
    height: 50,
    children,
    removed: false,
    appended: [],
    swappedTo: null,
    isComponentCopyInstance: () => copy,
    remove() {
      this.removed = true;
    },
    swapComponent(component) {
      this.swappedTo = component.id;
    },
    appendChild(child) {
      if (appendFails) throw new Error(":nested-copy-not-allowed");
      this.appended.push(child);
      this.children.push(child);
    },
  };
  return shape;
}

/** Builds a fresh Penpot mock and evaluates plugin.js against it. */
function world({ slotChildren = [], appendFails = false, selection = null } = {}) {
  const sent = [];
  const undoBlocks = [];
  const created = [];

  const slot = makeShape({ id: "slot-1", name: "[slot] content", children: slotChildren, appendFails });
  const root = makeShape({ id: "root", name: "Card", children: [slot] });

  const component = {
    id: "c-1",
    name: "Button",
    path: "Actions",
    instance() {
      const instance = makeShape({ id: `i-${created.length + 1}`, name: "Button", type: "group", copy: true });
      created.push(instance);
      return instance;
    },
  };

  let onMessage = () => {};

  globalThis.penpot = {
    theme: "dark",
    selection: selection ? [selection] : [root],
    currentPage: { getShapeById: (id) => (id === root.id ? root : null) },
    library: { local: { components: [component] } },
    history: {
      undoBlockBegin() {
        const id = Symbol("block");
        undoBlocks.push({ id, open: true });
        return id;
      },
      undoBlockFinish(id) {
        const block = undoBlocks.find((entry) => entry.id === id);
        if (block) block.open = false;
      },
    },
    on: () => {},
    ui: {
      open: () => {},
      sendMessage: (message) => sent.push(message),
      onMessage: (callback) => { onMessage = callback; },
    },
  };

  new Function(source)();

  return {
    slot,
    root,
    component,
    created,
    undoBlocks,
    sent,
    send: (message) => onMessage(message),
    last: (type) => [...sent].reverse().find((message) => message.type === type),
  };
}

const replace = { type: "replace-in-slot", parentId: "root", slotId: "slot-1", componentId: "c-1" };

// ------------------------------------------------------------------- run

console.log("\nreplace with a copy already in the slot");
{
  const existing = makeShape({ id: "old", name: "Old button", type: "group", copy: true });
  const w = world({ slotChildren: [existing] });
  w.send(replace);
  const result = w.last("replaced");

  check("swaps in place instead of removing", () => {
    assert.equal(existing.swappedTo, "c-1");
    assert.equal(existing.removed, false);
  });
  check("reports the swap path", () => assert.equal(result.method, "swap"));
  check("is not a fallback", () => assert.ok(!result.fallback));
  check("creates no throwaway instance", () => assert.equal(w.created.length, 0));
  check("uses one undo block", () => {
    assert.equal(w.undoBlocks.length, 1);
    assert.equal(w.undoBlocks[0].open, false);
  });
}

console.log("\nreplace with plain content in the slot");
{
  const existing = makeShape({ id: "rect", name: "Placeholder", type: "rect" });
  const w = world({ slotChildren: [existing] });
  w.send(replace);
  const result = w.last("replaced");

  check("clears the old content", () => assert.equal(existing.removed, true));
  check("appends the new instance into the slot", () => {
    assert.equal(w.slot.appended.length, 1);
    assert.equal(w.slot.appended[0].id, w.created[0].id);
  });
  check("positions the instance on the slot", () => {
    assert.equal(w.created[0].x, w.slot.x);
    assert.equal(w.created[0].y, w.slot.y);
  });
  check("reports the append path", () => assert.equal(result.method, "append"));
  check("removal and insert share one undo block", () => assert.equal(w.undoBlocks.length, 1));
}

console.log("\nreplace while Penpot still refuses a nested copy");
{
  const existing = makeShape({ id: "rect", name: "Placeholder", type: "rect" });
  const w = world({ slotChildren: [existing], appendFails: true });
  w.send(replace);
  const result = w.last("replaced");

  check("falls back to the canvas instead of throwing", () => {
    assert.equal(result.method, "canvas");
    assert.equal(result.fallback, true);
  });
  check("passes the Penpot error on for the UI to log", () => {
    assert.equal(result.reason, ":nested-copy-not-allowed");
  });
  check("selects the orphan so it can be dragged in", () => {
    assert.equal(globalThis.penpot.selection[0].id, w.created[0].id);
  });
  check("still reports no error toast", () => assert.equal(w.last("error"), undefined));
}

console.log("\nplace into an empty slot");
{
  const w = world();
  w.send({ type: "place-component", componentId: "c-1", parentId: "root", slotId: "slot-1", slotX: 0, slotY: 0 });
  const result = w.last("placed");

  check("inserts straight into the slot", () => {
    assert.equal(w.slot.appended.length, 1);
    assert.equal(result.method, "append");
    assert.ok(!result.fallback);
  });
}

console.log("\nplace without a slot");
{
  const w = world();
  w.send({ type: "place-component", componentId: "c-1", slotX: 40, slotY: 60 });
  const result = w.last("placed");

  check("lands on the canvas at the given position", () => {
    assert.equal(result.method, "canvas");
    assert.equal(w.created[0].x, 40);
    assert.equal(w.created[0].y, 60);
  });
}

console.log("\nselection info");
{
  const copy = makeShape({ id: "copy", name: "Card", copy: true, children: [] });
  const w = world({ selection: copy });
  w.send({ type: "ready" });
  check("a copy instance is read-only", () => assert.equal(w.last("selection").data.isInstance, true));
}
{
  const w = world();
  w.send({ type: "ready" });
  check("a main component is editable", () => assert.equal(w.last("selection").data.isInstance, false));
  check("its slot is found", () => assert.equal(w.last("selection").data.slots.length, 1));
}

console.log("\nclear slot");
{
  const existing = makeShape({ id: "old", name: "Old", type: "group" });
  const w = world({ slotChildren: [existing] });
  w.send({ type: "clear-slot", parentId: "root", slotId: "slot-1" });
  check("empties the slot in one undo block", () => {
    assert.equal(existing.removed, true);
    assert.equal(w.undoBlocks.length, 1);
    assert.equal(w.undoBlocks[0].open, false);
  });
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
