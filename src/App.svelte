<script lang="ts">
  import { onMount } from 'svelte';
  import { AddObjectCommand, History, MovePathNodeCommand, ReplaceObjectsCommand, TransformObjectCommand } from './core/commands';
  import { createDocument, createEllipse, createRectangle, createTriangle, type PathNode, type ShpeshftDocument, type Transform, type VectorObject } from './core/document';
  import { unionRectangles } from './engine/boolean';
  import { createBenchmarkDocument, createNodeBenchmarkDocument, createPathBenchmarkDocument } from './engine/benchmark';
  import { hitTest, localBounds, localCenter, localToWorld, objectCenter, tracePath, worldToLocal } from './engine/geometry';
  import { fitWorkspace, zoomAt, zoomFromAnchor } from './engine/viewport';
  import { loadLatestProject, saveProject } from './storage/database';

  type Axis = 'both' | 'width' | 'height';
  type TransformDrag = { id: string; kind: 'move' | 'primary'; before: Transform; startWorldX: number; startWorldY: number; startDistance?: number; startAngle?: number; axis?: Axis };

  let canvas: HTMLCanvasElement;
  let document: ShpeshftDocument = createDocument();
  let selectedId: string | null = null;
  let selectedIds: string[] = [];
  let selectedNodeId: string | null = null;
  let editMode = false;
  let multiMode = false;
  let resizeAxis: Axis = 'both';
  let debugMode = false;
  let status = 'Ready';
  let view = { x: 0, y: 0, scale: .55 };
  let drag: TransformDrag | null = null;
  let nodeDrag: null | { objectId: string; nodeId: string; part: 'anchor' | 'in' | 'out'; before: PathNode } = null;
  let pan: null | { x: number; y: number; viewX: number; viewY: number } = null;
  let pinch: null | { distance: number; scale: number; anchorX: number; anchorY: number } = null;
  let frame = 0, saveTimer: number | undefined;
  let hasFittedView = false, viewWasAdjusted = false, renderMs = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  const history = new History();

  const execute = (command: AddObjectCommand | TransformObjectCommand | MovePathNodeCommand | ReplaceObjectsCommand) => {
    document = history.execute(document, command); scheduleSave(); draw();
  };

  function scheduleSave() {
    window.clearTimeout(saveTimer); const snapshot = document;
    saveTimer = window.setTimeout(async () => { await saveProject(snapshot); if (document.updatedAt === snapshot.updatedAt) status = 'Saved'; }, 350);
  }

  function clearSelection() { selectedId = null; selectedIds = []; selectedNodeId = null; editMode = false; multiMode = false; }
  function selectAdded(object: VectorObject) { selectedId = object.id; selectedIds = [object.id]; editMode = false; multiMode = false; draw(); }
  function addShape(kind: 'triangle' | 'rectangle' | 'ellipse') {
    const x = document.workspace.width / 2 - 90, y = document.workspace.height / 2 - 80;
    const object = kind === 'triangle' ? createTriangle(x, y) : kind === 'rectangle' ? createRectangle(x, y) : createEllipse(x + 90, y + 80);
    execute(new AddObjectCommand(object)); selectAdded(object); status = `${object.name} added`;
  }
  function undo() { document = history.undo(document); clearSelection(); scheduleSave(); draw(); }
  function redo() { document = history.redo(document); clearSelection(); scheduleSave(); draw(); }

  function updateSelected(mapper: (object: VectorObject) => VectorObject, label: string) {
    if (!selectedIds.length) return;
    const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]]));
    const after = Object.fromEntries(selectedIds.map((id) => [id, mapper(document.objects[id])]));
    execute(new ReplaceObjectsCommand(before, after, document.order, document.order)); status = label;
  }
  function setOpacity(value: number) { updateSelected((object) => ({ ...object, style: { ...object.style, opacity: value } }), `Opacity ${Math.round(value * 100)}%`); }
  function reorder(direction: -1 | 1) {
    if (!selectedId) return; const from = document.order.indexOf(selectedId), to = Math.max(0, Math.min(document.order.length - 1, from + direction)); if (from === to) return;
    const order = [...document.order]; order.splice(to, 0, order.splice(from, 1)[0]); execute(new ReplaceObjectsCommand({}, {}, document.order, order)); status = direction > 0 ? 'Moved forward' : 'Moved backward';
  }
  function duplicateSelection() {
    if (!selectedIds.length) return; const clones = selectedIds.map((id) => ({ ...structuredClone(document.objects[id]), id: crypto.randomUUID(), name: `${document.objects[id].name} copy`, transform: { ...document.objects[id].transform, x: document.objects[id].transform.x + 28, y: document.objects[id].transform.y + 28 } }));
    const after = Object.fromEntries(clones.map((object) => [object.id, object])); const order = [...document.order, ...clones.map((object) => object.id)];
    execute(new ReplaceObjectsCommand(Object.fromEntries(clones.map((object) => [object.id, null])), after, document.order, order)); selectedIds = clones.map((object) => object.id); selectedId = selectedIds.at(-1) ?? null; status = 'Duplicated'; draw();
  }
  function deleteSelection() {
    if (!selectedIds.length) return; const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); const after = Object.fromEntries(selectedIds.map((id) => [id, null]));
    execute(new ReplaceObjectsCommand(before, after, document.order, document.order.filter((id) => !selectedIds.includes(id)))); clearSelection(); status = 'Deleted'; draw();
  }
  function groupSelection() { if (selectedIds.length > 1) { const groupId = crypto.randomUUID(); updateSelected((object) => ({ ...object, parentId: groupId }), 'Grouped'); } }
  function ungroupSelection() { updateSelected((object) => ({ ...object, parentId: null }), 'Ungrouped'); }
  function unionSelection() {
    const result = unionRectangles(selectedIds.map((id) => document.objects[id]).filter(Boolean)); if (!result) { status = 'Union needs unrotated rectangles'; return; }
    const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); const after = Object.fromEntries([...selectedIds.map((id) => [id, null] as const), [result.id, result]]);
    const first = Math.min(...selectedIds.map((id) => document.order.indexOf(id))); const order = document.order.filter((id) => !selectedIds.includes(id)); order.splice(first, 0, result.id);
    execute(new ReplaceObjectsCommand(before, after, document.order, order)); selectedId = result.id; selectedIds = [result.id]; status = 'Union created'; draw();
  }

  function enterEditMode() { if (!selectedId) return; const object = document.objects[selectedId]; if (object?.geometry.kind === 'path') { editMode = true; multiMode = false; selectedNodeId = object.geometry.nodes[0]?.id ?? null; status = 'Shape Edit'; draw(); } }
  function exitEditMode() { editMode = false; selectedNodeId = null; status = 'Selection'; draw(); }
  function updatePathNodes(nodes: readonly PathNode[], label: string) {
    if (!selectedId) return; const object = document.objects[selectedId]; if (object.geometry.kind !== 'path') return;
    const after = { ...object, geometry: { ...object.geometry, nodes } };
    execute(new ReplaceObjectsCommand({ [object.id]: object }, { [object.id]: after }, document.order, document.order)); status = label;
  }
  function addNode() {
    if (!selectedId || !selectedNodeId) return; const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path') return;
    const index = geometry.nodes.findIndex((node) => node.id === selectedNodeId), from = geometry.nodes[index], to = geometry.nodes[(index + 1) % geometry.nodes.length];
    const node: PathNode = { id: crypto.randomUUID(), anchor: { x: (from.anchor.x + to.anchor.x) / 2, y: (from.anchor.y + to.anchor.y) / 2 }, in: null, out: null, kind: 'corner' };
    const nodes = [...geometry.nodes]; nodes.splice(index + 1, 0, node); selectedNodeId = node.id; updatePathNodes(nodes, 'Node added');
  }
  function deleteNode() {
    if (!selectedId || !selectedNodeId) return; const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path' || geometry.nodes.length <= 3) return;
    const nodes = geometry.nodes.filter((node) => node.id !== selectedNodeId); selectedNodeId = nodes[0]?.id ?? null; updatePathNodes(nodes, 'Node deleted');
  }
  function toggleNodeKind() {
    if (!selectedId || !selectedNodeId) return; const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path') return;
    const nodes = geometry.nodes.map((node) => node.id !== selectedNodeId ? node : node.kind === 'corner' ? { ...node, kind: 'symmetric' as const, in: { x: -36, y: 0 }, out: { x: 36, y: 0 } } : { ...node, kind: 'corner' as const, in: null, out: null });
    updatePathNodes(nodes, 'Node converted');
  }

  function newWorkspace() {
    if (document.order.length && !window.confirm('Start a blank Workspace? Export a backup first if needed.')) return;
    document = createDocument(); history.clear(); clearSelection(); viewWasAdjusted = false; hasFittedView = false; resize(); scheduleSave(); status = 'New Workspace';
  }
  function exportProject() {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = window.document.createElement('a');
    link.href = url; link.download = 'shpeshft-project.shpeshft.json'; link.click(); URL.revokeObjectURL(url); status = 'Backup exported';
  }
  function stress(kind: '500' | '2500' | '5000' | 'curves' | 'nodes') {
    document = kind === 'curves' ? createPathBenchmarkDocument(500) : kind === 'nodes' ? createNodeBenchmarkDocument(1000) : createBenchmarkDocument(Number(kind)); clearSelection(); status = `${kind} benchmark`; draw();
  }

  function replaceNode(objectId: string, nodeId: string, update: (node: PathNode) => PathNode) {
    const object = document.objects[objectId]; if (!object || object.geometry.kind !== 'path') return;
    document = { ...document, objects: { ...document.objects, [objectId]: { ...object, geometry: { ...object.geometry, nodes: object.geometry.nodes.map((node) => node.id === nodeId ? update(node) : node) } } } };
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    if (!hasFittedView || !viewWasAdjusted) { view = fitWorkspace(rect.width, rect.height, document.workspace.width, document.workspace.height, rect.width < 680 ? 24 : 56); hasFittedView = true; }
    draw();
  }

  function primaryHandle(object: VectorObject) { const b = localBounds(object); return localToWorld(object, b.x + b.width, b.y + b.height); }
  function contextualStyle() {
    if (!selectedId) return 'display:none'; const object = document.objects[selectedId], b = localBounds(object), world = localToWorld(object, b.x + b.width, b.y);
    return `left:${view.x + world.x * view.scale}px;top:${view.y + world.y * view.scale}px`;
  }
  function snapped(angle: number) { const step = Math.PI / 12, target = Math.round(angle / step) * step; return Math.abs(target - angle) < Math.PI / 45 ? target : angle; }

  function applyObjectTransform(ctx: CanvasRenderingContext2D, object: VectorObject) {
    const center = localCenter(object), worldCenter = objectCenter(object);
    ctx.translate(worldCenter.x, worldCenter.y); ctx.rotate(object.transform.rotation); ctx.scale(object.transform.scaleX, object.transform.scaleY); ctx.translate(-center.x, -center.y);
  }

  function draw() {
    cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const started = performance.now(), ctx = canvas?.getContext('2d'); if (!ctx) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2), width = canvas.width / ratio, height = canvas.height / ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#d9d6cf'; ctx.fillRect(0, 0, width, height);
      ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale); ctx.fillStyle = document.workspace.background; ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = 28 / view.scale; ctx.fillRect(0, 0, document.workspace.width, document.workspace.height); ctx.shadowColor = 'transparent';
      for (const id of document.order) {
        const object = document.objects[id]; if (!object?.visible) continue;
        ctx.save(); applyObjectTransform(ctx, object); ctx.globalAlpha = object.style.opacity; ctx.fillStyle = object.style.fill; ctx.strokeStyle = object.style.stroke || 'transparent'; ctx.lineWidth = object.style.strokeWidth; ctx.beginPath();
        if (object.geometry.kind === 'rect') ctx.roundRect(0, 0, object.geometry.width, object.geometry.height, object.geometry.radius); else if (object.geometry.kind === 'ellipse') ctx.ellipse(0, 0, object.geometry.rx, object.geometry.ry, 0, 0, Math.PI * 2); else tracePath(ctx, object);
        ctx.fill(); if (object.style.stroke) ctx.stroke(); ctx.restore();
        if (!selectedIds.includes(id)) continue;
        const b = localBounds(object); ctx.save(); applyObjectTransform(ctx, object); ctx.strokeStyle = '#2457ff'; ctx.lineWidth = 1.5 / view.scale; ctx.setLineDash([6 / view.scale, 5 / view.scale]); ctx.strokeRect(b.x, b.y, b.width, b.height); ctx.restore();
        if (!editMode && id === selectedId) { const handle = primaryHandle(object); ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 3 / view.scale; ctx.fillStyle = '#111'; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(handle.x, handle.y, 15 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(handle.x, handle.y, 4 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        if (editMode && id === selectedId && object.geometry.kind === 'path') {
          ctx.save(); applyObjectTransform(ctx, object); ctx.setLineDash([]); ctx.lineWidth = 1.5 / view.scale; ctx.strokeStyle = '#2457ff';
          for (const node of object.geometry.nodes) {
            if (node.id === selectedNodeId) for (const part of ['in', 'out'] as const) { const h = node[part]; if (!h) continue; ctx.beginPath(); ctx.moveTo(node.anchor.x, node.anchor.y); ctx.lineTo(node.anchor.x + h.x, node.anchor.y + h.y); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(node.anchor.x + h.x, node.anchor.y + h.y, 5 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
            const size = (node.id === selectedNodeId ? 13 : 9) / view.scale; ctx.fillStyle = node.id === selectedNodeId ? '#2457ff' : '#fff'; ctx.fillRect(node.anchor.x - size / 2, node.anchor.y - size / 2, size, size); ctx.strokeRect(node.anchor.x - size / 2, node.anchor.y - size / 2, size, size);
          }
          ctx.restore();
        }
      }
      ctx.restore(); renderMs = performance.now() - started;
    });
  }

  const screenToWorld = (x: number, y: number) => ({ x: (x - view.x) / view.scale, y: (y - view.y) / view.scale });
  function pointerDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect(), midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }; pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: view.scale, anchorX: (midpoint.x - view.x) / view.scale, anchorY: (midpoint.y - view.y) / view.scale }; drag = null; nodeDrag = null; pan = null; return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (editMode && selectedId) {
      const object = document.objects[selectedId]; if (object?.geometry.kind === 'path') { const local = worldToLocal(object, world.x, world.y), radius = 22 / view.scale;
        for (const node of [...object.geometry.nodes].reverse()) { if (node.id === selectedNodeId) for (const part of ['in', 'out'] as const) { const h = node[part]; if (h && Math.hypot(local.x - node.anchor.x - h.x, local.y - node.anchor.y - h.y) <= radius) { nodeDrag = { objectId: object.id, nodeId: node.id, part, before: node }; return; } } if (Math.hypot(local.x - node.anchor.x, local.y - node.anchor.y) <= radius) { selectedNodeId = node.id; nodeDrag = { objectId: object.id, nodeId: node.id, part: 'anchor', before: node }; draw(); return; } }
      }
    }
    if (!editMode && selectedId) { const object = document.objects[selectedId], handle = primaryHandle(object); if (Math.hypot(world.x - handle.x, world.y - handle.y) <= 30 / view.scale) { const origin = objectCenter(object); drag = { id: selectedId, kind: 'primary', before: object.transform, startWorldX: world.x, startWorldY: world.y, startDistance: Math.max(1, Math.hypot(world.x - origin.x, world.y - origin.y)), startAngle: Math.atan2(world.y - origin.y, world.x - origin.x), axis: resizeAxis }; return; } }
    const hit = [...document.order].reverse().find((id) => hitTest(document.objects[id], world.x, world.y)) ?? null;
    if (hit) { if (multiMode || event.shiftKey) selectedIds = selectedIds.includes(hit) ? selectedIds.filter((id) => id !== hit) : [...selectedIds, hit]; else selectedIds = [hit]; selectedId = hit; selectedNodeId = null; drag = { id: hit, kind: 'move', before: document.objects[hit].transform, startWorldX: world.x, startWorldY: world.y }; draw(); }
    else { clearSelection(); pan = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }; draw(); }
  }
  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect(), midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }; view = zoomFromAnchor({ x: pinch.anchorX, y: pinch.anchorY }, midpoint, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance); viewWasAdjusted = true; draw(); return; }
    if (pan) { view = { ...view, x: pan.viewX + event.clientX - pan.x, y: pan.viewY + event.clientY - pan.y }; viewWasAdjusted = true; draw(); return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (nodeDrag) { const object = document.objects[nodeDrag.objectId], local = worldToLocal(object, world.x, world.y); replaceNode(nodeDrag.objectId, nodeDrag.nodeId, (node) => nodeDrag?.part === 'anchor' ? { ...node, anchor: local } : { ...node, [nodeDrag!.part]: { x: local.x - node.anchor.x, y: local.y - node.anchor.y } }); draw(); return; }
    if (drag) { const object = document.objects[drag.id]; let transform: Transform;
      if (drag.kind === 'move') transform = { ...drag.before, x: drag.before.x + world.x - drag.startWorldX, y: drag.before.y + world.y - drag.startWorldY };
      else { const beforeObject = { ...object, transform: drag.before }, center = objectCenter(beforeObject), local = localCenter(beforeObject), dx = world.x - center.x, dy = world.y - center.y, factor = Math.max(.08, Math.hypot(dx, dy) / (drag.startDistance ?? 1)), angle = snapped(drag.before.rotation + Math.atan2(dy, dx) - (drag.startAngle ?? 0)); const scaleX = drag.axis === 'height' ? drag.before.scaleX : drag.before.scaleX * factor, scaleY = drag.axis === 'width' ? drag.before.scaleY : drag.before.scaleY * factor; transform = { ...drag.before, x: center.x - local.x * scaleX, y: center.y - local.y * scaleY, rotation: drag.axis === 'both' ? angle : drag.before.rotation, scaleX, scaleY }; }
      document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform } } }; draw();
    }
  }
  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; pan = null;
    if (nodeDrag) { const object = document.objects[nodeDrag.objectId], after = object.geometry.kind === 'path' ? object.geometry.nodes.find((node) => node.id === nodeDrag?.nodeId) : undefined; if (after && JSON.stringify(after) !== JSON.stringify(nodeDrag.before)) { const before = nodeDrag.before; replaceNode(nodeDrag.objectId, nodeDrag.nodeId, () => before); execute(new MovePathNodeCommand(nodeDrag.objectId, nodeDrag.nodeId, before, after)); } nodeDrag = null; }
    if (drag) { const object = document.objects[drag.id]; if (JSON.stringify(object.transform) !== JSON.stringify(drag.before)) { const after = object.transform; document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform: drag.before } } }; execute(new TransformObjectCommand(drag.id, drag.before, after)); } drag = null; }
  }
  function wheel(event: WheelEvent) { event.preventDefault(); const rect = canvas.getBoundingClientRect(); view = zoomAt(view, { x: event.clientX - rect.left, y: event.clientY - rect.top }, view.scale * Math.exp(-event.deltaY * .001)); viewWasAdjusted = true; draw(); }

  onMount(() => {
    debugMode = new URLSearchParams(location.search).get('debug') === '1'; const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    void loadLatestProject().then((saved) => { if (saved) { document = saved; status = 'Recovered'; const rect = canvas.getBoundingClientRect(); view = fitWorkspace(rect.width, rect.height, document.workspace.width, document.workspace.height, rect.width < 680 ? 24 : 56); draw(); } });
    return () => observer.disconnect();
  });
