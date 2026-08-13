import type { PathNode, VectorObject } from '../core/document';

export function toEditablePath(object:VectorObject):VectorObject {
  if(object.geometry.kind==='path')return object;
  const node=(anchor:{x:number;y:number},incoming:{x:number;y:number}|null=null,outgoing:{x:number;y:number}|null=null):PathNode=>({id:crypto.randomUUID(),anchor,in:incoming,out:outgoing,kind:incoming||outgoing?'symmetric':'corner'});
  if(object.geometry.kind==='rect'){const{width,height}=object.geometry;return{...object,geometry:{kind:'path',closed:true,nodes:[node({x:0,y:0}),node({x:width,y:0}),node({x:width,y:height}),node({x:0,y:height})]}};}
  const{rx,ry}=object.geometry,k=.5522847498307936;
  return{...object,geometry:{kind:'path',closed:true,nodes:[node({x:rx,y:0},{x:0,y:-k*ry},{x:0,y:k*ry}),node({x:0,y:ry},{x:k*rx,y:0},{x:-k*rx,y:0}),node({x:-rx,y:0},{x:0,y:k*ry},{x:0,y:-k*ry}),node({x:0,y:-ry},{x:-k*rx,y:0},{x:k*rx,y:0})]}};
}
