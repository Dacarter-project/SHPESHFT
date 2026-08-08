<script lang="ts">
  import { onMount } from 'svelte';
  import { AddObjectCommand, History, MovePathNodeCommand, ReplaceObjectsCommand, TransformObjectCommand } from './core/commands';
  import { createBezierPath, createDocument, createEllipse, createRectangle, type PathNode, type ShpeshftDocument, type Transform } from './core/document';
  import { unionRectangles } from './engine/boolean';
  import { createBenchmarkDocument, createNodeBenchmarkDocument, createPathBenchmarkDocument } from './engine/benchmark';
  import { hitTest, localBounds, localToWorld, tracePath, worldToLocal } from './engine/geometry';
  import { loadLatestProject, saveProject } from './storage/database';

  let canvas: HTMLCanvasElement;
  let document: ShpeshftDocument = createDocument();
  let selectedId: string | null = null;
  let selectedIds: string[] = [];
  let view = { x: 0, y: 0, scale: 0.55 };
  let mode: 'select' | 'node' | 'pan' = 'select';
  let status = 'Local-first prototype';
  const history = new History();
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: null | {
    id: string; kind: 'move' | 'scale' | 'rotate'; startWorldX: number; startWorldY: number; before: Transform;
    centerX?: number; centerY?: number; startAngle?: number; startDistance?: number;
  } = null;
  let nodeDrag: null | { objectId: string; nodeId: string; part: 'anchor' | 'in' | 'out'; before: PathNode } = null;
  let selectedNodeId: string | null = null;
  let pan: null | { x: number; y: number; viewX: number; viewY: number } = null;
  let pinch: null | { distance: number; scale: number } = null;
  let frame = 0;
  let saveTimer: number | undefined;

  let renderMs = 0;

  const execute = (command: AddObjectCommand | TransformObjectCommand | MovePathNodeCommand | ReplaceObjectsCommand) => {
    document = history.execute(document, command); scheduleSave(); draw();
  };

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    const snapshot = document;
    saveTimer = window.setTimeout(async () => {
      await saveProject(snapshot);
      if (document.updatedAt === snapshot.updatedAt) status = 'Saved locally';
    }, 350);
  }

  function selectAdded(object: ReturnType<typeof createRectangle>) { selectedId = object.id; selectedIds = [object.id]; mode = 'select'; draw(); }
  function addRect() { const object = createRectangle(360 + Math.random() * 200, 360 + Math.random() * 200); execute(new AddObjectCommand(object)); selectAdded(object); }
  function addEllipse() { const object = createEllipse(450 + Math.random() * 160, 450 + Math.random() * 160); execute(new AddObjectCommand(object)); selectAdded(object); }
  function addPath() { const path = createBezierPath(420, 420); execute(new AddObjectCommand(path)); selectedId = path.id; selectedIds = [path.id]; mode = 'node'; draw(); }
  function clearSelection() { selectedId = null; selectedIds = []; selectedNodeId = null; }
  function undo() { document = history.undo(document); clearSelection(); scheduleSave(); draw(); }
  function redo() { document = history.redo(document); clearSelection(); scheduleSave(); draw(); }
  function stress(count: number) { document = createBenchmarkDocument(count); clearSelection(); status = `${count.toLocaleString()} object benchmark`; draw(); }
  function stressPaths(count: number) { document = createPathBenchmarkDocument(count); clearSelection(); status = `${count.toLocaleString()} curve benchmark`; draw(); }
  function stressNodes(count: number) { document = createNodeBenchmarkDocument(count); clearSelection(); status = `${count.toLocaleString()} node path benchmark`; draw(); }

  function updateSelected(mapper: (object: ShpeshftDocument['objects'][string]) => ShpeshftDocument['objects'][string], label: string) {
    if (!selectedIds.length) return;
    const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]]));
    const after = Object.fromEntries(selectedIds.map((id) => [id, mapper(document.objects[id])]));
    execute(new ReplaceObjectsCommand(before, after, document.order, document.order)); status = label;
  }
  function setOpacity(value: number) { updateSelected((object) => ({ ...object, style: { ...object.style, opacity: value } }), `Opacity ${Math.round(value * 100)}%`); }
  function reorder(direction: -1 | 1) {
    if (!selectedId) return; const from = document.order.indexOf(selectedId); const to = Math.max(0, Math.min(document.order.length - 1, from + direction)); if (from === to) return;
    const order = [...document.order]; order.splice(to, 0, order.splice(from, 1)[0]); execute(new ReplaceObjectsCommand({}, {}, document.order, order)); status = direction > 0 ? 'Moved forward' : 'Moved backward';
  }
  function groupSelection() {
    if (selectedIds.length < 2) return; const groupId = crypto.randomUUID();
    updateSelected((object) => ({ ...object, parentId: groupId }), 'Grouped selection');
  }
  function unionSelection() {
    const source = selectedIds.map((id) => document.objects[id]).filter(Boolean); const result = unionRectangles(source);
    if (!result) { status = 'Union needs 2+ overlapping, unrotated rectangles'; return; }
    const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); const after = Object.fromEntries([...selectedIds.map((id) => [id, null] as const), [result.id, result]]);
    const first = Math.min(...selectedIds.map((id) => document.order.indexOf(id))); const order = document.order.filter((id) => !selectedIds.includes(id)); order.splice(first, 0, result.id);
    execute(new ReplaceObjectsCommand(before, after, document.order, order)); selectedId = result.id; selectedIds = [result.id]; mode = 'node'; status = 'Union committed as editable path'; draw();
  }
  function newWorkspace() {
    if (document.order.length && !window.confirm('Start a blank Workspace? Export a backup first if you need this design.')) return;
    document = createDocument(); history.clear(); clearSelection(); status = 'New blank Workspace'; scheduleSave(); draw();
  }
  function exportProject() {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = window.document.createElement('a');
    link.href = url; link.download = `${document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'shpeshft'}.shpeshft.json`; link.click(); URL.revokeObjectURL(url); status = 'Project backup exported';
  }

  function replaceNode(objectId: string, nodeId: string, update: (node: PathNode) => PathNode) {
    const object = document.objects[objectId]; if (!object || object.geometry.kind !== 'path') return;
    document = { ...document, objects: { ...document.objects, [objectId]: { ...object, geometry: { ...object.geometry, nodes: object.geometry.nodes.map((node) => node.id === nodeId ? update(node) : node) } } } };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
  }

  function draw() {
    cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const started = performance.now();
      const ctx = canvas?.getContext('2d'); if (!ctx) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / ratio, height = canvas.height / ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#d9d6cf'; ctx.fillRect(0, 0, width, height);
      ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
      ctx.fillStyle = document.workspace.background; ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = 28 / view.scale;
      ctx.fillRect(0, 0, document.workspace.width, document.workspace.height); ctx.shadowColor = 'transparent';
      for (const id of document.order) {
        const object = document.objects[id]; if (!object?.visible) continue;
        ctx.save(); ctx.translate(object.transform.x, object.transform.y); ctx.rotate(object.transform.rotation); ctx.scale(object.transform.scaleX, object.transform.scaleY);
        ctx.globalAlpha = object.style.opacity; ctx.fillStyle = object.style.fill; ctx.strokeStyle = object.style.stroke || 'transparent'; ctx.lineWidth = object.style.strokeWidth;
        ctx.beginPath();
        if (object.geometry.kind === 'rect') ctx.roundRect(0, 0, object.geometry.width, object.geometry.height, object.geometry.radius);
        else if (object.geometry.kind === 'ellipse') ctx.ellipse(0, 0, object.geometry.rx, object.geometry.ry, 0, 0, Math.PI * 2);
        else tracePath(ctx, object);
        ctx.fill(); if (object.style.stroke) ctx.stroke(); ctx.restore();
        if (selectedIds.includes(id)) {
          const bounds = localBounds(object); ctx.save(); ctx.translate(object.transform.x, object.transform.y); ctx.rotate(object.transform.rotation); ctx.scale(object.transform.scaleX, object.transform.scaleY);
          ctx.strokeStyle = '#2457ff'; ctx.lineWidth = 2 / view.scale; ctx.setLineDash([8 / view.scale, 6 / view.scale]); ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.restore();
          if (mode === 'select' && id === selectedId) {
            const resizeHandle = localToWorld(object, bounds.x + bounds.width, bounds.y + bounds.height);
            const topCenter = localToWorld(object, bounds.x + bounds.width / 2, bounds.y);
            const rotateHandle = { x: topCenter.x + Math.sin(object.transform.rotation) * 42 / view.scale, y: topCenter.y - Math.cos(object.transform.rotation) * 42 / view.scale };
            ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 2 / view.scale; ctx.strokeStyle = '#2457ff';
            ctx.beginPath(); ctx.moveTo(topCenter.x, topCenter.y); ctx.lineTo(rotateHandle.x, rotateHandle.y); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rotateHandle.x, rotateHandle.y, 8 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#2457ff'; ctx.fillRect(resizeHandle.x - 7 / view.scale, resizeHandle.y - 7 / view.scale, 14 / view.scale, 14 / view.scale); ctx.restore();
          }
          if (mode === 'node' && object.geometry.kind === 'path') {
            ctx.save(); ctx.translate(object.transform.x, object.transform.y); ctx.rotate(object.transform.rotation); ctx.scale(object.transform.scaleX, object.transform.scaleY);
            ctx.setLineDash([]); ctx.lineWidth = 1.5 / view.scale; ctx.strokeStyle = '#2457ff';
            for (const node of object.geometry.nodes) {
              for (const part of ['in', 'out'] as const) {
                const handle = node[part]; if (!handle) continue;
                ctx.beginPath(); ctx.moveTo(node.anchor.x, node.anchor.y); ctx.lineTo(node.anchor.x + handle.x, node.anchor.y + handle.y); ctx.stroke();
                ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(node.anchor.x + handle.x, node.anchor.y + handle.y, 5 / view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              }
              const size = (node.id === selectedNodeId ? 12 : 9) / view.scale;
              ctx.fillStyle = node.id === selectedNodeId ? '#2457ff' : '#fff'; ctx.fillRect(node.anchor.x - size / 2, node.anchor.y - size / 2, size, size); ctx.strokeRect(node.anchor.x - size / 2, node.anchor.y - size / 2, size, size);
            }
            ctx.restore();
          }
        }
      }
      ctx.restore();
      renderMs = performance.now() - started;
    });
  }

  const screenToWorld = (x: number, y: number) => ({ x: (x - view.x) / view.scale, y: (y - view.y) / view.scale });
  function pointerDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }; drag = null; return;
    }
    if (mode === 'pan' || event.button === 1) { pan = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }; return; }
    const rect = canvas.getBoundingClientRect(); const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (mode === 'select' && selectedId) {
      const object = document.objects[selectedId];
      if (object) {
        const bounds = localBounds(object); const radius = 20 / view.scale;
        const resizeHandle = localToWorld(object, bounds.x + bounds.width, bounds.y + bounds.height);
        const topCenter = localToWorld(object, bounds.x + bounds.width / 2, bounds.y);
        const rotateHandle = { x: topCenter.x + Math.sin(object.transform.rotation) * 42 / view.scale, y: topCenter.y - Math.cos(object.transform.rotation) * 42 / view.scale };
        const center = { x: object.transform.x, y: object.transform.y };
        if (Math.hypot(world.x - rotateHandle.x, world.y - rotateHandle.y) <= radius) {
          drag = { id: selectedId, kind: 'rotate', startWorldX: world.x, startWorldY: world.y, before: object.transform, centerX: center.x, centerY: center.y, startAngle: Math.atan2(world.y - center.y, world.x - center.x) }; return;
        }
        if (Math.hypot(world.x - resizeHandle.x, world.y - resizeHandle.y) <= radius) {
          drag = { id: selectedId, kind: 'scale', startWorldX: world.x, startWorldY: world.y, before: object.transform, centerX: object.transform.x, centerY: object.transform.y, startDistance: Math.max(1, Math.hypot(world.x - object.transform.x, world.y - object.transform.y)) }; return;
        }
      }
    }
    if (mode === 'node' && selectedId) {
      const object = document.objects[selectedId];
      if (object?.geometry.kind === 'path') {
        const local = worldToLocal(object, world.x, world.y); const radius = 18 / view.scale;
        for (const node of [...object.geometry.nodes].reverse()) {
          for (const part of ['in', 'out'] as const) {
            const handle = node[part]; if (handle && Math.hypot(local.x - node.anchor.x - handle.x, local.y - node.anchor.y - handle.y) <= radius) {
              selectedNodeId = node.id; nodeDrag = { objectId: object.id, nodeId: node.id, part, before: node }; draw(); return;
            }
          }
          if (Math.hypot(local.x - node.anchor.x, local.y - node.anchor.y) <= radius) {
            selectedNodeId = node.id; nodeDrag = { objectId: object.id, nodeId: node.id, part: 'anchor', before: node }; draw(); return;
          }
        }
      }
    }
    const hit = [...document.order].reverse().find((id) => hitTest(document.objects[id], world.x, world.y)) || null;
    if (event.shiftKey && hit) selectedIds = selectedIds.includes(hit) ? selectedIds.filter((id) => id !== hit) : [...selectedIds, hit];
    else selectedIds = hit ? [hit] : [];
    selectedId = hit; selectedNodeId = null;
    if (selectedId) drag = { id: selectedId, kind: 'move', startWorldX: world.x, startWorldY: world.y, before: document.objects[selectedId].transform };
    draw();
  }

  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()]; view = { ...view, scale: Math.max(.12, Math.min(5, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)) }; draw(); return;
    }
    if (pan) { view = { ...view, x: pan.viewX + event.clientX - pan.x, y: pan.viewY + event.clientY - pan.y }; draw(); return; }
    if (nodeDrag) {
      const rect = canvas.getBoundingClientRect(); const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top); const object = document.objects[nodeDrag.objectId]; if (!object) return;
      const local = worldToLocal(object, world.x, world.y);
      replaceNode(nodeDrag.objectId, nodeDrag.nodeId, (node) => nodeDrag?.part === 'anchor' ? { ...node, anchor: local } : { ...node, [nodeDrag!.part]: { x: local.x - node.anchor.x, y: local.y - node.anchor.y } }); draw(); return;
    }
    if (drag) {
      const rect = canvas.getBoundingClientRect(); const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const object = document.objects[drag.id]; if (!object) return;
      let transform: Transform;
      if (drag.kind === 'move') transform = { ...drag.before, x: drag.before.x + world.x - drag.startWorldX, y: drag.before.y + world.y - drag.startWorldY };
      else if (drag.kind === 'scale') {
        const distance = Math.hypot(world.x - (drag.centerX ?? 0), world.y - (drag.centerY ?? 0)); const factor = Math.max(.05, distance / (drag.startDistance ?? 1));
        transform = { ...drag.before, scaleX: drag.before.scaleX * factor, scaleY: drag.before.scaleY * factor };
      } else {
        const angle = Math.atan2(world.y - (drag.centerY ?? 0), world.x - (drag.centerX ?? 0));
        transform = { ...drag.before, rotation: drag.before.rotation + angle - (drag.startAngle ?? angle) };
      }
      document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform } } }; draw();
    }
  }

  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId); pinch = null; pan = null;
    if (nodeDrag) {
      const object = document.objects[nodeDrag.objectId]; const geometry = object?.geometry; const after = geometry?.kind === 'path' ? geometry.nodes.find((node) => node.id === nodeDrag?.nodeId) : undefined;
      if (object && after && JSON.stringify(after) !== JSON.stringify(nodeDrag.before)) {
        const before = nodeDrag.before; replaceNode(nodeDrag.objectId, nodeDrag.nodeId, () => before); execute(new MovePathNodeCommand(nodeDrag.objectId, nodeDrag.nodeId, before, after));
      }
      nodeDrag = null;
    }
    if (drag) {
      const object = document.objects[drag.id]; const changed = object && JSON.stringify(object.transform) !== JSON.stringify(drag.before);
      if (object && changed) {
        const preview = object.transform; document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform: drag.before } } };
        execute(new TransformObjectCommand(drag.id, drag.before, preview));
      }
      drag = null;
    }
  }

  function wheel(event: WheelEvent) { event.preventDefault(); view = { ...view, scale: Math.max(.12, Math.min(5, view.scale * Math.exp(-event.deltaY * .001))) }; draw(); }

  onMount(() => {
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    void loadLatestProject().then((saved) => {
      if (saved) { document = saved; status = 'Recovered local project'; draw(); }
    });
    return () => observer.disconnect();
  });