</script>

<svelte:window on:keydown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'z') event.shiftKey ? redo() : undo(); if (event.key === 'Escape') editMode ? exitEditMode() : clearSelection(); if ((event.key === 'Backspace' || event.key === 'Delete') && !editMode) deleteSelection(); }} />

<main>
  <header>
    <span class="save-state">{status}</span>
    <div class="brand" aria-label="SHPESHFT"><img src="/assets/shpeshft-logo.png" alt="SHPESHFT" /></div>
    <button class="new-workspace" on:click={newWorkspace} aria-label="New Workspace">＋</button>
  </header>
  <section class="workspace-shell">
    <canvas bind:this={canvas} aria-label="SHPESHFT Workspace" on:pointerdown={pointerDown} on:pointermove={pointerMove} on:pointerup={pointerUp} on:pointercancel={pointerUp} on:wheel={wheel}></canvas>

    {#if selectedId && !editMode && selectedIds.length === 1 && document.objects[selectedId]?.geometry.kind === 'path'}<button class="edit-shape" style={contextualStyle()} on:click={enterEditMode} aria-label="Edit Shape">✎</button>{/if}

    {#if !selectedId}
      <nav class="creation-dock" aria-label="Add shapes"><button on:click={() => addShape('triangle')} aria-label="Add triangle">▲</button><button on:click={() => addShape('rectangle')} aria-label="Add rectangle">■</button><button on:click={() => addShape('ellipse')} aria-label="Add ellipse">●</button><i></i><button on:click={() => multiMode = !multiMode} class:active={multiMode} aria-label="Multi-select">⊕</button><button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button><button class="more" aria-label="Workspace menu" on:click={exportProject}>•••</button></nav>
    {:else if editMode}
      <nav class="context-dock edit-dock" aria-label="Shape Edit controls"><button class="done" on:click={exitEditMode}>Done</button><button on:click={addNode} aria-label="Add node">＋ node</button><button on:click={toggleNodeKind} aria-label="Convert node">◇/○</button><button on:click={deleteNode} aria-label="Delete node" disabled={!selectedNodeId}>− node</button><button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button></nav>
    {:else}
      <nav class="context-dock" aria-label="Object actions">
        {#if selectedIds.length === 1}<button on:click={duplicateSelection} aria-label="Duplicate">Duplicate</button><button on:click={deleteSelection} aria-label="Delete">Delete</button><button on:click={() => reorder(-1)} aria-label="Move backward">Back</button><button on:click={() => reorder(1)} aria-label="Move forward">Front</button>{/if}
        {#if selectedIds.length > 1}<button on:click={groupSelection}>Group</button><button on:click={unionSelection}>Union</button>{/if}
        {#if selectedIds.some((id) => document.objects[id]?.parentId)}<button on:click={ungroupSelection}>Ungroup</button>{/if}
        <label>Opacity <input aria-label="Opacity" type="range" min=".05" max="1" step=".05" value={document.objects[selectedId]?.style.opacity ?? 1} on:change={(event) => setOpacity(Number(event.currentTarget.value))} /></label>
        {#if selectedIds.length === 1}<div class="axis" aria-label="Resize mode"><button class:active={resizeAxis === 'both'} on:click={() => resizeAxis = 'both'}>Scale + rotate</button><button class:active={resizeAxis === 'width'} on:click={() => resizeAxis = 'width'}>Width</button><button class:active={resizeAxis === 'height'} on:click={() => resizeAxis = 'height'}>Height</button></div>{/if}
        <button class:active={multiMode} on:click={() => multiMode = !multiMode} aria-label="Add to selection">⊕ Select</button>
      </nav>
    {/if}

    {#if debugMode}<aside class="benchmark"><span>{document.order.length.toLocaleString()} · {renderMs.toFixed(1)}ms</span><button on:click={() => stress('500')}>500</button><button on:click={() => stress('2500')}>2.5K</button><button on:click={() => stress('5000')}>5K</button><button on:click={() => stress('curves')}>500⌁</button><button on:click={() => stress('nodes')}>1K nodes</button></aside>{/if}
  </section>
  <footer><span>Taking</span><i class="triangle"></i><i class="bar"></i><span>out of design</span></footer>
</main>
