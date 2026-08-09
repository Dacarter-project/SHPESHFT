import type paper from 'paper';
import { identityTransform, type PathNode, type VectorObject } from '../core/document';
import { localToWorld } from './geometry';

type Cell = { x0: number; x1: number; y0: number; y1: number };
type Edge = { from: [number, number]; to: [number, number] };
const key = ([x, y]: [number, number]) => `${x},${y}`;
export type BooleanOperation = 'union' | 'difference' | 'intersect';

function authoringPaths(object:VectorObject):Array<{closed:boolean;nodes:readonly PathNode[]}>{
  const node=(anchor:{x:number;y:number},incoming:{x:number;y:number}|null=null,outgoing:{x:number;y:number}|null=null):PathNode=>({id:crypto.randomUUID(),anchor,in:incoming,out:outgoing,kind:incoming||outgoing?'symmetric':'corner'});
  if(object.geometry.kind==='rect'){const{width,height}=object.geometry;return[{closed:true,nodes:[node({x:0,y:0}),node({x:width,y:0}),node({x:width,y:height}),node({x:0,y:height})]}];}
  if(object.geometry.kind==='ellipse'){const{rx,ry}=object.geometry,k=.5522847498307936;return[{closed:true,nodes:[node({x:rx,y:0},{x:0,y:-k*ry},{x:0,y:k*ry}),node({x:0,y:ry},{x:k*rx,y:0},{x:-k*rx,y:0}),node({x:-rx,y:0},{x:0,y:k*ry},{x:0,y:-k*ry}),node({x:0,y:-ry},{x:-k*rx,y:0},{x:k*rx,y:0})]}];}
  return[{closed:object.geometry.closed,nodes:object.geometry.nodes},...(object.geometry.subpaths??[]).map((nodes)=>({closed:true,nodes}))];
}

function toPaperPath(scope:paper.PaperScope,object:VectorObject,path:{closed:boolean;nodes:readonly PathNode[]}){
  const segments=path.nodes.map((node)=>{const anchor=localToWorld(object,node.anchor.x,node.anchor.y),handle=(value:{x:number;y:number}|null)=>{if(!value)return new scope.Point(0,0);const point=localToWorld(object,node.anchor.x+value.x,node.anchor.y+value.y);return new scope.Point(point.x-anchor.x,point.y-anchor.y);};return new scope.Segment(new scope.Point(anchor.x,anchor.y),handle(node.in),handle(node.out));});
  return new scope.Path({segments,closed:path.closed,insert:false});
}

function toPaperItem(scope:paper.PaperScope,object:VectorObject):paper.PathItem{
  const paths=authoringPaths(object).map((path)=>toPaperPath(scope,object,path));
  return paths.length===1?paths[0]:new scope.CompoundPath({children:paths,insert:false});
}

function fromPaperPath(path:paper.Path):PathNode[]{return path.segments.map((segment)=>{const incoming=Math.hypot(segment.handleIn.x,segment.handleIn.y)>.000001?{x:segment.handleIn.x,y:segment.handleIn.y}:null,outgoing=Math.hypot(segment.handleOut.x,segment.handleOut.y)>.000001?{x:segment.handleOut.x,y:segment.handleOut.y}:null;return{id:crypto.randomUUID(),anchor:{x:segment.point.x,y:segment.point.y},in:incoming,out:outgoing,kind:incoming||outgoing?'independent':'corner'};});}