</script>

<svelte:window on:keydown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'z') event.shiftKey ? redo() : undo(); }} />

<main>
  <header>
    <div class="brand" aria-label="SHPESHFT"><span class="handle square"></span><b>SHPESHFT</b><span class="line"></span><span class="handle circle"></span></div>
    <div class="status"><span>{document.order.length.toLocaleString()} objects · {renderMs.toFixed(1)}ms</span><span>{status}</span></div>
  </header>

  <section class="workspace-shell">
    <canvas bind:this={canvas} aria-label="SHPESHFT Workspace" on:pointerdown={pointerDown} on:pointermove={pointerMove} on:pointerup={pointerUp} on:pointercancel={pointerUp} on:wheel={wheel}></canvas>
    <nav class="tools" aria-label="Workspace tools">
      <button on:click={newWorkspace} aria-label="New Workspace">＋</button>
      <button class:active={mode === 'select'} on:click={() => mode = 'select'} aria-label="Select tool">↖</button>
      <button class:active={mode === 'node'} on:click={() => mode = 'node'} aria-label="Node tool">⌁</button>
      <button class:active={mode === 'pan'} on:click={() => mode = 'pan'} aria-label="Pan tool">✋</button>
      <span></span>
      <button on:click={addRect} aria-label="Add rectangle">□</button>
      <button on:click={addEllipse} aria-label="Add ellipse">○</button>
      <button on:click={addPath} aria-label="Add Bezier path">⌁</button>
      <span></span>
      <button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button>
      <button on:click={redo} disabled={!history.canRedo} aria-label="Redo">↷</button>
      <button on:click={exportProject} aria-label="Export project backup">⇩</button>
    </nav>
    <aside class="benchmark">
      <span>ENGINE TEST</span>
      <button on:click={() => stress(500)}>500</button><button on:click={() => stress(2500)}>2.5K</button><button on:click={() => stress(5000)}>5K</button>
      <button on:click={() => stressPaths(500)}>500⌁</button>
      <button on:click={() => stressNodes(1000)}>1K nodes</button>
    </aside>
    {#if selectedId}
      <aside class="inspector" aria-label="Selection controls">
        <label>Opacity <input aria-label="Opacity" type="range" min="0.05" max="1" step="0.05" value={document.objects[selectedId]?.style.opacity ?? 1} on:change={(event) => setOpacity(Number(event.currentTarget.value))} /></label>
        <div><button on:click={() => reorder(-1)} aria-label="Move backward">↓</button><button on:click={() => reorder(1)} aria-label="Move forward">↑</button><button on:click={groupSelection} disabled={selectedIds.length < 2}>Group</button><button on:click={unionSelection} disabled={selectedIds.length < 2}>Union</button></div>
        {#if selectedIds.length > 1}<small>{selectedIds.length} selected</small>{/if}
      </aside>
    {/if}
  </section>

  <footer><span>Taking</span><i class="triangle"></i><i class="bar"></i><span>out of design</span></footer>
</main>
