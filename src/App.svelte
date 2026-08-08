<script lang="ts">
  import { onMount } from 'svelte';
  import { AddObjectCommand, History, TransformObjectCommand } from './core/commands';
  import { createDocument, createEllipse, createRectangle, type ShpeshftDocument, type Transform } from './core/document';
  import { createBenchmarkDocument } from './engine/benchmark';
  import { hitTest, localBounds } from './engine/geometry';
  import { loadLatestProject, saveProject } from './storage/database';

  let canvas: HTMLCanvasElement;
  let document: ShpeshftDocument = createDocument();
  let selectedId: string | null = null;
  let view = { x: 0, y: 0, scale: 0.55 };
  let mode: 'select' | 'pan' = 'select';
  let status = 'Local-first prototype';
  const history = new History();
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: null | { id: string; startWorldX: number; startWorldY: number; before: Transform } = null;
  let pan: null | { x: number; y: number; viewX: number; viewY: number } = null;
  let pinch: null | { distance: number; scale: number } = null;
  let frame = 0;
  let saveTimer: number | undefined;

  const execute = (command: AddObjectCommand | TransformObjectCommand) => {
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

  function addRect() { execute(new AddObjectCommand(createRectangle(360 + Math.random() * 200, 360 + Math.random() * 200))); }
  function addEllipse() { execute(new AddObjectCommand(createEllipse(450 + Math.random() * 160, 450 + Math.random() * 160))); }
  function undo() { document = history.undo(document); selectedId = null; scheduleSave(); draw(); }
  function redo() { document = history.redo(document); selectedId = null; scheduleSave(); draw(); }
  function stress(count: number) { document = createBenchmarkDocument(count); selectedId = null; status = `${count.toLocaleString()} object benchmark`; draw(); }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
  }

  function draw() {
    cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
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
        else {
          object.geometry.nodes.forEach((node, index) => index ? ctx.lineTo(node.anchor.x, node.anchor.y) : ctx.moveTo(node.anchor.x, node.anchor.y));
          if (object.geometry.closed) ctx.closePath();
        }
        ctx.fill(); if (object.style.stroke) ctx.stroke(); ctx.restore();
        if (id === selectedId) {
          const bounds = localBounds(object); ctx.save(); ctx.translate(object.transform.x, object.transform.y); ctx.scale(object.transform.scaleX, object.transform.scaleY);
          ctx.strokeStyle = '#2457ff'; ctx.lineWidth = 2 / view.scale; ctx.setLineDash([8 / view.scale, 6 / view.scale]); ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.restore();
        }
      }
      ctx.restore();
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
    selectedId = [...document.order].reverse().find((id) => hitTest(document.objects[id], world.x, world.y)) || null;
    if (selectedId) drag = { id: selectedId, startWorldX: world.x, startWorldY: world.y, before: document.objects[selectedId].transform };
    draw();
  }

  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()]; view = { ...view, scale: Math.max(.12, Math.min(5, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)) }; draw(); return;
    }
    if (pan) { view = { ...view, x: pan.viewX + event.clientX - pan.x, y: pan.viewY + event.clientY - pan.y }; draw(); return; }
    if (drag) {
      const rect = canvas.getBoundingClientRect(); const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const object = document.objects[drag.id]; if (!object) return;
      document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform: { ...drag.before, x: drag.before.x + world.x - drag.startWorldX, y: drag.before.y + world.y - drag.startWorldY } } } }; draw();
    }
  }

  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId); pinch = null; pan = null;
    if (drag) {
      const object = document.objects[drag.id]; const changed = object && (object.transform.x !== drag.before.x || object.transform.y !== drag.before.y);
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
    <div class="status"><span>{document.order.length.toLocaleString()} objects</span><span>{status}</span></div>
  </header>

  <section class="workspace-shell">
    <canvas bind:this={canvas} aria-label="SHPESHFT Workspace" on:pointerdown={pointerDown} on:pointermove={pointerMove} on:pointerup={pointerUp} on:pointercancel={pointerUp} on:wheel={wheel}></canvas>
    <nav class="tools" aria-label="Workspace tools">
      <button class:active={mode === 'select'} on:click={() => mode = 'select'} aria-label="Select tool">↖</button>
      <button class:active={mode === 'pan'} on:click={() => mode = 'pan'} aria-label="Pan tool">✋</button>
      <span></span>
      <button on:click={addRect} aria-label="Add rectangle">□</button>
      <button on:click={addEllipse} aria-label="Add ellipse">○</button>
      <span></span>
      <button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button>
      <button on:click={redo} disabled={!history.canRedo} aria-label="Redo">↷</button>
    </nav>
    <aside class="benchmark">
      <span>ENGINE TEST</span>
      <button on:click={() => stress(500)}>500</button><button on:click={() => stress(2500)}>2.5K</button><button on:click={() => stress(5000)}>5K</button>
    </aside>
  </section>

  <footer><span>Taking</span><i class="triangle"></i><i class="bar"></i><span>out of design</span></footer>
</main>
