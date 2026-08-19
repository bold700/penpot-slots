// plugin.js — runs inside Penpot sandbox

penpot.ui.open('Slots', `?theme=${penpot.theme}`, {
  width: 320,
  height: 560,
});

function findSlots(shape) {
  const slots = [];
  if (!shape) return slots;
  function walk(node) {
    if ((node.type === 'frame' || node.type === 'board') && node.name.startsWith('[slot]')) {
      slots.push({ id: node.id, name: node.name, x: node.x, y: node.y, width: node.width, height: node.height });
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(shape);
  return slots;
}

function findNode(node, id) {
  if (node.id === id) return node;
  if (node.children) {
    for (const c of node.children) {
      const f = findNode(c, id);
      if (f) return f;
    }
  }
  return null;
}

function isCopyInstance(shape) {
  try {
    return typeof shape.isComponentCopyInstance === 'function' && shape.isComponentCopyInstance();
  } catch (e) {
    return false;
  }
}

// Groups everything the callback does into one undo step.
function withUndo(fn) {
  const history = penpot.history;
  if (!history || typeof history.undoBlockBegin !== 'function') return fn();
  const block = history.undoBlockBegin();
  try {
    return fn();
  } finally {
    history.undoBlockFinish(block);
  }
}

// Puts a fresh instance of `component` inside `slot`.
// Penpot rejected appendChild for component copies with :nested-copy-not-allowed
// up to 2.14.x. If that still happens the instance is left on the canvas at the
// slot position, which is what this plugin used to do unconditionally.
function insertIntoSlot(slot, component) {
  const instance = component.instance();
  try {
    slot.appendChild(instance);
    instance.x = slot.x;
    instance.y = slot.y;
    return { method: 'append' };
  } catch (e) {
    instance.x = slot.x;
    instance.y = slot.y;
    penpot.selection = [instance];
    return { method: 'canvas', reason: e.message };
  }
}

function getSlotChildren(shape, slotId) {
  const slot = findNode(shape, slotId);
  if (!slot) return [];
  return (slot.children || []).map(c => ({ id: c.id, name: c.name, type: c.type }));
}

function getSelectionInfo() {
  const selection = penpot.selection;
  if (!selection || selection.length === 0) return { type: 'empty' };
  if (selection.length > 1) return { type: 'multi' };

  const shape = selection[0];
  const slots = findSlots(shape);

  // `mainComponent` is not part of the Plugin API, so this used to be false for
  // every shape. A copy instance is the one thing that is read-only here.
  const isInstance = isCopyInstance(shape);

  return {
    type: 'single',
    id: shape.id,
    name: shape.name,
    shapeType: shape.type,
    isInstance,
    slots,
  };
}

function getLocalComponents() {
  try {
    const groups = {};
    for (const c of penpot.library.local.components) {
      const group = c.path || 'Components';
      if (!groups[group]) groups[group] = [];
      groups[group].push({ id: c.id, name: c.name, path: c.path || '' });
    }
    return groups;
  } catch (e) {
    return {};
  }
}

penpot.ui.onMessage(msg => {

  if (msg.type === 'ready' || msg.type === 'refresh') {
    penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
  }

  if (msg.type === 'get-components') {
    const groups = getLocalComponents();
    penpot.ui.sendMessage({ type: 'components', groups });
  }

  if (msg.type === 'mark-slot') {
    const selection = penpot.selection;
    if (!selection || selection.length === 0) return;
    const shape = selection[0];
    if (shape.type !== 'frame' && shape.type !== 'board') {
      penpot.ui.sendMessage({ type: 'error', message: 'Select a frame to mark as slot.' });
      return;
    }
    shape.name = shape.name.startsWith('[slot]') ? shape.name : `[slot] ${shape.name}`;
    penpot.ui.sendMessage({ type: 'marked', name: shape.name });
    penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
  }

  if (msg.type === 'unmark-slot') {
    const selection = penpot.selection;
    if (!selection || selection.length === 0) return;
    selection[0].name = selection[0].name.replace(/^\[slot\]\s*/, '');
    penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
  }

  if (msg.type === 'get-slot-children') {
    const { parentId, slotId } = msg;
    const parent = penpot.currentPage.getShapeById(parentId);
    if (!parent) return;
    penpot.ui.sendMessage({ type: 'slot-children', slotId, children: getSlotChildren(parent, slotId) });
  }

  if (msg.type === 'replace-in-slot') {
    const { parentId, slotId, componentId } = msg;
    const parent = penpot.currentPage.getShapeById(parentId);
    if (!parent) { penpot.ui.sendMessage({ type: 'error', message: 'Parent niet gevonden.' }); return; }

    const slot = findNode(parent, slotId);
    if (!slot) { penpot.ui.sendMessage({ type: 'error', message: 'Slot niet gevonden.' }); return; }

    const component = penpot.library.local.components.find(c => c.id === componentId);
    if (!component) { penpot.ui.sendMessage({ type: 'error', message: 'Component niet gevonden.' }); return; }

    try {
      const children = slot.children || [];
      const target = children.find(isCopyInstance);

      // Preferred path: swap the copy that is already in the slot, so it never
      // leaves the slot and Penpot keeps the overrides it can keep.
      if (target && typeof target.swapComponent === 'function') {
        withUndo(() => target.swapComponent(component));
        penpot.ui.sendMessage({ type: 'replaced', slotId, method: 'swap', name: component.name });
        penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
        return;
      }

      // Nothing swappable in there: clear it out and insert a new instance.
      const result = withUndo(() => {
        for (const child of [...children]) child.remove();
        return insertIntoSlot(slot, component);
      });

      penpot.ui.sendMessage({
        type: 'replaced',
        slotId,
        method: result.method,
        fallback: result.method === 'canvas',
        name: component.name,
        reason: result.reason,
      });
      penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
    } catch (e) {
      penpot.ui.sendMessage({ type: 'error', message: 'Vervangen mislukt: ' + e.message });
    }
  }

  if (msg.type === 'debug-api') {
    const page = penpot.currentPage;

    // Check own properties (where Penpot actually puts its methods)
    const pageKeys = Object.getOwnPropertyNames(page);
    const pageMethods = pageKeys.filter(k => typeof page[k] === 'function');
    const pageProps = pageKeys.filter(k => typeof page[k] !== 'function');

    const comps = penpot.library.local.components;
    let compMethods = [], compProps = [], mainInstanceMethods = [], mainInstanceProps = [];
    if (comps.length > 0) {
      const c = comps[0];
      const cKeys = Object.getOwnPropertyNames(c);
      compMethods = cKeys.filter(k => typeof c[k] === 'function');
      compProps = cKeys.filter(k => typeof c[k] !== 'function');

      // mainInstance is a method on LibraryComponent, not a property.
      try {
        const mi = typeof c.mainInstance === 'function' ? c.mainInstance() : null;
        if (mi) {
          const miKeys = Object.getOwnPropertyNames(mi);
          mainInstanceMethods = miKeys.filter(k => typeof mi[k] === 'function');
          mainInstanceProps = miKeys.filter(k => typeof mi[k] !== 'function');
        }
      } catch (e) {
        mainInstanceMethods = ['<error: ' + e.message + '>'];
      }
    }

    const sel = penpot.selection && penpot.selection[0];
    const capabilities = {
      swapComponent: !!(sel && typeof sel.swapComponent === 'function'),
      isComponentCopyInstance: !!(sel && typeof sel.isComponentCopyInstance === 'function'),
      appendChild: !!(sel && typeof sel.appendChild === 'function'),
      undoBlocks: !!(penpot.history && typeof penpot.history.undoBlockBegin === 'function'),
    };

    penpot.ui.sendMessage({ type: 'debug-result', pageMethods, pageProps, compMethods, compProps, mainInstanceMethods, mainInstanceProps, capabilities });
  }

  if (msg.type === 'select-slot-content') {
    const { parentId, slotId } = msg;
    const parent = penpot.currentPage.getShapeById(parentId);
    if (!parent) return;
    const slot = findNode(parent, slotId);
    if (!slot) return;
    const children = slot.children || [];
    if (children.length === 0) {
      penpot.ui.sendMessage({ type: 'error', message: 'Slot is leeg.' });
      return;
    }
    penpot.selection = [...children];
    penpot.ui.sendMessage({ type: 'selected-content', count: children.length });
  }

  if (msg.type === 'place-component') {
    const { parentId, slotId, slotX, slotY, componentId } = msg;
    const component = penpot.library.local.components.find(c => c.id === componentId);
    if (!component) { penpot.ui.sendMessage({ type: 'error', message: 'Component niet gevonden.' }); return; }

    try {
      // With a slot in hand the instance goes straight into it. Without one
      // there is nothing to insert into, so it lands on the canvas.
      let slot = null;
      if (parentId && slotId) {
        const parent = penpot.currentPage.getShapeById(parentId);
        if (parent) slot = findNode(parent, slotId);
      }

      if (slot) {
        const result = withUndo(() => insertIntoSlot(slot, component));
        penpot.ui.sendMessage({
          type: 'placed',
          name: component.name,
          method: result.method,
          fallback: result.method === 'canvas',
          reason: result.reason,
        });
        penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
        return;
      }

      const instance = component.instance();
      instance.x = slotX || 0;
      instance.y = slotY || 0;
      penpot.selection = [instance];
      penpot.ui.sendMessage({ type: 'placed', name: component.name, method: 'canvas', fallback: true });
    } catch (e) {
      penpot.ui.sendMessage({ type: 'error', message: 'Plaatsen mislukt: ' + e.message });
    }
  }

  if (msg.type === 'clear-slot') {
    const { parentId, slotId } = msg;
    const parent = penpot.currentPage.getShapeById(parentId);
    if (!parent) return;
    const slot = findNode(parent, slotId);
    if (!slot || !slot.children) return;
    withUndo(() => {
      for (const child of [...slot.children]) child.remove();
    });
    penpot.ui.sendMessage({ type: 'cleared', slotId });
    penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
  }

});

penpot.on('selectionchange', () => {
  penpot.ui.sendMessage({ type: 'selection', data: getSelectionInfo() });
});