/** Curve-aware Boolean geometry. Rendering tessellation never enters the authoring document. */
export async function booleanShapes(objects:readonly VectorObject[],operation:BooleanOperation):Promise<VectorObject[]>{
  if(objects.length<2)return[];const {default:paperRuntime}=await import('paper'),scope=new paperRuntime.PaperScope();scope.setup(new scope.Size(1,1));let result:paper.PathItem=toPaperItem(scope,objects[0]);
  try{for(const object of objects.slice(1)){const operand=toPaperItem(scope,object);result=operation==='union'?result.unite(operand,{insert:false}):operation==='difference'?result.subtract(operand,{insert:false}):result.intersect(operand,{insert:false});if(result.isEmpty())return[];}}catch{return[];}
  const paths=(result instanceof scope.CompoundPath?result.children:[result]).filter((child):child is paper.Path=>child instanceof scope.Path&&child.segments.length>1),nodeSets=paths.map(fromPaperPath);if(!nodeSets.length)return[];
  return[{id:crypto.randomUUID(),name:operation==='union'?'Combine':operation==='difference'?'Cut Out':'Intersect',geometry:{kind:'path',closed:true,nodes:nodeSets[0],...(nodeSets.length>1?{subpaths:nodeSets.slice(1)}:{})},transform:identityTransform(),style:{...objects[0].style},visible:true,locked:false,parentId:null}];
}

/** Legacy exact rectangle helper retained for document compatibility tests. */
export function booleanRectangles(objects: readonly VectorObject[], operation: BooleanOperation): VectorObject | null {
  if (objects.length < 2 || objects.some((object) => object.geometry.kind !== 'rect' || object.transform.rotation !== 0)) return null;
  const xs = [...new Set(objects.flatMap((object) => { if (object.geometry.kind !== 'rect') throw new Error('Expected rectangle'); return [object.transform.x, object.transform.x + object.geometry.width * object.transform.scaleX]; }))].sort((a,b)=>a-b),ys=[...new Set(objects.flatMap((object)=>{if(object.geometry.kind!=='rect')throw new Error('Expected rectangle');return[object.transform.y,object.transform.y+object.geometry.height*object.transform.scaleY];}))].sort((a,b)=>a-b),cells:Cell[]=[];
  for(let xi=0;xi<xs.length-1;xi+=1)for(let yi=0;yi<ys.length-1;yi+=1){const cell={x0:xs[xi],x1:xs[xi+1],y0:ys[yi],y1:ys[yi+1]},cx=(cell.x0+cell.x1)/2,cy=(cell.y0+cell.y1)/2,inside=objects.map((object)=>object.geometry.kind==='rect'&&cx>=object.transform.x&&cx<=object.transform.x+object.geometry.width*object.transform.scaleX&&cy>=object.transform.y&&cy<=object.transform.y+object.geometry.height*object.transform.scaleY),keep=operation==='union'?inside.some(Boolean):operation==='intersect'?inside.every(Boolean):inside[0]&&!inside.slice(1).some(Boolean);if(keep)cells.push(cell);}
  if(!cells.length)return null;const edges:Edge[]=[],toggle=(edge:Edge)=>{const reverse=edges.findIndex((candidate)=>key(candidate.from)===key(edge.to)&&key(candidate.to)===key(edge.from));if(reverse>=0)edges.splice(reverse,1);else edges.push(edge);};for(const cell of cells){toggle({from:[cell.x0,cell.y0],to:[cell.x1,cell.y0]});toggle({from:[cell.x1,cell.y0],to:[cell.x1,cell.y1]});toggle({from:[cell.x1,cell.y1],to:[cell.x0,cell.y1]});toggle({from:[cell.x0,cell.y1],to:[cell.x0,cell.y0]});}const points:[number,number][]=[],remaining=[...edges];let edge=remaining.shift();if(!edge)return null;points.push(edge.from,edge.to);while(remaining.length){const next=remaining.findIndex((candidate)=>key(candidate.from)===key(points.at(-1)!));if(next<0)break;edge=remaining.splice(next,1)[0];if(key(edge.to)===key(points[0]))break;points.push(edge.to);}const nodes=points.map(([x,y]):PathNode=>({id:crypto.randomUUID(),anchor:{x,y},in:null,out:null,kind:'corner'}));return{id:crypto.randomUUID(),name:operation==='union'?'Combined path':operation==='difference'?'Cut out path':'Intersection path',geometry:{kind:'path',closed:true,nodes},transform:identityTransform(),style:{...objects[0].style},visible:true,locked:false,parentId:null};
}

export function unionRectangles(objects:readonly VectorObject[]){return booleanRectangles(objects,'union');}
