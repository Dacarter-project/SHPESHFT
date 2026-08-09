<script lang="ts">
  import { onMount } from 'svelte';
  import { AddObjectCommand, History, MovePathNodeCommand, ReplaceObjectsCommand, TransformObjectCommand } from './core/commands';
  import { createDocument, createEllipse, createRectangle, createTriangle, type PathNode, type ShpeshftDocument, type Style, type Transform, type VectorObject } from './core/document';
  import { exportSvg as serializeSvg } from './core/svg';
  import { booleanRectangles, type BooleanOperation } from './engine/boolean';
  import { createBenchmarkDocument, createNodeBenchmarkDocument, createPathBenchmarkDocument } from './engine/benchmark';
  import { cubicPoints, nearestCubicPoint, splitCubicSegment } from './engine/bezier';
  import { hitTest, localBounds, localCenter, localToWorld, objectCenter, tracePath, worldToLocal } from './engine/geometry';
  import { fitWorkspace, zoomAt, zoomFromAnchor } from './engine/viewport';
  import { loadLatestProject, saveProject } from './storage/database';

  type Axis = 'both' | 'width' | 'height';
  type TransformDrag = { id: string; kind: 'move' | 'primary'; before: Transform; beforeSelection?: Record<string, Transform>; baseBounds?: {x:number;y:number;width:number;height:number}; pivot?: { x:number; y:number }; startWorldX: number; startWorldY: number; startDistance?: number; startAngle?: number; axis?: Axis; moved?: boolean };
  type SelectionGesture = { before: Record<string, Transform>; center: { x: number; y: number }; startDistance: number; startAngle: number; startMidpoint: { x: number; y: number } };
  type Guide = { axis: 'x' | 'y'; value: number };

  let canvas: HTMLCanvasElement;
  let document: ShpeshftDocument = createDocument();
  let selectedId: string | null = null;
  let selectedIds: string[] = [];
  let selectedNodeId: string | null = null;
  let selectedSegment: null | { index: number; t: number } = null;
  let editMode = false;
  let multiMode = false;
  let resizeAxis: Axis = 'both';
  let styleMode = false;
  let styleGestureBefore: Record<string, VectorObject> | null = null;
  let debugMode = false;
  let status = 'Ready';
  let view = { x: 0, y: 0, scale: .55 };
  let drag: TransformDrag | null = null;
  let nodeDrag: null | { objectId: string; nodeId: string; part: 'anchor' | 'in' | 'out'; before: PathNode } = null;
  let pan: null | { x: number; y: number; viewX: number; viewY: number } = null;
  let pinch: null | { distance: number; scale: number; anchorX: number; anchorY: number } = null;
  let selectionGesture: SelectionGesture | null = null;
  let guides: Guide[] = [];
  let longPressTimer: number | undefined, pressStart: null | { x: number; y: number; id: string } = null;
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

  function clearSelection() { selectedId = null; selectedIds = []; selectedNodeId = null; selectedSegment = null; editMode = false; multiMode = false; styleMode = false; }
  function selectAdded(object: VectorObject) { selectedId = object.id; selectedIds = [object.id]; editMode = false; multiMode = false; styleMode = false; draw(); }
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
  function setStyle(patch: Partial<Style>, label: string) { updateSelected((object) => ({ ...object, style: { ...object.style, ...patch } }), label); }
  function strokePattern(kind: 'solid'|'dash'|'dot') { const width = selectedId ? document.objects[selectedId]?.style.strokeWidth ?? 2 : 2; setStyle(kind === 'solid' ? { strokeDashArray: [] } : kind === 'dash' ? { strokeDashArray: [width * 4, width * 3] } : { strokeDashArray: [.01, width * 2.5], strokeLineCap: 'round' }, `${kind} stroke`); }
  function cycleCap() { const cap = selectedId ? document.objects[selectedId]?.style.strokeLineCap : 'butt'; setStyle({ strokeLineCap: cap === 'round' ? 'butt' : 'round' }, 'Stroke cap'); }
  function cycleJoin() { const join = selectedId ? document.objects[selectedId]?.style.strokeLineJoin : 'round'; setStyle({ strokeLineJoin: join === 'round' ? 'miter' : join === 'miter' ? 'bevel' : 'round' }, 'Stroke join'); }
  function beginStyleGesture() { if (!styleGestureBefore) styleGestureBefore = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); }
  function previewStyle(patch: Partial<Style>) { beginStyleGesture(); const objects = { ...document.objects }; for (const id of selectedIds) objects[id] = { ...objects[id], style: { ...objects[id].style, ...patch } }; document = { ...document, objects }; draw(); }
  function commitStyleGesture(label: string) { if (!styleGestureBefore) return; const before = styleGestureBefore, after = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); document = { ...document, objects: { ...document.objects, ...before } }; styleGestureBefore = null; execute(new ReplaceObjectsCommand(before, after, document.order, document.order)); status = label; }
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
  function booleanSelection(operation: BooleanOperation) {
    const result = booleanRectangles(selectedIds.map((id) => document.objects[id]).filter(Boolean), operation); if (!result) { status = `${operation} needs overlapping unrotated rectangles`; return; }
    const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); const after = Object.fromEntries([...selectedIds.map((id) => [id, null] as const), [result.id, result]]);
    const first = Math.min(...selectedIds.map((id) => document.order.indexOf(id))); const order = document.order.filter((id) => !selectedIds.includes(id)); order.splice(first, 0, result.id);
    execute(new ReplaceObjectsCommand(before, after, document.order, order)); selectedId = result.id; selectedIds = [result.id]; status = `${result.name} created`; draw();
  }

  function enterEditMode() { if (!selectedId) return; const object = document.objects[selectedId]; if (object?.geometry.kind === 'path') { editMode = true; multiMode = false; selectedNodeId = object.geometry.nodes[0]?.id ?? null; status = 'Shape Edit'; draw(); } }
  function exitEditMode() { editMode = false; selectedNodeId = null; status = 'Selection'; draw(); }
  function updatePathNodes(nodes: readonly PathNode[], label: string) {
    if (!selectedId) return; const object = document.objects[selectedId]; if (object.geometry.kind !== 'path') return;
    const after = { ...object, geometry: { ...object.geometry, nodes } };
    execute(new ReplaceObjectsCommand({ [object.id]: object }, { [object.id]: after }, document.order, document.order)); status = label;
  }
  function addNode() {
    if (!selectedId || !selectedSegment) { status = 'Tap a path segment first'; return; } const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path') return;
    const id = crypto.randomUUID(), nodes = splitCubicSegment(geometry.nodes, selectedSegment.index, selectedSegment.t, id); selectedNodeId = id; selectedSegment = null; updatePathNodes(nodes, 'Node inserted on path');
  }
  function deleteNode() {
    if (!selectedId || !selectedNodeId) return; const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path' || geometry.nodes.length <= 3) return;
    const nodes = geometry.nodes.filter((node) => node.id !== selectedNodeId); selectedNodeId = nodes[0]?.id ?? null; updatePathNodes(nodes, 'Node deleted');
  }
  function setNodeKind(kind: PathNode['kind']) {
    if (!selectedId || !selectedNodeId) return; const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path') return;
    const nodes = geometry.nodes.map((node) => { if (node.id !== selectedNodeId) return node; if (kind === 'corner') return { ...node, kind, in: null, out: null }; const incoming = node.in ?? { x: -36, y: 0 }, outgoing = node.out ?? { x: 36, y: 0 }; return { ...node, kind, in: incoming, out: outgoing }; }); updatePathNodes(nodes, `${kind} node`);
  }

  function newWorkspace() {
    if (document.order.length && !window.confirm('Start a blank Workspace? Export a backup first if needed.')) return;
    document = createDocument(); history.clear(); clearSelection(); viewWasAdjusted = false; hasFittedView = false; resize(); scheduleSave(); status = 'New Workspace';
  }
  function exportProject() {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = window.document.createElement('a');
    link.href = url; link.download = 'shpeshft-project.shpeshft.json'; link.click(); URL.revokeObjectURL(url); status = 'Backup exported';
  }
  function exportSvg() { const blob = new Blob([serializeSvg(document)], { type: 'image/svg+xml' }), url = URL.createObjectURL(blob), link = window.document.createElement('a'); link.href = url; link.download = 'shpeshft-artwork.svg'; link.click(); URL.revokeObjectURL(url); status = 'SVG exported'; }
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
  function worldBounds(ids = selectedIds) {
    const points = ids.flatMap((id) => { const object = document.objects[id]; if (!object) return []; const b = localBounds(object); return [localToWorld(object, b.x, b.y), localToWorld(object, b.x + b.width, b.y), localToWorld(object, b.x + b.width, b.y + b.height), localToWorld(object, b.x, b.y + b.height)]; });
    if (!points.length) return null; const xs = points.map((p) => p.x), ys = points.map((p) => p.y); const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  function selectionHandle() { const b = worldBounds(); return b ? { x: b.x + b.width, y: b.y + b.height } : null; }
  function axisHandles(object: VectorObject) { const b = localBounds(object); return { width: localToWorld(object, b.x + b.width, b.y + b.height / 2), height: localToWorld(object, b.x + b.width / 2, b.y + b.height) }; }
  function selectedAt(x: number, y: number) { return selectedIds.some((id) => hitTest(document.objects[id], x, y)); }
  function selectionForObject(id: string) { const parentId = document.objects[id]?.parentId; return parentId ? document.order.filter((candidate) => document.objects[candidate]?.parentId === parentId) : [id]; }
  function booleanCompatible() { return selectedIds.length > 1 && selectedIds.every((id) => { const object = document.objects[id]; return object?.geometry.kind === 'rect' && object.transform.rotation === 0; }); }
  function groupedSelection() { return selectedIds.length > 1 && selectedIds.every((id) => document.objects[id]?.parentId && document.objects[id].parentId === document.objects[selectedIds[0]]?.parentId); }
  function transformedAround(object: VectorObject, before: Transform, pivot: { x: number; y: number }, scale: number, rotationDelta: number): Transform {
    const source = { ...object, transform: before }, center = objectCenter(source), local = localCenter(source), dx = center.x - pivot.x, dy = center.y - pivot.y, cos = Math.cos(rotationDelta), sin = Math.sin(rotationDelta);
    const nextCenter = { x: pivot.x + (dx * cos - dy * sin) * scale, y: pivot.y + (dx * sin + dy * cos) * scale }, scaleX = before.scaleX * scale, scaleY = before.scaleY * scale;
    return { ...before, x: nextCenter.x - local.x * scaleX, y: nextCenter.y - local.y * scaleY, scaleX, scaleY, rotation: before.rotation + rotationDelta };
  }
  function snapMove(dx: number, dy: number, bounds = worldBounds()) {
    if (!bounds) return { dx, dy }; const threshold = 6 / view.scale, others = document.order.filter((id) => !selectedIds.includes(id)).map((id) => worldBounds([id])).filter(Boolean) as Array<{x:number;y:number;width:number;height:number}>;
    const xTargets = [0, document.workspace.width / 2, document.workspace.width, ...others.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width])], yTargets = [0, document.workspace.height / 2, document.workspace.height, ...others.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height])];
    const movingX = [bounds.x + dx, bounds.x + bounds.width / 2 + dx, bounds.x + bounds.width + dx], movingY = [bounds.y + dy, bounds.y + bounds.height / 2 + dy, bounds.y + bounds.height + dy];
    let bestX: { delta:number; value:number } | null = null, bestY: { delta:number; value:number } | null = null;
    for (const moving of movingX) for (const target of xTargets) { const delta = target - moving; if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, value: target }; }
    for (const moving of movingY) for (const target of yTargets) { const delta = target - moving; if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, value: target }; }
    guides = [...(bestX ? [{ axis: 'x' as const, value: bestX.value }] : []), ...(bestY ? [{ axis: 'y' as const, value: bestY.value }] : [])]; return { dx: dx + (bestX?.delta ?? 0), dy: dy + (bestY?.delta ?? 0) };
  }
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
      if (guides.length) { ctx.save(); ctx.strokeStyle = '#777'; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 4 / view.scale]); for (const guide of guides) { ctx.beginPath(); if (guide.axis === 'x') { ctx.moveTo(guide.value, 0); ctx.lineTo(guide.value, document.workspace.height); } else { ctx.moveTo(0, guide.value); ctx.lineTo(document.workspace.width, guide.value); } ctx.stroke(); } ctx.restore(); }
      for (const id of document.order) {
        const object = document.objects[id]; if (!object?.visible) continue;
        ctx.save(); applyObjectTransform(ctx, object); ctx.fillStyle = object.style.fill; ctx.strokeStyle = object.style.strokeColor; ctx.lineWidth = object.style.strokeWidth; ctx.lineCap = object.style.strokeLineCap; ctx.lineJoin = object.style.strokeLineJoin; ctx.miterLimit = object.style.strokeMiterLimit; ctx.setLineDash([...object.style.strokeDashArray]); ctx.beginPath();
        if (object.geometry.kind === 'rect') ctx.roundRect(0, 0, object.geometry.width, object.geometry.height, object.geometry.radius); else if (object.geometry.kind === 'ellipse') ctx.ellipse(0, 0, object.geometry.rx, object.geometry.ry, 0, 0, Math.PI * 2); else tracePath(ctx, object);
        if (object.style.fillEnabled) { ctx.globalAlpha = object.style.opacity * object.style.fillOpacity; ctx.fill(); } if (object.style.strokeEnabled) { ctx.globalAlpha = object.style.opacity * object.style.strokeOpacity; ctx.stroke(); } ctx.restore();
        if (!selectedIds.includes(id)) continue;
        const b = localBounds(object); if (selectedIds.length === 1) { const corners = [localToWorld(object,b.x,b.y),localToWorld(object,b.x+b.width,b.y),localToWorld(object,b.x+b.width,b.y+b.height),localToWorld(object,b.x,b.y+b.height)]; ctx.save(); ctx.strokeStyle = '#666'; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 4 / view.scale]); ctx.beginPath(); ctx.moveTo(corners[0].x,corners[0].y); for (const corner of corners.slice(1)) ctx.lineTo(corner.x,corner.y); ctx.closePath(); ctx.stroke(); ctx.restore(); }
        if (!editMode && id === selectedId) { const handle = selectedIds.length > 1 ? selectionHandle() : primaryHandle(object); if (handle) { ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 3 / view.scale; ctx.fillStyle = '#111'; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(handle.x, handle.y, 12 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); if (selectedIds.length === 1) { const axes = axisHandles(object), size = 8 / view.scale; for (const point of [axes.width, axes.height]) { ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size); ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size); } } ctx.restore(); } }
        if (editMode && id === selectedId && object.geometry.kind === 'path') {
          ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1 / view.scale; ctx.strokeStyle = '#666';
          if (selectedSegment) { const { p0, p1, p2, p3 } = cubicPoints(object.geometry.nodes, selectedSegment.index), a = localToWorld(object, p0.x, p0.y), b1 = localToWorld(object, p1.x, p1.y), b2 = localToWorld(object, p2.x, p2.y), d = localToWorld(object, p3.x, p3.y); ctx.lineWidth = 4 / view.scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(b1.x, b1.y, b2.x, b2.y, d.x, d.y); ctx.stroke(); ctx.lineWidth = 1.5 / view.scale; }
          for (const node of object.geometry.nodes) {
            const anchor = localToWorld(object, node.anchor.x, node.anchor.y);
            if (node.id === selectedNodeId) for (const part of ['in', 'out'] as const) { const h = node[part]; if (!h) continue; const control = localToWorld(object, node.anchor.x + h.x, node.anchor.y + h.y); ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(control.x, control.y); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(control.x, control.y, 5 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
            const size = (node.id === selectedNodeId ? 9 : 7) / view.scale; ctx.fillStyle = node.id === selectedNodeId ? '#666' : '#fff'; ctx.fillRect(anchor.x - size / 2, anchor.y - size / 2, size, size); ctx.strokeRect(anchor.x - size / 2, anchor.y - size / 2, size, size);
          }
          ctx.restore();
        }
      }
      if (selectedIds.length > 1) { const b = worldBounds(); if (b) { ctx.save(); ctx.strokeStyle = '#666'; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 4 / view.scale]); ctx.strokeRect(b.x, b.y, b.width, b.height); ctx.restore(); } }
      ctx.restore(); renderMs = performance.now() - started;
    });
  }

  const screenToWorld = (x: number, y: number) => ({ x: (x - view.x) / view.scale, y: (y - view.y) / view.scale });
  function pointerDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) { window.clearTimeout(longPressTimer); pressStart = null; const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect(), midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, worldMidpoint = screenToWorld(midpoint.x, midpoint.y), distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (selectedIds.length && (selectedAt(worldMidpoint.x, worldMidpoint.y) || (drag && selectedIds.includes(drag.id)))) { const bounds = worldBounds()!; selectionGesture = { before: Object.fromEntries(selectedIds.map((id) => [id, document.objects[id].transform])), center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, startDistance: distance, startAngle: angle, startMidpoint: worldMidpoint }; pinch = null; }
      else { pinch = { distance, scale: view.scale, anchorX: (midpoint.x - view.x) / view.scale, anchorY: (midpoint.y - view.y) / view.scale }; selectionGesture = null; }
      drag = null; nodeDrag = null; pan = null; return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (editMode && selectedId) {
      const object = document.objects[selectedId]; if (object?.geometry.kind === 'path') { const local = worldToLocal(object, world.x, world.y), radius = 22 / (view.scale * Math.max(.08, Math.min(Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY))));
        for (const node of [...object.geometry.nodes].reverse()) { if (node.id === selectedNodeId) for (const part of ['in', 'out'] as const) { const h = node[part]; if (h && Math.hypot(local.x - node.anchor.x - h.x, local.y - node.anchor.y - h.y) <= radius) { nodeDrag = { objectId: object.id, nodeId: node.id, part, before: node }; return; } } if (Math.hypot(local.x - node.anchor.x, local.y - node.anchor.y) <= radius) { selectedNodeId = node.id; nodeDrag = { objectId: object.id, nodeId: node.id, part: 'anchor', before: node }; draw(); return; } }
        let closest: { index:number; t:number; distance:number } | null = null; const segments = object.geometry.closed ? object.geometry.nodes.length : object.geometry.nodes.length - 1; for (let index = 0; index < segments; index += 1) { const candidate = nearestCubicPoint(object.geometry.nodes, index, local); if (!closest || candidate.distance < closest.distance) closest = { index, ...candidate }; } if (closest && closest.distance <= radius) { selectedSegment = { index: closest.index, t: closest.t }; selectedNodeId = null; status = 'Segment selected'; draw(); return; }
      }
    }
    if (!editMode && selectedId) { const selectedObject = document.objects[selectedId], bounds = worldBounds()!, origin = selectedIds.length === 1 ? objectCenter(selectedObject) : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }; if (selectedIds.length === 1) { const axes = axisHandles(selectedObject); for (const axis of ['width', 'height'] as const) if (Math.hypot(world.x - axes[axis].x, world.y - axes[axis].y) <= 16 / view.scale) { drag = { id: selectedId, kind: 'primary', before: selectedObject.transform, pivot: origin, startWorldX: world.x, startWorldY: world.y, startDistance: Math.max(1, Math.hypot(world.x - origin.x, world.y - origin.y)), startAngle: Math.atan2(world.y - origin.y, world.x - origin.x), axis }; return; } } const handle = selectionHandle(); if (handle && Math.hypot(world.x - handle.x, world.y - handle.y) <= 26 / view.scale) { drag = { id: selectedId, kind: 'primary', before: selectedObject.transform, beforeSelection: Object.fromEntries(selectedIds.map((id) => [id, document.objects[id].transform])), pivot: origin, startWorldX: world.x, startWorldY: world.y, startDistance: Math.max(1, Math.hypot(world.x - origin.x, world.y - origin.y)), startAngle: Math.atan2(world.y - origin.y, world.x - origin.x), axis: 'both' }; return; } }
    const hit = [...document.order].reverse().find((id) => hitTest(document.objects[id], world.x, world.y)) ?? null;
    if (hit) { pressStart = { x: event.clientX, y: event.clientY, id: hit }; window.clearTimeout(longPressTimer); longPressTimer = window.setTimeout(() => { multiMode = true; if (!selectedIds.includes(hit)) selectedIds = [hit]; selectedId = hit; drag = null; pressStart = null; status = 'Multi-select · tap shapes · Done'; draw(); }, 450); if (multiMode || event.shiftKey) { selectedIds = selectedIds.includes(hit) ? selectedIds.filter((id) => id !== hit) : [...selectedIds, hit]; selectedId = selectedIds.at(-1) ?? null; draw(); } else { const selection = selectionForObject(hit); if (!selectedIds.includes(hit)) selectedIds = selection; selectedId = hit; selectedNodeId = null; drag = { id: hit, kind: 'move', before: document.objects[hit].transform, beforeSelection: Object.fromEntries(selectedIds.map((id) => [id, document.objects[id].transform])), baseBounds: worldBounds() ?? undefined, startWorldX: world.x, startWorldY: world.y }; draw(); } }
    else { if (!multiMode) clearSelection(); pan = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }; draw(); }
  }
  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 8) { window.clearTimeout(longPressTimer); pressStart = null; }
    if (pointers.size === 2 && selectionGesture) { const [a, b] = [...pointers.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), angle = Math.atan2(b.y - a.y, b.x - a.x), scale = Math.max(.08, distance / selectionGesture.startDistance), rotation = angle - selectionGesture.startAngle; const objects = { ...document.objects }; for (const id of selectedIds) { const object = objects[id]; objects[id] = { ...object, transform: transformedAround(object, selectionGesture.before[id], selectionGesture.center, scale, rotation) }; } document = { ...document, objects }; draw(); return; }
    if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect(), midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }; view = zoomFromAnchor({ x: pinch.anchorX, y: pinch.anchorY }, midpoint, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance); viewWasAdjusted = true; draw(); return; }
    if (pan) { view = { ...view, x: pan.viewX + event.clientX - pan.x, y: pan.viewY + event.clientY - pan.y }; viewWasAdjusted = true; draw(); return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (nodeDrag) { const object = document.objects[nodeDrag.objectId], local = worldToLocal(object, world.x, world.y); replaceNode(nodeDrag.objectId, nodeDrag.nodeId, (node) => { if (nodeDrag?.part === 'anchor') { const threshold = 8 / (view.scale * Math.max(.08, Math.min(Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY)))), others = object.geometry.kind === 'path' ? object.geometry.nodes.filter((candidate) => candidate.id !== node.id) : []; let x = local.x, y = local.y; const nearX = others.find((candidate) => Math.abs(candidate.anchor.x - x) <= threshold), nearY = others.find((candidate) => Math.abs(candidate.anchor.y - y) <= threshold); if (nearX) x = nearX.anchor.x; if (nearY) y = nearY.anchor.y; guides = [...(nearX ? [{ axis: 'x' as const, value: localToWorld(object, x, y).x }] : []), ...(nearY ? [{ axis: 'y' as const, value: localToWorld(object, x, y).y }] : [])]; return { ...node, anchor: { x, y } }; } const part = nodeDrag!.part, vector = { x: local.x - node.anchor.x, y: local.y - node.anchor.y }; if (node.kind === 'independent' || node.kind === 'corner') return { ...node, [part]: vector }; const opposite = part === 'in' ? 'out' : 'in', oldOpposite = node[opposite], length = node.kind === 'symmetric' ? Math.hypot(vector.x, vector.y) : Math.hypot(oldOpposite?.x ?? -vector.x, oldOpposite?.y ?? -vector.y), vectorLength = Math.max(.001, Math.hypot(vector.x, vector.y)); return { ...node, [part]: vector, [opposite]: { x: -vector.x / vectorLength * length, y: -vector.y / vectorLength * length } }; }); draw(); return; }
    if (drag) { const object = document.objects[drag.id]; let transform: Transform;
      if (drag.kind === 'move') { const snappedMove = snapMove(world.x - drag.startWorldX, world.y - drag.startWorldY, drag.baseBounds); if (drag.beforeSelection && selectedIds.length > 1) { const objects = { ...document.objects }; for (const id of selectedIds) { const before = drag.beforeSelection[id]; objects[id] = { ...objects[id], transform: { ...before, x: before.x + snappedMove.dx, y: before.y + snappedMove.dy } }; } document = { ...document, objects }; drag.moved = true; draw(); return; } transform = { ...drag.before, x: drag.before.x + snappedMove.dx, y: drag.before.y + snappedMove.dy }; drag.moved = true; }
      else { const pivot = drag.pivot ?? objectCenter({ ...object, transform: drag.before }), dx = world.x - pivot.x, dy = world.y - pivot.y, factor = Math.max(.08, Math.hypot(dx, dy) / (drag.startDistance ?? 1)), rotationDelta = snapped(Math.atan2(dy, dx) - (drag.startAngle ?? 0)); if (drag.beforeSelection && selectedIds.length > 1) { const objects = { ...document.objects }; for (const id of selectedIds) objects[id] = { ...objects[id], transform: transformedAround(objects[id], drag.beforeSelection[id], pivot, factor, rotationDelta) }; document = { ...document, objects }; draw(); return; } if (drag.axis !== 'both') { const local = localCenter(object), cos = Math.cos(-drag.before.rotation), sin = Math.sin(-drag.before.rotation), projectedX = dx * cos - dy * sin, projectedY = dx * sin + dy * cos, start = drag.axis === 'width' ? Math.abs((drag.startWorldX - pivot.x) * cos - (drag.startWorldY - pivot.y) * sin) : Math.abs((drag.startWorldX - pivot.x) * sin + (drag.startWorldY - pivot.y) * cos), axisFactor = Math.max(.08, Math.abs(drag.axis === 'width' ? projectedX : projectedY) / Math.max(1, start)), scaleX = drag.axis === 'width' ? drag.before.scaleX * axisFactor : drag.before.scaleX, scaleY = drag.axis === 'height' ? drag.before.scaleY * axisFactor : drag.before.scaleY; transform = { ...drag.before, x: pivot.x - local.x * scaleX, y: pivot.y - local.y * scaleY, scaleX, scaleY }; } else transform = transformedAround(object, drag.before, pivot, factor, rotationDelta); }
      document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform } } }; draw();
    }
  }
  function pointerUp(event: PointerEvent) {
    window.clearTimeout(longPressTimer); pressStart = null; pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; pan = null; guides = [];
    if (selectionGesture && pointers.size < 2) { const before = selectionGesture.before, after = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])), beforeObjects = Object.fromEntries(selectedIds.map((id) => [id, { ...document.objects[id], transform: before[id] }])); document = { ...document, objects: { ...document.objects, ...beforeObjects } }; execute(new ReplaceObjectsCommand(beforeObjects, after, document.order, document.order)); selectionGesture = null; }
    if (nodeDrag) { const object = document.objects[nodeDrag.objectId], after = object.geometry.kind === 'path' ? object.geometry.nodes.find((node) => node.id === nodeDrag?.nodeId) : undefined; if (after && JSON.stringify(after) !== JSON.stringify(nodeDrag.before)) { const before = nodeDrag.before; replaceNode(nodeDrag.objectId, nodeDrag.nodeId, () => before); execute(new MovePathNodeCommand(nodeDrag.objectId, nodeDrag.nodeId, before, after)); } nodeDrag = null; }
    if (drag) { if (drag.beforeSelection && selectedIds.length > 1) { const after = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])), before = Object.fromEntries(selectedIds.map((id) => [id, { ...document.objects[id], transform: drag!.beforeSelection![id] }])); document = { ...document, objects: { ...document.objects, ...before } }; execute(new ReplaceObjectsCommand(before, after, document.order, document.order)); } else { const object = document.objects[drag.id]; if (JSON.stringify(object.transform) !== JSON.stringify(drag.before)) { const after = object.transform; document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform: drag.before } } }; execute(new TransformObjectCommand(drag.id, drag.before, after)); } } drag = null; }
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

    {#if selectedId && !editMode && selectedIds.length === 1 && document.objects[selectedId]?.geometry.kind === 'path'}<button class="edit-shape" style={contextualStyle()} on:click={enterEditMode} aria-label="Edit Shape">⌁</button>{/if}

    {#if !selectedId}
      <nav class="creation-dock" aria-label="Add shapes"><button on:click={() => addShape('triangle')} aria-label="Add triangle">▲</button><button on:click={() => addShape('rectangle')} aria-label="Add rectangle">■</button><button on:click={() => addShape('ellipse')} aria-label="Add ellipse">●</button><i></i><button on:click={() => multiMode = !multiMode} class:active={multiMode} aria-label="Multi-select">⊕</button><button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button><button aria-label="Export SVG" on:click={exportSvg}>SVG</button><button class="more" aria-label="Export project backup" on:click={exportProject}>•••</button></nav>
    {:else if editMode}
      <nav class="context-dock edit-dock" aria-label="Shape Edit controls"><button class="done" on:click={exitEditMode}>Done</button><button on:click={addNode} aria-label="Insert node on selected segment" disabled={!selectedSegment}>＋</button><button on:click={() => setNodeKind('corner')} aria-label="Corner node" disabled={!selectedNodeId}>◆</button><button on:click={() => setNodeKind('smooth')} aria-label="Smooth node" disabled={!selectedNodeId}>⌒</button><button on:click={() => setNodeKind('symmetric')} aria-label="Symmetric node" disabled={!selectedNodeId}>↔</button><button on:click={() => setNodeKind('independent')} aria-label="Independent node" disabled={!selectedNodeId}>◇</button><button on:click={deleteNode} aria-label="Delete node" disabled={!selectedNodeId}>−</button><button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button></nav>
    {:else}
      <nav class="context-dock" class:style-dock={styleMode} aria-label={styleMode ? 'Fill and Stroke' : 'Object actions'}>
        {#if styleMode && selectedIds.length === 1}
          <button class="done" on:click={() => styleMode = false}>Done</button>
          <label class="toggle"><input type="checkbox" checked={document.objects[selectedId]?.style.fillEnabled} on:change={(event) => setStyle({ fillEnabled: event.currentTarget.checked }, event.currentTarget.checked ? 'Fill on' : 'Fill off')} />Fill</label>
          {#if document.objects[selectedId]?.style.fillEnabled}<input class="colour" aria-label="Fill colour" type="color" value={document.objects[selectedId]?.style.fill} on:change={(event) => setStyle({ fill: event.currentTarget.value }, 'Fill colour')} />{/if}
          <label class="toggle"><input type="checkbox" checked={document.objects[selectedId]?.style.strokeEnabled} on:change={(event) => setStyle({ strokeEnabled: event.currentTarget.checked }, event.currentTarget.checked ? 'Stroke on' : 'Stroke off')} />Stroke</label>
          {#if document.objects[selectedId]?.style.strokeEnabled}
            <input class="colour" aria-label="Stroke colour" type="color" value={document.objects[selectedId]?.style.strokeColor} on:change={(event) => setStyle({ strokeColor: event.currentTarget.value }, 'Stroke colour')} />
            <label>Width <input aria-label="Stroke width" type="range" min=".25" max="200" step=".25" value={document.objects[selectedId]?.style.strokeWidth} on:pointerdown={beginStyleGesture} on:input={(event) => previewStyle({ strokeWidth: Number(event.currentTarget.value) })} on:change={() => commitStyleGesture('Stroke width')} /></label>
            <button class:active={!document.objects[selectedId]?.style.strokeDashArray.length} on:click={() => strokePattern('solid')}>Solid</button>
            <button class:active={document.objects[selectedId]?.style.strokeDashArray.length > 0 && document.objects[selectedId]?.style.strokeDashArray[0] > 0} on:click={() => strokePattern('dash')}>Dash</button>
            <button class:active={document.objects[selectedId]?.style.strokeDashArray[0] === .01} on:click={() => strokePattern('dot')}>Dot</button>
            <button on:click={cycleCap}>Cap {document.objects[selectedId]?.style.strokeLineCap === 'round' ? '●' : '■'}</button>
            <button on:click={cycleJoin}>Join {document.objects[selectedId]?.style.strokeLineJoin}</button>
            <label>Stroke α <input aria-label="Stroke opacity" type="range" min="0" max="1" step=".05" value={document.objects[selectedId]?.style.strokeOpacity} on:pointerdown={beginStyleGesture} on:input={(event) => previewStyle({ strokeOpacity: Number(event.currentTarget.value) })} on:change={() => commitStyleGesture('Stroke opacity')} /></label>
          {/if}
        {:else}
        {#if selectedIds.length === 1}<button on:click={duplicateSelection} aria-label="Duplicate">Duplicate</button><button on:click={deleteSelection} aria-label="Delete">Delete</button><button on:click={() => reorder(-1)} aria-label="Move backward">Back</button><button on:click={() => reorder(1)} aria-label="Move forward">Front</button>{/if}
        {#if selectedIds.length > 1 && !groupedSelection()}<button on:click={groupSelection}>Group</button>{/if}
        {#if booleanCompatible()}<button on:click={() => booleanSelection('union')}>Combine</button><button on:click={() => booleanSelection('difference')}>Cut Out</button><button on:click={() => booleanSelection('intersect')}>Intersect</button>{/if}
        {#if groupedSelection()}<button on:click={ungroupSelection}>Ungroup</button>{/if}
        <label>Opacity <input aria-label="Opacity" type="range" min=".05" max="1" step=".05" value={document.objects[selectedId]?.style.opacity ?? 1} on:change={(event) => setOpacity(Number(event.currentTarget.value))} /></label>
        {#if selectedIds.length === 1}<button on:click={() => styleMode = true}>Style</button>{/if}
        {#if multiMode}<button class="done" on:click={() => { multiMode = false; status = 'Selection'; }}>Done</button>{:else}<button on:click={() => multiMode = true} aria-label="Add to selection">⊕ Select</button>{/if}
        {/if}
      </nav>
    {/if}

    {#if debugMode}<aside class="benchmark"><span>{document.order.length.toLocaleString()} · {renderMs.toFixed(1)}ms</span><button on:click={() => stress('500')}>500</button><button on:click={() => stress('2500')}>2.5K</button><button on:click={() => stress('5000')}>5K</button><button on:click={() => stress('curves')}>500⌁</button><button on:click={() => stress('nodes')}>1K nodes</button></aside>{/if}
  </section>
  <footer><span>Taking</span><i class="triangle"></i><i class="bar"></i><span>out of design</span></footer>
</main>
