import type { ShpeshftDocument, VectorObject } from './document';
import { cubicPoints } from '../engine/bezier';
import { localCenter, objectCenter } from '../engine/geometry';

const number = (value:number) => Number(value.toFixed(4));
const geometry = (object:VectorObject) => {
  if (object.geometry.kind === 'rect') return `<rect x="0" y="0" width="${number(object.geometry.width)}" height="${number(object.geometry.height)}" rx="${number(object.geometry.radius)}"/>`;
  if (object.geometry.kind === 'ellipse') return `<ellipse cx="0" cy="0" rx="${number(object.geometry.rx)}" ry="${number(object.geometry.ry)}"/>`;
  const nodes=object.geometry.nodes; if (!nodes.length) return '<path d=""/>'; let d=`M ${number(nodes[0].anchor.x)} ${number(nodes[0].anchor.y)}`, segments=object.geometry.closed?nodes.length:nodes.length-1;
  for(let i=0;i<segments;i+=1){const {p1,p2,p3}=cubicPoints(nodes,i);d+=` C ${number(p1.x)} ${number(p1.y)} ${number(p2.x)} ${number(p2.y)} ${number(p3.x)} ${number(p3.y)}`;} if(object.geometry.closed)d+=' Z'; return `<path d="${d}"/>`;
};
const styled = (object:VectorObject) => { const center=localCenter(object), world=objectCenter(object), t=object.transform, cos=Math.cos(t.rotation),sin=Math.sin(t.rotation),a=cos*t.scaleX,b=sin*t.scaleX,c=-sin*t.scaleY,d=cos*t.scaleY,e=world.x-a*center.x-c*center.y,f=world.y-b*center.x-d*center.y,s=object.style; const fill=s.fillEnabled?s.fill:'none',stroke=s.strokeEnabled?s.strokeColor:'none',dash=s.strokeDashArray.length?s.strokeDashArray.join(' '):'none'; return geometry(object).replace('/>',` transform="matrix(${number(a)} ${number(b)} ${number(c)} ${number(d)} ${number(e)} ${number(f)})" fill="${fill}" fill-opacity="${number(s.fillOpacity)}" stroke="${stroke}" stroke-width="${number(s.strokeWidth)}" stroke-opacity="${number(s.strokeOpacity)}" stroke-dasharray="${dash}" stroke-linecap="${s.strokeLineCap}" stroke-linejoin="${s.strokeLineJoin}" stroke-miterlimit="${number(s.strokeMiterLimit)}" vector-effect="non-scaling-stroke" opacity="${number(s.opacity)}"/>`); };
export function exportSvg(document:ShpeshftDocument){return `<svg xmlns="http://www.w3.org/2000/svg" width="${document.workspace.width}" height="${document.workspace.height}" viewBox="0 0 ${document.workspace.width} ${document.workspace.height}"><rect width="100%" height="100%" fill="${document.workspace.background}"/>${document.order.map((id)=>document.objects[id]).filter((object)=>object?.visible).map(styled).join('')}</svg>`;}
