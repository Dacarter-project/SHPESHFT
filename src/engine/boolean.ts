import { defaultStyle, identityTransform, type PathNode, type VectorObject } from '../core/document';
import { cubicPoints } from './bezier';
import { localToWorld } from './geometry';
import polygonClipping from 'polygon-clipping';

type Cell = { x0: number; x1: number; y0: number; y1: number };
type Edge = { from: [number, number]; to: [number, number] };

const key = ([x, y]: [number, number]) => `${x},${y}`;

export type BooleanOperation = 'union' | 'difference' | 'intersect';

function outline(object:VectorObject):polygonClipping.Polygon {
  const points:polygonClipping.Pair[]=[];
  if(object.geometry.kind==='rect')for(const [x,y] of [[0,0],[object.geometry.width,0],[object.geometry.width,object.geometry.height],[0,object.geometry.height]] as const){const point=localToWorld(object,x,y);points.push([point.x,point.y]);}
  else if(object.geometry.kind==='ellipse')for(let index=0;index<48;index+=1){const angle=index*Math.PI/24,point=localToWorld(object,Math.cos(angle)*object.geometry.rx,Math.sin(angle)*object.geometry.ry);points.push([point.x,point.y]);}
  else {const segments=object.geometry.closed?object.geometry.nodes.length:Math.max(0,object.geometry.nodes.length-1);for(let index=0;index<segments;index+=1){const{p0,p1,p2,p3}=cubicPoints(object.geometry.nodes,index);for(let step=0;step<16;step+=1){const t=step/16,u=1-t,point=localToWorld(object,u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y);points.push([point.x,point.y]);}}}
  if(points.length)points.push([...points[0]] as polygonClipping.Pair);return[points];
}

/** Boolean geometry for any closed SHPESHFT artwork outline, returned as editable paths. */
export function booleanShapes(objects:readonly VectorObject[],operation:BooleanOperation):VectorObject[]{
  if(objects.length<2)return[];const polygons=objects.map(outline);let result:polygonClipping.MultiPolygon;
  try{result=operation==='union'?polygonClipping.union(polygons[0],...polygons.slice(1)):operation==='difference'?polygonClipping.difference(polygons[0],...polygons.slice(1)):polygonClipping.intersection(polygons[0],...polygons.slice(1));}catch{return[];}
  return result.flatMap((polygon,polygonIndex)=>{const ring=polygon[0];if(!ring||ring.length<4)return[];const points=ring.slice(0,-1),nodes:PathNode[]=points.map(([x,y])=>({id:crypto.randomUUID(),anchor:{x,y},in:null,out:null,kind:'corner'}));return[{id:crypto.randomUUID(),name:`${operation==='union'?'Combine':operation==='difference'?'Cut Out':'Intersect'}${result.length>1?` ${polygonIndex+1}`:''}`,geometry:{kind:'path' as const,closed:true,nodes},transform:identityTransform(),style:{...objects[0].style},visible:true,locked:false,parentId:null}];});
}

/** Exact Boolean geometry for compatible unrotated rectangles, committed as an editable outline. */
export function booleanRectangles(objects: readonly VectorObject[], operation: BooleanOperation): VectorObject | null {
  if (objects.length < 2 || objects.some((object) => object.geometry.kind !== 'rect' || object.transform.rotation !== 0)) return null;
  const rectangles = objects.map((object) => {
    if (object.geometry.kind !== 'rect') throw new Error('Expected rectangle');
    const x0 = object.transform.x, y0 = object.transform.y;
    return { x0, y0, x1: x0 + object.geometry.width * object.transform.scaleX, y1: y0 + object.geometry.height * object.transform.scaleY };
  });
  const xs = [...new Set(rectangles.flatMap((rect) => [rect.x0, rect.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rectangles.flatMap((rect) => [rect.y0, rect.y1]))].sort((a, b) => a - b);
  const filled = new Set<string>(); const cells: Cell[] = [];
  for (let y = 0; y < ys.length - 1; y += 1) for (let x = 0; x < xs.length - 1; x += 1) {
    const cell = { x0: xs[x], x1: xs[x + 1], y0: ys[y], y1: ys[y + 1] };
    const cx = (cell.x0 + cell.x1) / 2, cy = (cell.y0 + cell.y1) / 2;
    const inside = rectangles.map((rect) => cx >= rect.x0 && cx <= rect.x1 && cy >= rect.y0 && cy <= rect.y1);
    const include = operation === 'union' ? inside.some(Boolean) : operation === 'intersect' ? inside.every(Boolean) : inside[0] && !inside.slice(1).some(Boolean);
    if (include) { filled.add(`${x}:${y}`); cells.push(cell); }
  }
  const edges: Edge[] = [];
  for (let y = 0; y < ys.length - 1; y += 1) for (let x = 0; x < xs.length - 1; x += 1) if (filled.has(`${x}:${y}`)) {
    const c = { x0: xs[x], x1: xs[x + 1], y0: ys[y], y1: ys[y + 1] };
    if (!filled.has(`${x}:${y - 1}`)) edges.push({ from: [c.x0, c.y0], to: [c.x1, c.y0] });
    if (!filled.has(`${x + 1}:${y}`)) edges.push({ from: [c.x1, c.y0], to: [c.x1, c.y1] });
    if (!filled.has(`${x}:${y + 1}`)) edges.push({ from: [c.x1, c.y1], to: [c.x0, c.y1] });
    if (!filled.has(`${x - 1}:${y}`)) edges.push({ from: [c.x0, c.y1], to: [c.x0, c.y0] });
  }
  if (!edges.length) return null;
  const ordered: Edge[] = [edges.shift()!];
  while (edges.length) {
    const nextIndex = edges.findIndex((edge) => key(edge.from) === key(ordered.at(-1)!.to));
    if (nextIndex < 0) return null; ordered.push(edges.splice(nextIndex, 1)[0]);
  }
  const raw = ordered.map((edge) => edge.from);
  const corners = raw.filter((point, index) => {
    const previous = raw[(index - 1 + raw.length) % raw.length], next = raw[(index + 1) % raw.length];
    return !((previous[0] === point[0] && point[0] === next[0]) || (previous[1] === point[1] && point[1] === next[1]));
  });
  const nodes: PathNode[] = corners.map(([x, y]) => ({ id: crypto.randomUUID(), anchor: { x, y }, in: null, out: null, kind: 'corner' }));
  return {
    id: crypto.randomUUID(), name: operation === 'union' ? 'Combine' : operation === 'difference' ? 'Cut Out' : 'Intersect', geometry: { kind: 'path', closed: true, nodes }, transform: identityTransform(),
    style: defaultStyle(objects[0].style.fill), visible: true, locked: false, parentId: null
  };
}

export const unionRectangles = (objects: readonly VectorObject[]) => booleanRectangles(objects, 'union');
