import type { VectorObject } from '../core/document';
import { cubicPoints } from './bezier';

export type Bounds = { x: number; y: number; width: number; height: number };

export function localCenter(object: VectorObject) {
  const bounds = localBounds(object);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** The transform position remains the unrotated local origin for project compatibility. */
export function objectCenter(object: VectorObject) {
  const center = localCenter(object);
  return {
    x: object.transform.x + center.x * object.transform.scaleX,
    y: object.transform.y + center.y * object.transform.scaleY
  };
}

export function worldToLocal(object: VectorObject, worldX: number, worldY: number) {
  const center = localCenter(object), worldCenter = objectCenter(object);
  const dx = worldX - worldCenter.x, dy = worldY - worldCenter.y;
  const cos = Math.cos(-object.transform.rotation), sin = Math.sin(-object.transform.rotation);
  return { x: center.x + (dx * cos - dy * sin) / object.transform.scaleX, y: center.y + (dx * sin + dy * cos) / object.transform.scaleY };
}

export function localToWorld(object: VectorObject, localX: number, localY: number) {
  const center = localCenter(object), worldCenter = objectCenter(object);
  const x = (localX - center.x) * object.transform.scaleX, y = (localY - center.y) * object.transform.scaleY;
  const cos = Math.cos(object.transform.rotation), sin = Math.sin(object.transform.rotation);
  return { x: worldCenter.x + x * cos - y * sin, y: worldCenter.y + x * sin + y * cos };
}

export function localBounds(object: VectorObject): Bounds {
  if (object.geometry.kind === 'rect') return { x: 0, y: 0, width: object.geometry.width, height: object.geometry.height };
  if (object.geometry.kind === 'ellipse') return { x: -object.geometry.rx, y: -object.geometry.ry, width: object.geometry.rx * 2, height: object.geometry.ry * 2 };
  const points: Array<{ x:number; y:number }> = [];
  const roots = (p0:number, p1:number, p2:number, p3:number) => { const a = -p0 + 3*p1 - 3*p2 + p3, b = 2*(p0 - 2*p1 + p2), c = p1 - p0, result:number[] = []; if (Math.abs(a) < 1e-9) { if (Math.abs(b) > 1e-9) result.push(-c/b); } else { const d = b*b - 4*a*c; if (d >= 0) { result.push((-b + Math.sqrt(d))/(2*a), (-b - Math.sqrt(d))/(2*a)); } } return result.filter((t) => t > 0 && t < 1); };
  const value = (p0:number,p1:number,p2:number,p3:number,t:number) => { const u=1-t; return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3; };
  for(const [pathIndex,nodes] of [object.geometry.nodes,...(object.geometry.subpaths??[])].entries()){const closed=pathIndex===0?object.geometry.closed:true,segments=closed?nodes.length:Math.max(0,nodes.length-1);for (let index=0; index<segments; index+=1) { const {p0,p1,p2,p3}=cubicPoints(nodes,index), ts = new Set([0,1,...roots(p0.x,p1.x,p2.x,p3.x),...roots(p0.y,p1.y,p2.y,p3.y)]); for (const t of ts) points.push({x:value(p0.x,p1.x,p2.x,p3.x,t),y:value(p0.y,p1.y,p2.y,p3.y,t)}); }}
  if (!points.length) points.push(...object.geometry.nodes.map((node) => node.anchor));
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function tracePath(context: CanvasRenderingContext2D, object: VectorObject): void {
  if (object.geometry.kind !== 'path' || object.geometry.nodes.length === 0) return;
  for(const [pathIndex,nodes] of [object.geometry.nodes,...(object.geometry.subpaths??[])].entries()){if(!nodes.length)continue;const closed=pathIndex===0?object.geometry.closed:true;context.moveTo(nodes[0].anchor.x,nodes[0].anchor.y);const last=closed?nodes.length:nodes.length-1;for(let index=0;index<last;index+=1){const from=nodes[index],to=nodes[(index+1)%nodes.length],cp1=from.out?{x:from.anchor.x+from.out.x,y:from.anchor.y+from.out.y}:from.anchor,cp2=to.in?{x:to.anchor.x+to.in.x,y:to.anchor.y+to.in.y}:to.anchor;context.bezierCurveTo(cp1.x,cp1.y,cp2.x,cp2.y,to.anchor.x,to.anchor.y);}if(closed)context.closePath();}
}

export function hitTest(object: VectorObject, worldX: number, worldY: number): boolean {
  const { x, y } = worldToLocal(object, worldX, worldY);
  if (object.geometry.kind === 'ellipse') return (x * x) / (object.geometry.rx ** 2) + (y * y) / (object.geometry.ry ** 2) <= 1;
  const bounds = localBounds(object);
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}

export function objectOutlinePoints(object: VectorObject): Array<{x:number;y:number}> {
  const local:Array<{x:number;y:number}>=[];
  if(object.geometry.kind==='rect') local.push({x:0,y:0},{x:object.geometry.width,y:0},{x:object.geometry.width,y:object.geometry.height},{x:0,y:object.geometry.height});
  else if(object.geometry.kind==='ellipse') for(let index=0;index<64;index+=1){const angle=index*Math.PI/32;local.push({x:Math.cos(angle)*object.geometry.rx,y:Math.sin(angle)*object.geometry.ry});}
  else {for(const [pathIndex,nodes] of [object.geometry.nodes,...(object.geometry.subpaths??[])].entries()){const closed=pathIndex===0?object.geometry.closed:true,segments=closed?nodes.length:Math.max(0,nodes.length-1);for(let index=0;index<segments;index+=1){const{p0,p1,p2,p3}=cubicPoints(nodes,index);for(let step=0;step<16;step+=1){const t=step/16,u=1-t;local.push({x:u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,y:u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y});}}}}
  return local.map((point)=>localToWorld(object,point.x,point.y));
}

export function objectIntersectsRect(object:VectorObject,rect:Bounds):boolean {
  const right=rect.x+rect.width,bottom=rect.y+rect.height,inside=(point:{x:number;y:number})=>point.x>=rect.x&&point.x<=right&&point.y>=rect.y&&point.y<=bottom,points=objectOutlinePoints(object);
  if(!points.length)return false;
  if(points.some(inside))return true;
  if(object.geometry.kind!=='path'||object.geometry.closed)for(const corner of [{x:rect.x,y:rect.y},{x:right,y:rect.y},{x:right,y:bottom},{x:rect.x,y:bottom}])if(hitTest(object,corner.x,corner.y))return true;
  const orientation=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),intersects=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number},d:{x:number;y:number})=>{const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);return ((o1<=0&&o2>=0)||(o1>=0&&o2<=0))&&((o3<=0&&o4>=0)||(o3>=0&&o4<=0));},edges=[[{x:rect.x,y:rect.y},{x:right,y:rect.y}],[{x:right,y:rect.y},{x:right,y:bottom}],[{x:right,y:bottom},{x:rect.x,y:bottom}],[{x:rect.x,y:bottom},{x:rect.x,y:rect.y}]] as const,last=object.geometry.kind==='path'&&!object.geometry.closed?points.length-1:points.length;
  for(let index=0;index<last;index+=1)for(const edge of edges)if(intersects(points[index],points[(index+1)%points.length],edge[0],edge[1]))return true;
  return false;
}
