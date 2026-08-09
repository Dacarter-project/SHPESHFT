<script lang="ts">
  import { onMount } from 'svelte';
  import { AddObjectCommand, History, MovePathNodeCommand, ReplaceObjectsCommand, TransformObjectCommand } from './core/commands';
  import { createDocument, createEllipse, createRectangle, createTriangle, type PathNode, type ShpeshftDocument, type Style, type Transform, type VectorObject } from './core/document';
  import { exportSvg as serializeSvg } from './core/svg';
  import { booleanShapes, type BooleanOperation } from './engine/boolean';
  import { createBenchmarkDocument, createNodeBenchmarkDocument, createPathBenchmarkDocument } from './engine/benchmark';
  import { cubicPoints, nearestCubicPoint, splitCubicSegment } from './engine/bezier';
  import { hitTest, localBounds, localCenter, localToWorld, objectCenter, tracePath, worldToLocal } from './engine/geometry';
  import { fitWorkspace, zoomAt, zoomFromAnchor } from './engine/viewport';
  import { transformAround } from './engine/transform';
  import { loadLatestProject, saveProject } from './storage/database';

  type Edge = 'top' | 'right' | 'bottom' | 'left';
  type TransformDrag = { id: string; kind: 'move' | 'primary' | 'dimension'; before: Transform; beforeSelection?: Record<string, Transform>; baseBounds?: {x:number;y:number;width:number;height:number}; pivot?: { x:number; y:number }; startWorldX: number; startWorldY: number; startDistance?: number; startAngle?: number; edge?: Edge; moved?: boolean };
  type Guide = { axis: 'x' | 'y'; value: number };

  let canvas: HTMLCanvasElement;
  let document: ShpeshftDocument = createDocument();
  let selectedId: string | null = null;
  let selectedIds: string[] = [];
  let selectedNodeId: string | null = null;
  let selectedSegment: null | { index: number; t: number } = null;
  let editMode = false;
  let multiMode = false;
  let resizeMode: 'symmetric' | 'edge' = 'symmetric';
  let styleMode = false;
  let actionsOpen = false;
  let toolsVisible = true;
  let helpOpen = false;
  let orientedControls = false;
  let styleGestureBefore: Record<string, VectorObject> | null = null;
  let debugMode = false;
  let status = 'Ready';
  let view = { x: 0, y: 0, scale: .55 };
  let drag: TransformDrag | null = null;
  let nodeDrag: null | { objectId: string; nodeId: string; part: 'anchor' | 'in' | 'out'; before: PathNode } = null;
  let pan: null | { x: number; y: number; viewX: number; viewY: number; moved: boolean } = null;
  let lasso: null | { start:{x:number;y:number}; current:{x:number;y:number} } = null;
  let pinch: null | { distance: number; scale: number; anchorX: number; anchorY: number } = null;
  let guides: Guide[] = [];
  let longPressTimer: number | undefined, pressStart: null | { x: number; y: number; id: string | null } = null;
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

  function clearSelection() { selectedId = null; selectedIds = []; selectedNodeId = null; selectedSegment = null; editMode = false; multiMode = false; styleMode = false; actionsOpen = false; helpOpen = false; orientedControls = false; }
  function expandGroups(ids: readonly string[]) {
    const expanded = new Set<string>();
    for (const id of ids) {
      const parentId = document.objects[id]?.parentId;
      if (parentId) for (const candidate of document.order) { if (document.objects[candidate]?.parentId === parentId) expanded.add(candidate); }
      else expanded.add(id);
    }
    return document.order.filter((id) => expanded.has(id));
  }
  function selectAdded(object: VectorObject) { selectedId = object.id; selectedIds = [object.id]; editMode = false; multiMode = false; styleMode = false; toolsVisible = true; orientedControls = false; draw(); }
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
  function setStyle(patch: Partial<Style>, label: string) { updateSelected((object) => ({ ...object, style: { ...object.style, ...patch } }), label); }
  function strokePattern(kind: 'solid'|'dash'|'dot') { const width = selectedId ? document.objects[selectedId]?.style.strokeWidth ?? 2 : 2; setStyle(kind === 'solid' ? { strokeDashArray: [] } : kind === 'dash' ? { strokeDashArray: [width * 4, width * 3] } : { strokeDashArray: [.01, width * 2.5], strokeLineCap: 'round' }, `${kind} stroke`); }
  function cycleCap() { const cap = selectedId ? document.objects[selectedId]?.style.strokeLineCap : 'butt'; setStyle({ strokeLineCap: cap === 'round' ? 'butt' : 'round' }, 'Stroke cap'); }
  function cycleJoin() { const join = selectedId ? document.objects[selectedId]?.style.strokeLineJoin : 'round'; setStyle({ strokeLineJoin: join === 'round' ? 'miter' : join === 'miter' ? 'bevel' : 'round' }, 'Stroke join'); }
  function beginStyleGesture() { if (!styleGestureBefore) styleGestureBefore = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); }
  function previewStyle(patch: Partial<Style>) { beginStyleGesture(); const objects = { ...document.objects }; for (const id of selectedIds) objects[id] = { ...objects[id], style: { ...objects[id].style, ...patch } }; document = { ...document, objects }; draw(); }
  function commitStyleGesture(label: string) { if (!styleGestureBefore) return; const before = styleGestureBefore, after = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); document = { ...document, objects: { ...document.objects, ...before } }; styleGestureBefore = null; execute(new ReplaceObjectsCommand(before, after, document.order, document.order)); status = label; }
  function reorder(direction: -1 | 1) {
    if (!selectedIds.length) return;const order=[...document.order],selected=new Set(selectedIds),indices=direction>0?Array.from({length:order.length},(_,i)=>order.length-1-i):Array.from({length:order.length},(_,i)=>i);let changed=false;for(const index of indices){if(!selected.has(order[index]))continue;const next=index+direction;if(next<0||next>=order.length||selected.has(order[next]))continue;[order[index],order[next]]=[order[next],order[index]];changed=true;}if(!changed)return;execute(new ReplaceObjectsCommand({}, {}, document.order, order));status=direction>0?'Moved selection forward':'Moved selection backward';
  }
  function rotateSelection() {
    orientedControls = true;
    updateSelected((object) => ({ ...object, transform: transformAround(object, object.transform, objectCenter(object), 1, Math.PI / 2) }), 'Rotated 90°');
  }
  function flipSelection() {
    updateSelected((object) => { const center = objectCenter(object), local = localCenter(object), scaleX = -object.transform.scaleX; return { ...object, transform: { ...object.transform, scaleX, x: center.x - local.x * scaleX } }; }, 'Flipped horizontally');
  }
  function duplicateSelection() {
    if (!selectedIds.length) return; const clonedGroups = new Map<string, string>(); const clones = selectedIds.map((id) => { const source=structuredClone(document.objects[id]),parentId=source.parentId?(clonedGroups.get(source.parentId)??(()=>{const groupId=crypto.randomUUID();clonedGroups.set(source.parentId!,groupId);return groupId;})()):null;return { ...source, id: crypto.randomUUID(), parentId, name: `${source.name} copy`, transform: { ...source.transform, x: source.transform.x + 28, y: source.transform.y + 28 } }; });
    const after = Object.fromEntries(clones.map((object) => [object.id, object])); const order = [...document.order, ...clones.map((object) => object.id)];
    execute(new ReplaceObjectsCommand(Object.fromEntries(clones.map((object) => [object.id, null])), after, document.order, order)); selectedIds = clones.map((object) => object.id); selectedId = selectedIds.at(-1) ?? null; status = 'Duplicated'; draw();
  }
  function deleteSelection() {
    if (!selectedIds.length) return; const before = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])); const after = Object.fromEntries(selectedIds.map((id) => [id, null]));
    execute(new ReplaceObjectsCommand(before, after, document.order, document.order.filter((id) => !selectedIds.includes(id)))); clearSelection(); status = 'Deleted'; draw();
  }
  function groupSelection() { if (selectedIds.length > 1) { const groupId = crypto.randomUUID(); updateSelected((object) => ({ ...object, parentId: groupId }), 'Grouped'); actionsOpen=false; } }
  function ungroupSelection() { updateSelected((object) => ({ ...object, parentId: null }), 'Ungrouped'); actionsOpen=false; }
  function booleanSelection(operation: BooleanOperation) {
    const results=booleanShapes(selectedIds.map((id)=>document.objects[id]).filter(Boolean),operation);if(!results.length){status=`${operation} produced no overlapping artwork`;return;}
    const before=Object.fromEntries(selectedIds.map((id)=>[id,document.objects[id]])),after=Object.fromEntries([...selectedIds.map((id)=>[id,null] as const),...results.map((result)=>[result.id,result] as const)]),first=Math.min(...selectedIds.map((id)=>document.order.indexOf(id))),order=document.order.filter((id)=>!selectedIds.includes(id));order.splice(first,0,...results.map((result)=>result.id));execute(new ReplaceObjectsCommand(before,after,document.order,order));selectedIds=results.map((result)=>result.id);selectedId=selectedIds.at(-1)??null;actionsOpen=false;status=`${results[0].name} created`;draw();
  }

  function editablePath(object:VectorObject):VectorObject {
    if(object.geometry.kind==='path')return object;
    const node=(anchor:{x:number;y:number},incoming:{x:number;y:number}|null=null,outgoing:{x:number;y:number}|null=null):PathNode=>({id:crypto.randomUUID(),anchor,in:incoming,out:outgoing,kind:incoming||outgoing?'symmetric':'corner'});
    if(object.geometry.kind==='rect'){const{width,height}=object.geometry;return{...object,geometry:{kind:'path',closed:true,nodes:[node({x:0,y:0}),node({x:width,y:0}),node({x:width,y:height}),node({x:0,y:height})]}};}
    const{rx,ry}=object.geometry,k=.5522847498;return{...object,geometry:{kind:'path',closed:true,nodes:[node({x:rx,y:0},{x:0,y:-k*ry},{x:0,y:k*ry}),node({x:0,y:ry},{x:k*rx,y:0},{x:-k*rx,y:0}),node({x:-rx,y:0},{x:0,y:k*ry},{x:0,y:-k*ry}),node({x:0,y:-ry},{x:-k*rx,y:0},{x:k*rx,y:0})]}};
  }
  function enterEditMode() { if (!selectedId) return; const before=document.objects[selectedId];if(!before)return;const object=editablePath(before);if(object!==before)execute(new ReplaceObjectsCommand({[before.id]:before},{[object.id]:object},document.order,document.order)); editMode=true;multiMode=false;selectedNodeId=object.geometry.kind==='path'?object.geometry.nodes[0]?.id??null:null;status='Shape Edit';draw(); }
  function exitEditMode() { editMode = false; selectedNodeId = null; status = 'Selection'; draw(); }
  function updatePathNodes(nodes: readonly PathNode[], label: string) {
    if (!selectedId) return; const object = document.objects[selectedId]; if (object.geometry.kind !== 'path') return;
    const after = { ...object, geometry: { ...object.geometry, nodes } };
    execute(new ReplaceObjectsCommand({ [object.id]: object }, { [object.id]: after }, document.order, document.order)); status = label;
  }
  function addNode() {
    if (!selectedId || !selectedSegment) { status = 'Tap a path segment first'; return; } const geometry = document.objects[selectedId].geometry; if (geometry.kind !== 'path') return;
    const id = crypto.randomUUID(), nodes = splitCubicSegment(geometry.nodes, selectedSegment.index, .5, id); selectedNodeId = id; selectedSegment = null; updatePathNodes(nodes, 'Node inserted midway');
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

  function overlayPoint(object: VectorObject, localX: number, localY: number) {
    const center=localCenter(object), worldCenter=objectCenter(object), x=(localX-center.x)*Math.abs(object.transform.scaleX), y=(localY-center.y)*Math.abs(object.transform.scaleY), cos=Math.cos(object.transform.rotation), sin=Math.sin(object.transform.rotation);
    return { x:worldCenter.x+x*cos-y*sin, y:worldCenter.y+x*sin+y*cos };
  }
  function artworkPoints(object:VectorObject){
    if(object.geometry.kind==='rect')return[[0,0],[object.geometry.width,0],[object.geometry.width,object.geometry.height],[0,object.geometry.height]].map(([x,y])=>localToWorld(object,x,y));
    if(object.geometry.kind==='ellipse'){const geometry=object.geometry;return Array.from({length:24},(_,i)=>{const a=i*Math.PI/12;return localToWorld(object,Math.cos(a)*geometry.rx,Math.sin(a)*geometry.ry);});}
    const points:Array<{x:number;y:number}>=[],segments=object.geometry.closed?object.geometry.nodes.length:Math.max(0,object.geometry.nodes.length-1);for(let i=0;i<segments;i+=1){const{p0,p1,p2,p3}=cubicPoints(object.geometry.nodes,i);for(let step=0;step<=12;step+=1){const t=step/12,u=1-t,x=u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,y=u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y;points.push(localToWorld(object,x,y));}}return points;
  }
  function worldBounds(ids = selectedIds) {
    const points = ids.flatMap((id) => { const object = document.objects[id]; return object?artworkPoints(object):[]; });
    if (!points.length) return null; const xs = points.map((p) => p.x), ys = points.map((p) => p.y); const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  function selectionControls() { const padding=8/view.scale,bounds=worldBounds();if(!bounds)return null;let topLeft={x:bounds.x-padding,y:bounds.y-padding},topRight={x:bounds.x+bounds.width+padding,y:bounds.y-padding},bottomLeft={x:bounds.x-padding,y:bounds.y+bounds.height+padding},bottomRight={x:bounds.x+bounds.width+padding,y:bounds.y+bounds.height+padding}; if (selectedIds.length === 1 && selectedId) { const object=document.objects[selectedId],b=localBounds(object),px=padding/Math.max(.08,Math.abs(object.transform.scaleX)),py=padding/Math.max(.08,Math.abs(object.transform.scaleY)),left=b.x-px,right=b.x+b.width+px,top=b.y-py,bottom=b.y+b.height+py,outline=[overlayPoint(object,left,top),overlayPoint(object,right,top),overlayPoint(object,right,bottom),overlayPoint(object,left,bottom)];if(orientedControls){[topLeft,topRight,bottomRight,bottomLeft]=outline;} return {topLeft,topRight,bottomLeft,bottomRight,outline,midpoints:{top:overlayPoint(object,(left+right)/2,top),right:overlayPoint(object,right,(top+bottom)/2),bottom:overlayPoint(object,(left+right)/2,bottom),left:overlayPoint(object,left,(top+bottom)/2)} }; } return {topLeft,topRight,bottomLeft,bottomRight,outline:[topLeft,topRight,bottomRight,bottomLeft],midpoints:{top:{x:bounds.x+bounds.width/2,y:bounds.y-padding},right:{x:bounds.x+bounds.width+padding,y:bounds.y+bounds.height/2},bottom:{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height+padding},left:{x:bounds.x-padding,y:bounds.y+bounds.height/2}}}; }
  function selectionHandle() { return selectionControls()?.bottomRight ?? null; }
  function selectedAt(x: number, y: number) { return selectedIds.some((id) => hitTest(document.objects[id], x, y)); }
  function selectionForObject(id: string) { return expandGroups([id]); }
  function groupedSelection() { return selectedIds.length > 1 && selectedIds.every((id) => document.objects[id]?.parentId && document.objects[id].parentId === document.objects[selectedIds[0]]?.parentId); }
  function snapMove(dx: number, dy: number, bounds = worldBounds()) {
    if (!bounds) return { dx, dy }; const threshold = 10 / view.scale, others = document.order.filter((id) => !selectedIds.includes(id)).map((id) => worldBounds([id])).filter(Boolean) as Array<{x:number;y:number;width:number;height:number}>;
    const xTargets = [0, document.workspace.width / 2, document.workspace.width, ...others.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width])], yTargets = [0, document.workspace.height / 2, document.workspace.height, ...others.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height])];
    const movingX = [bounds.x + dx, bounds.x + bounds.width / 2 + dx, bounds.x + bounds.width + dx], movingY = [bounds.y + dy, bounds.y + bounds.height / 2 + dy, bounds.y + bounds.height + dy];
    let bestX: { delta:number; value:number } | null = null, bestY: { delta:number; value:number } | null = null;
    for (const moving of movingX) for (const target of xTargets) { const delta = target - moving; if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, value: target }; }
    for (const moving of movingY) for (const target of yTargets) { const delta = target - moving; if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, value: target }; }
    guides = [...(bestX ? [{ axis: 'x' as const, value: bestX.value }] : []), ...(bestY ? [{ axis: 'y' as const, value: bestY.value }] : [])]; return { dx: dx + (bestX?.delta ?? 0), dy: dy + (bestY?.delta ?? 0) };
  }
  function normalizedAngle(angle:number){ while(angle>Math.PI)angle-=Math.PI*2;while(angle<-Math.PI)angle+=Math.PI*2;return angle; }
  function straightEdgeAngles(object:VectorObject){ if(object.geometry.kind==='ellipse')return[]; if(object.geometry.kind==='rect')return[0,Math.PI/2]; const nodes=object.geometry.nodes, result:number[]=[]; for(let i=0;i<(object.geometry.closed?nodes.length:nodes.length-1);i+=1){const a=nodes[i],b=nodes[(i+1)%nodes.length];if(!a.out&&!b.in)result.push(Math.atan2((b.anchor.y-a.anchor.y)*Math.sign(object.transform.scaleY),(b.anchor.x-a.anchor.x)*Math.sign(object.transform.scaleX)));}return result; }
  function snappedRotation(object:VectorObject,raw:number){const threshold=Math.PI/60, cardinal=[0,Math.PI/2,Math.PI,-Math.PI/2], common=Array.from({length:12},(_,i)=>i*Math.PI/6); for(const targets of [cardinal,common])for(const edge of straightEdgeAngles(object))for(const target of targets){const correction=normalizedAngle(target-(raw+edge));if(Math.abs(correction)<threshold)return raw+correction;} const canonical=Math.round(raw/(Math.PI/12))*Math.PI/12;return Math.abs(normalizedAngle(canonical-raw))<threshold?canonical:raw;}
  function resizeFromMidpoint(object:VectorObject,before:Transform,edge:Edge,world:{x:number;y:number}){
    const source={...object,transform:before},b=localBounds(source),local=localCenter(source),center=objectCenter(source),cos=Math.cos(before.rotation),sin=Math.sin(before.rotation),axis=(edge==='left'||edge==='right')?{x:cos,y:sin}:{x:-sin,y:cos},direction=(edge==='left'||edge==='top')?-1:1,dimension=(edge==='left'||edge==='right')?b.width:b.height,sign=(edge==='left'||edge==='right')?Math.sign(before.scaleX)||1:Math.sign(before.scaleY)||1;
    const oldScale=Math.abs(edge==='left'||edge==='right'?before.scaleX:before.scaleY),opposite={x:center.x-axis.x*direction*oldScale*dimension/2,y:center.y-axis.y*direction*oldScale*dimension/2};
    const extent=resizeMode==='symmetric'?2*((world.x-center.x)*axis.x*direction+(world.y-center.y)*axis.y*direction):(world.x-opposite.x)*axis.x*direction+(world.y-opposite.y)*axis.y*direction,scale=Math.max(.08,Math.max(1,extent)/Math.max(1,dimension));
    let desired=center;if(resizeMode==='edge'){desired={x:opposite.x+axis.x*direction*scale*dimension/2,y:opposite.y+axis.y*direction*scale*dimension/2};}
    const scaleX=edge==='left'||edge==='right'?sign*scale:before.scaleX,scaleY=edge==='top'||edge==='bottom'?sign*scale:before.scaleY;return{...before,scaleX,scaleY,x:desired.x-local.x*scaleX,y:desired.y-local.y*scaleY};
  }

  function applyObjectTransform(ctx: CanvasRenderingContext2D, object: VectorObject) {
    const center = localCenter(object), worldCenter = objectCenter(object);
    ctx.translate(worldCenter.x, worldCenter.y); ctx.rotate(object.transform.rotation); ctx.scale(object.transform.scaleX, object.transform.scaleY); ctx.translate(-center.x, -center.y);
  }

  function drawEditorOverlay(ctx:CanvasRenderingContext2D){
    if(lasso){const x=Math.min(lasso.start.x,lasso.current.x),y=Math.min(lasso.start.y,lasso.current.y),width=Math.abs(lasso.current.x-lasso.start.x),height=Math.abs(lasso.current.y-lasso.start.y);ctx.save();ctx.fillStyle='rgba(70,70,70,.08)';ctx.strokeStyle='#555';ctx.lineWidth=1.5/view.scale;ctx.setLineDash([6/view.scale,4/view.scale]);ctx.fillRect(x,y,width,height);ctx.strokeRect(x,y,width,height);ctx.restore();}
    if(!selectedIds.length)return;
    if(selectedIds.length>1){
      for(const id of selectedIds){const object=document.objects[id];if(!object)continue;ctx.save();applyObjectTransform(ctx,object);ctx.beginPath();if(object.geometry.kind==='rect')ctx.roundRect(0,0,object.geometry.width,object.geometry.height,object.geometry.radius);else if(object.geometry.kind==='ellipse')ctx.ellipse(0,0,object.geometry.rx,object.geometry.ry,0,0,Math.PI*2);else tracePath(ctx,object);ctx.restore();ctx.save();ctx.strokeStyle='rgba(60,60,60,.8)';ctx.lineWidth=5/view.scale;ctx.globalAlpha=.28;ctx.setLineDash([]);ctx.stroke();ctx.restore();}
      const b=worldBounds(),controls=selectionControls();if(b&&controls){const p=8/view.scale;ctx.save();ctx.strokeStyle='#666';ctx.lineWidth=1/view.scale;ctx.setLineDash([4/view.scale,4/view.scale]);ctx.strokeRect(b.x-p,b.y-p,b.width+2*p,b.height+2*p);ctx.setLineDash([]);ctx.lineWidth=2/view.scale;ctx.fillStyle='#f4f1ea';ctx.strokeStyle='#111';const square=20/view.scale;for(const point of [controls.topLeft,controls.topRight]){ctx.fillRect(point.x-square/2,point.y-square/2,square,square);ctx.strokeRect(point.x-square/2,point.y-square/2,square,square);}for(const point of [controls.bottomLeft,controls.bottomRight]){ctx.beginPath();ctx.arc(point.x,point.y,10/view.scale,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.fillStyle='#111';ctx.beginPath();ctx.arc(controls.bottomRight.x,controls.bottomRight.y,4/view.scale,0,Math.PI*2);ctx.fill();ctx.restore();}
      return;
    }
    if(!selectedId)return;const object=document.objects[selectedId];if(!object)return;
    if(editMode&&object.geometry.kind==='path'){ctx.save();ctx.setLineDash([]);ctx.lineWidth=1/view.scale;ctx.strokeStyle='#666';if(selectedSegment){const{p0,p1,p2,p3}=cubicPoints(object.geometry.nodes,selectedSegment.index),a=localToWorld(object,p0.x,p0.y),b1=localToWorld(object,p1.x,p1.y),b2=localToWorld(object,p2.x,p2.y),d=localToWorld(object,p3.x,p3.y);ctx.strokeStyle='#d22';ctx.lineWidth=4/view.scale;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.bezierCurveTo(b1.x,b1.y,b2.x,b2.y,d.x,d.y);ctx.stroke();ctx.strokeStyle='#666';ctx.lineWidth=1.5/view.scale;}for(const node of object.geometry.nodes){const anchor=localToWorld(object,node.anchor.x,node.anchor.y),isSelected=node.id===selectedNodeId;if(isSelected)for(const part of ['in','out'] as const){const h=node[part];if(!h)continue;const control=localToWorld(object,node.anchor.x+h.x,node.anchor.y+h.y);ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.lineTo(control.x,control.y);ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(control.x,control.y,5/view.scale,0,Math.PI*2);ctx.fill();ctx.stroke();}const radius=(isSelected?5:4)/view.scale;ctx.fillStyle=isSelected?'#d22':'#fff';ctx.strokeStyle=isSelected?'#d22':'#666';ctx.beginPath();ctx.arc(anchor.x,anchor.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.restore();return;}
    const controls=selectionControls();if(!controls)return;ctx.save();ctx.strokeStyle='#666';ctx.lineWidth=1/view.scale;ctx.setLineDash([4/view.scale,4/view.scale]);ctx.beginPath();ctx.moveTo(controls.outline[0].x,controls.outline[0].y);for(const point of controls.outline.slice(1))ctx.lineTo(point.x,point.y);ctx.closePath();ctx.stroke();ctx.setLineDash([]);ctx.lineWidth=2/view.scale;ctx.fillStyle='#f4f1ea';ctx.strokeStyle='#111';const square=20/view.scale;for(const point of [controls.topLeft,controls.topRight]){ctx.fillRect(point.x-square/2,point.y-square/2,square,square);ctx.strokeRect(point.x-square/2,point.y-square/2,square,square);}if(resizeMode==='symmetric'){ctx.beginPath();ctx.moveTo(controls.topLeft.x-square*.3,controls.topLeft.y);ctx.lineTo(controls.topLeft.x+square*.3,controls.topLeft.y);ctx.moveTo(controls.topLeft.x,controls.topLeft.y-square*.3);ctx.lineTo(controls.topLeft.x,controls.topLeft.y+square*.3);ctx.stroke();}else{ctx.fillStyle='#111';ctx.fillRect(controls.topLeft.x-square*.22,controls.topLeft.y-square*.22,square*.44,square*.44);ctx.fillStyle='#f4f1ea';}const nodeRadius=3.5/view.scale;ctx.beginPath();ctx.arc(controls.topRight.x,controls.topRight.y,nodeRadius,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(controls.topRight.x-square*.28,controls.topRight.y-square*.28);ctx.lineTo(controls.topRight.x+square*.28,controls.topRight.y+square*.28);ctx.stroke();for(const point of [controls.bottomLeft,controls.bottomRight]){ctx.beginPath();ctx.arc(point.x,point.y,10/view.scale,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.fillStyle='#111';ctx.beginPath();ctx.arc(controls.bottomRight.x,controls.bottomRight.y,4/view.scale,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(controls.bottomLeft.x,controls.bottomLeft.y,2.5/view.scale,0,Math.PI*2);ctx.fill();const size=7/view.scale;ctx.fillStyle='#f4f1ea';for(const point of Object.values(controls.midpoints)){ctx.fillRect(point.x-size/2,point.y-size/2,size,size);ctx.strokeRect(point.x-size/2,point.y-size/2,size,size);}ctx.restore();
  }

  function draw() {
    cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const started = performance.now(), ctx = canvas?.getContext('2d'); if (!ctx) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2), width = canvas.width / ratio, height = canvas.height / ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#d9d6cf'; ctx.fillRect(0, 0, width, height);
      ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale); ctx.fillStyle = document.workspace.background; ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = 28 / view.scale; ctx.fillRect(0, 0, document.workspace.width, document.workspace.height); ctx.shadowColor = 'transparent';
      for (const id of document.order) {
        const object = document.objects[id]; if (!object?.visible) continue;
        ctx.save(); applyObjectTransform(ctx, object); ctx.beginPath();
        if (object.geometry.kind === 'rect') ctx.roundRect(0, 0, object.geometry.width, object.geometry.height, object.geometry.radius); else if (object.geometry.kind === 'ellipse') ctx.ellipse(0, 0, object.geometry.rx, object.geometry.ry, 0, 0, Math.PI * 2); else tracePath(ctx, object);
        ctx.restore(); ctx.save(); ctx.fillStyle = object.style.fill; ctx.strokeStyle = object.style.strokeColor; ctx.lineWidth = object.style.strokeWidth; ctx.lineCap = object.style.strokeLineCap; ctx.lineJoin = object.style.strokeLineJoin; ctx.miterLimit = object.style.strokeMiterLimit; ctx.setLineDash([...object.style.strokeDashArray]);
        if (object.style.fillEnabled) { ctx.globalAlpha = object.style.opacity * object.style.fillOpacity; ctx.fill(); } if (object.style.strokeEnabled) { ctx.globalAlpha = object.style.opacity * object.style.strokeOpacity; ctx.stroke(); } ctx.restore();
      }
      if (guides.length) { ctx.save(); ctx.strokeStyle = '#777'; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 4 / view.scale]); for (const guide of guides) { ctx.beginPath(); if (guide.axis === 'x') { ctx.moveTo(guide.value, 0); ctx.lineTo(guide.value, document.workspace.height); } else { ctx.moveTo(0, guide.value); ctx.lineTo(document.workspace.width, guide.value); } ctx.stroke(); } ctx.restore(); }
      drawEditorOverlay(ctx);
      ctx.restore(); renderMs = performance.now() - started;
    });
  }

  const screenToWorld = (x: number, y: number) => ({ x: (x - view.x) / view.scale, y: (y - view.y) / view.scale });
  function cancelObjectInteraction() { if (nodeDrag) { replaceNode(nodeDrag.objectId,nodeDrag.nodeId,()=>nodeDrag!.before); nodeDrag=null; } if (drag) { if (drag.beforeSelection) { const objects={...document.objects}; for(const id of Object.keys(drag.beforeSelection)) objects[id]={...objects[id],transform:drag.beforeSelection[id]}; document={...document,objects}; } else { const object=document.objects[drag.id]; if(object) document={...document,objects:{...document.objects,[drag.id]:{...object,transform:drag.before}}}; } drag=null; } guides=[]; draw(); }
  function pointerDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) { window.clearTimeout(longPressTimer); pressStart = null; lasso=null; cancelObjectInteraction(); const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect(), midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); pinch = { distance, scale: view.scale, anchorX: (midpoint.x - view.x) / view.scale, anchorY: (midpoint.y - view.y) / view.scale }; pan = null; return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (editMode && selectedId) {
      const object = document.objects[selectedId]; if (object?.geometry.kind === 'path') { const local = worldToLocal(object, world.x, world.y), radius = 22 / (view.scale * Math.max(.08, Math.min(Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY))));
        for (const node of [...object.geometry.nodes].reverse()) { if (node.id === selectedNodeId) for (const part of ['in', 'out'] as const) { const h = node[part]; if (h && Math.hypot(local.x - node.anchor.x - h.x, local.y - node.anchor.y - h.y) <= radius) { nodeDrag = { objectId: object.id, nodeId: node.id, part, before: node }; return; } } if (Math.hypot(local.x - node.anchor.x, local.y - node.anchor.y) <= radius) { selectedNodeId = node.id; nodeDrag = { objectId: object.id, nodeId: node.id, part: 'anchor', before: node }; draw(); return; } }
        let closest: { index:number; t:number; distance:number } | null = null; const segments = object.geometry.closed ? object.geometry.nodes.length : object.geometry.nodes.length - 1; for (let index = 0; index < segments; index += 1) { const candidate = nearestCubicPoint(object.geometry.nodes, index, local); if (!closest || candidate.distance < closest.distance) closest = { index, ...candidate }; } if (closest && closest.distance <= radius) { selectedSegment = { index: closest.index, t: closest.t }; selectedNodeId = null; status = 'Segment selected'; draw(); return; }
      }
      if(editMode)return;
    }
    if (!editMode && selectedId) {
      const selectedObject=document.objects[selectedId],bounds=worldBounds()!,origin=selectedIds.length===1?objectCenter(selectedObject):{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2},controls=selectionControls();
      if(controls&&selectedIds.length===1&&Math.hypot(world.x-controls.topRight.x,world.y-controls.topRight.y)<=22/view.scale){enterEditMode();return;}
      if(controls&&Math.hypot(world.x-controls.bottomLeft.x,world.y-controls.bottomLeft.y)<=24/view.scale){actionsOpen=!actionsOpen;status=actionsOpen?'Selection actions':'Selection';draw();return;}
      if(controls&&selectedIds.length===1&&Math.hypot(world.x-controls.topLeft.x,world.y-controls.topLeft.y)<=22/view.scale){drag={id:selectedId,kind:'dimension',before:selectedObject.transform,pivot:origin,startWorldX:world.x,startWorldY:world.y,moved:false};return;}
      if(controls&&selectedIds.length===1)for(const edge of ['top','right','bottom','left'] as const)if(Math.hypot(world.x-controls.midpoints[edge].x,world.y-controls.midpoints[edge].y)<=20/view.scale){drag={id:selectedId,kind:'dimension',before:selectedObject.transform,pivot:origin,startWorldX:world.x,startWorldY:world.y,edge,moved:false};return;}
      const handle=selectionHandle();if(handle&&Math.hypot(world.x-handle.x,world.y-handle.y)<=26/view.scale){orientedControls=true;drag={id:selectedId,kind:'primary',before:selectedObject.transform,beforeSelection:Object.fromEntries(selectedIds.map((id)=>[id,document.objects[id].transform])),pivot:origin,startWorldX:world.x,startWorldY:world.y,startDistance:Math.max(1,Math.hypot(world.x-origin.x,world.y-origin.y)),startAngle:Math.atan2(world.y-origin.y,world.x-origin.x),moved:false};return;}
    }
    const hit = [...document.order].reverse().find((id) => hitTest(document.objects[id], world.x, world.y)) ?? null;
    if (hit) { pressStart = { x: event.clientX, y: event.clientY, id: hit }; window.clearTimeout(longPressTimer); longPressTimer = window.setTimeout(() => { multiMode = true; actionsOpen=false; orientedControls=false; if (!selectedIds.includes(hit)) selectedIds = selectionForObject(hit); selectedId = hit; drag = null; pressStart = null; status = 'Multi-select · tap shapes · Done'; draw(); }, 450); if (multiMode || event.shiftKey) { const hitSelection=selectionForObject(hit),remove=hitSelection.every((id)=>selectedIds.includes(id));selectedIds=remove?selectedIds.filter((id)=>!hitSelection.includes(id)):expandGroups([...selectedIds,...hitSelection]); selectedId = selectedIds.at(-1) ?? null; actionsOpen=false; orientedControls=false; draw(); } else { const selection = selectionForObject(hit); if (!selectedIds.includes(hit)){ selectedIds = selection; actionsOpen=false; orientedControls=false; } selectedId = hit; selectedNodeId = null; drag = { id: hit, kind: 'move', before: document.objects[hit].transform, beforeSelection: Object.fromEntries(selectedIds.map((id) => [id, document.objects[id].transform])), baseBounds: worldBounds() ?? undefined, startWorldX: world.x, startWorldY: world.y }; draw(); } }
    else { pressStart={x:event.clientX,y:event.clientY,id:null};pan={x:event.clientX,y:event.clientY,viewX:view.x,viewY:view.y,moved:false};window.clearTimeout(longPressTimer);longPressTimer=window.setTimeout(()=>{if(pressStart?.id!==null)return;const canvasRect=canvas.getBoundingClientRect(),start=screenToWorld(pressStart.x-canvasRect.left,pressStart.y-canvasRect.top);lasso={start,current:start};pan=null;pressStart=null;status='Drag to select';draw();},450);draw(); }
  }
  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 8) { window.clearTimeout(longPressTimer); pressStart = null; }
    if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect(), midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }; view = zoomFromAnchor({ x: pinch.anchorX, y: pinch.anchorY }, midpoint, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance); viewWasAdjusted = true; draw(); return; }
    if(lasso){const rect=canvas.getBoundingClientRect();lasso={...lasso,current:screenToWorld(event.clientX-rect.left,event.clientY-rect.top)};draw();return;}
    if (pan) { if(Math.hypot(event.clientX-pan.x,event.clientY-pan.y)>4)pan.moved=true; view = { ...view, x: pan.viewX + event.clientX - pan.x, y: pan.viewY + event.clientY - pan.y }; viewWasAdjusted = true; draw(); return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (nodeDrag) { const object = document.objects[nodeDrag.objectId], local = worldToLocal(object, world.x, world.y); replaceNode(nodeDrag.objectId, nodeDrag.nodeId, (node) => { if (nodeDrag?.part === 'anchor') { const threshold = 8 / (view.scale * Math.max(.08, Math.min(Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY)))), others = object.geometry.kind === 'path' ? object.geometry.nodes.filter((candidate) => candidate.id !== node.id) : []; let x = local.x, y = local.y; const nearX = others.find((candidate) => Math.abs(candidate.anchor.x - x) <= threshold), nearY = others.find((candidate) => Math.abs(candidate.anchor.y - y) <= threshold); if (nearX) x = nearX.anchor.x; if (nearY) y = nearY.anchor.y; guides = [...(nearX ? [{ axis: 'x' as const, value: localToWorld(object, x, y).x }] : []), ...(nearY ? [{ axis: 'y' as const, value: localToWorld(object, x, y).y }] : [])]; return { ...node, anchor: { x, y } }; } const part = nodeDrag!.part, vector = { x: local.x - node.anchor.x, y: local.y - node.anchor.y }; if (node.kind === 'independent' || node.kind === 'corner') return { ...node, [part]: vector }; const opposite = part === 'in' ? 'out' : 'in', oldOpposite = node[opposite], length = node.kind === 'symmetric' ? Math.hypot(vector.x, vector.y) : Math.hypot(oldOpposite?.x ?? -vector.x, oldOpposite?.y ?? -vector.y), vectorLength = Math.max(.001, Math.hypot(vector.x, vector.y)); return { ...node, [part]: vector, [opposite]: { x: -vector.x / vectorLength * length, y: -vector.y / vectorLength * length } }; }); draw(); return; }
    if (drag) { const object = document.objects[drag.id]; let transform: Transform;
      if(drag.kind==='dimension'&&!drag.edge)return;
      if (drag.kind === 'move') { const snappedMove = snapMove(world.x - drag.startWorldX, world.y - drag.startWorldY, drag.baseBounds); if (drag.beforeSelection && selectedIds.length > 1) { const objects = { ...document.objects }; for (const id of selectedIds) { const before = drag.beforeSelection[id]; objects[id] = { ...objects[id], transform: { ...before, x: before.x + snappedMove.dx, y: before.y + snappedMove.dy } }; } document = { ...document, objects }; drag.moved = true; draw(); return; } transform = { ...drag.before, x: drag.before.x + snappedMove.dx, y: drag.before.y + snappedMove.dy }; drag.moved = true; }
      else { const pivot=drag.pivot??objectCenter({...object,transform:drag.before}),dx=world.x-pivot.x,dy=world.y-pivot.y;drag.moved=drag.moved||Math.hypot(world.x-drag.startWorldX,world.y-drag.startWorldY)>3/view.scale;if(drag.kind==='dimension'&&drag.edge){transform=resizeFromMidpoint(object,drag.before,drag.edge,world);}else{const factor=Math.max(.08,Math.hypot(dx,dy)/(drag.startDistance??1)),rawRotation=drag.before.rotation+Math.atan2(dy,dx)-(drag.startAngle??0),rotationDelta=snappedRotation({...object,transform:drag.before},rawRotation)-drag.before.rotation;if(drag.beforeSelection&&selectedIds.length>1){const objects={...document.objects};for(const id of selectedIds)objects[id]={...objects[id],transform:transformAround(objects[id],drag.beforeSelection[id],pivot,factor,rotationDelta)};document={...document,objects};draw();return;}transform=transformAround(object,drag.before,pivot,factor,rotationDelta);}}
      document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform } } }; draw();
    }
  }
  function pointerUp(event: PointerEvent) {
    window.clearTimeout(longPressTimer); pressStart = null; pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; const finishedPan=pan,finishedLasso=lasso; pan = null;lasso=null;guides = [];if(finishedLasso){const x=Math.min(finishedLasso.start.x,finishedLasso.current.x),y=Math.min(finishedLasso.start.y,finishedLasso.current.y),right=Math.max(finishedLasso.start.x,finishedLasso.current.x),bottom=Math.max(finishedLasso.start.y,finishedLasso.current.y);selectedIds=expandGroups(document.order.filter((id)=>{const b=worldBounds([id]);return b&&b.x+b.width>=x&&b.x<=right&&b.y+b.height>=y&&b.y<=bottom;}));selectedId=selectedIds.at(-1)??null;multiMode=selectedIds.length>1;orientedControls=false;status=selectedIds.length?`${selectedIds.length} selected`:'No objects selected';draw();return;} if(finishedPan&&!finishedPan.moved&&pointers.size===0&&!multiMode)clearSelection();
    if (nodeDrag) { const object = document.objects[nodeDrag.objectId], after = object.geometry.kind === 'path' ? object.geometry.nodes.find((node) => node.id === nodeDrag?.nodeId) : undefined; if (after && JSON.stringify(after) !== JSON.stringify(nodeDrag.before)) { const before = nodeDrag.before; replaceNode(nodeDrag.objectId, nodeDrag.nodeId, () => before); execute(new MovePathNodeCommand(nodeDrag.objectId, nodeDrag.nodeId, before, after)); } nodeDrag = null; }
    if (drag) { if(drag.kind==='dimension'&&!drag.edge&&!drag.moved){resizeMode=resizeMode==='symmetric'?'edge':'symmetric';status=resizeMode==='symmetric'?'Symmetric resize':'Single-edge resize';draw();drag=null;return;} if (drag.beforeSelection && selectedIds.length > 1) { const after = Object.fromEntries(selectedIds.map((id) => [id, document.objects[id]])), before = Object.fromEntries(selectedIds.map((id) => [id, { ...document.objects[id], transform: drag!.beforeSelection![id] }])); document = { ...document, objects: { ...document.objects, ...before } }; execute(new ReplaceObjectsCommand(before, after, document.order, document.order)); } else { const object = document.objects[drag.id]; if (JSON.stringify(object.transform) !== JSON.stringify(drag.before)) { const after = object.transform; document = { ...document, objects: { ...document.objects, [drag.id]: { ...object, transform: drag.before } } }; execute(new TransformObjectCommand(drag.id, drag.before, after)); } } drag = null; }
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

    {#if !selectedId}
      <nav class="creation-dock" aria-label="Add shapes"><button on:click={() => addShape('triangle')} aria-label="Add triangle">▲</button><button on:click={() => addShape('rectangle')} aria-label="Add rectangle">■</button><button on:click={() => addShape('ellipse')} aria-label="Add ellipse">●</button><i></i><button on:click={() => multiMode = !multiMode} class:active={multiMode} aria-label="Multi-select">⊕</button><button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button><button aria-label="Export SVG" on:click={exportSvg}>SVG</button><button class="more" aria-label="Export project backup" on:click={exportProject}>•••</button></nav>
    {:else if editMode}
      <nav class="context-dock edit-dock" aria-label="Shape Edit controls"><button class="done" on:click={exitEditMode}>Done</button><button on:click={addNode} aria-label="Insert node on selected segment" disabled={!selectedSegment}>＋</button><button on:click={() => setNodeKind('corner')} aria-label="Corner node" disabled={!selectedNodeId}>◆</button><button on:click={() => setNodeKind('smooth')} aria-label="Smooth node" disabled={!selectedNodeId}>⌒</button><button on:click={() => setNodeKind('symmetric')} aria-label="Symmetric node" disabled={!selectedNodeId}>↔</button><button on:click={() => setNodeKind('independent')} aria-label="Independent node" disabled={!selectedNodeId}>◇</button><button on:click={deleteNode} aria-label="Delete node" disabled={!selectedNodeId}>−</button><button on:click={undo} disabled={!history.canUndo} aria-label="Undo">↶</button></nav>
    {:else if !toolsVisible}
      <button class="show-tools" on:click={() => toolsVisible = true} aria-label="Show selection tools">Tools</button>
    {:else}
      <nav class={styleMode ? 'context-dock style-dock' : actionsOpen ? 'context-dock' : 'context-dock object-dock'} aria-label={styleMode ? 'Fill and Stroke' : 'Object actions'}>
        {#if styleMode && selectedIds.length > 0}
          <button class="done" on:click={() => styleMode = false}>Done</button>
          <label class="toggle"><input type="checkbox" checked={document.objects[selectedId]?.style.fillEnabled} on:change={(event) => setStyle({ fillEnabled: event.currentTarget.checked }, event.currentTarget.checked ? 'Fill on' : 'Fill off')} />Fill</label>
          {#if document.objects[selectedId]?.style.fillEnabled}<input class="colour" aria-label="Fill colour" type="color" value={document.objects[selectedId]?.style.fill} on:change={(event) => setStyle({ fill: event.currentTarget.value }, 'Fill colour')} />{/if}
          {#if document.objects[selectedId]?.style.fillEnabled}<label>Fill α <input aria-label="Fill opacity" type="range" min="0" max="1" step=".05" value={document.objects[selectedId]?.style.fillOpacity} on:pointerdown={beginStyleGesture} on:input={(event) => previewStyle({ fillOpacity: Number(event.currentTarget.value) })} on:change={() => commitStyleGesture('Fill opacity')} /></label>{/if}
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
          <label>Opacity <input aria-label="Object opacity" type="range" min=".05" max="1" step=".05" value={document.objects[selectedId]?.style.opacity ?? 1} on:pointerdown={beginStyleGesture} on:input={(event) => previewStyle({ opacity: Number(event.currentTarget.value) })} on:change={() => commitStyleGesture('Object opacity')} /></label>
        {:else}
        {#if actionsOpen}
          {#if selectedIds.length > 1 && !groupedSelection()}<button on:click={groupSelection}>Group</button>{/if}
          {#if selectedIds.length > 1}<button on:click={() => booleanSelection('union')}>Combine</button><button on:click={() => booleanSelection('difference')}>Cut Out</button><button on:click={() => booleanSelection('intersect')}>Intersect</button>{/if}
          {#if groupedSelection()}<button on:click={ungroupSelection}>Ungroup</button>{/if}
        {:else}
          <button class="tool-button" on:click={() => { toolsVisible=false; helpOpen=false; }} aria-label="Hide selection tools"><span>—</span><small>Hide</small></button>
          <button class="tool-button" class:active={helpOpen} on:click={() => helpOpen=!helpOpen} aria-label="Selection help"><span>?</span><small>Help</small></button>
          <button class="tool-button" on:click={flipSelection} aria-label="Mirror or flip horizontally"><span>◫</span><small>Flip</small></button>
          <button class="tool-button" on:click={deleteSelection} aria-label="Delete"><span>×</span><small>Delete</small></button>
          <button class="tool-button" on:click={duplicateSelection} aria-label="Duplicate"><span>▣</span><small>Duplicate</small></button>
          <button class="tool-button" on:click={rotateSelection} aria-label="Rotate 90 degrees"><span>↻</span><small>Rotate</small></button>
          <div class="layer-tools" aria-label="Layer order"><button on:click={() => reorder(1)} aria-label="Move forward"><span>▰</span><small>Front</small></button><button on:click={() => reorder(-1)} aria-label="Move backward"><span>▱</span><small>Back</small></button></div>
          <button class="tool-button" on:click={() => styleMode = true} aria-label="Fill and stroke"><span>◐</span><small>Style</small></button>
          {#if multiMode}<button class="tool-button active" on:click={() => { multiMode = false; status = 'Selection'; }}><span>✓</span><small>Done</small></button>{:else}<button class="tool-button" on:click={() => multiMode = true} aria-label="Add to selection"><span>⊕</span><small>Select</small></button>{/if}
        {/if}
        {/if}
      </nav>
      {#if helpOpen}<aside class="selection-help"><strong>Selection tools</strong><span>Drag the shape to move it. Use the four corner controls to resize, edit nodes, open shape operations, or freely rotate and scale.</span></aside>{/if}
    {/if}

    {#if debugMode}<aside class="benchmark"><span>{document.order.length.toLocaleString()} · {renderMs.toFixed(1)}ms</span><button on:click={() => stress('500')}>500</button><button on:click={() => stress('2500')}>2.5K</button><button on:click={() => stress('5000')}>5K</button><button on:click={() => stress('curves')}>500⌁</button><button on:click={() => stress('nodes')}>1K nodes</button></aside>{/if}
  </section>
</main>
