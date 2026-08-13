import type { Point, Transform,VectorObject } from '../core/document';
import { localBounds, localCenter, localToWorld, objectCenter } from './geometry';
export const exceedsDragThreshold = (dx: number, dy: number, threshold: number) => Math.hypot(dx,dy) > threshold;
export function transformAround(object:VectorObject,before:Transform,pivot:{x:number;y:number},scale:number,rotationDelta:number):Transform{const source={...object,transform:before},center=objectCenter(source),local=localCenter(source),dx=center.x-pivot.x,dy=center.y-pivot.y,cos=Math.cos(rotationDelta),sin=Math.sin(rotationDelta),nextCenter={x:pivot.x+(dx*cos-dy*sin)*scale,y:pivot.y+(dx*sin+dy*cos)*scale},scaleX=before.scaleX*scale,scaleY=before.scaleY*scale;return{...before,x:nextCenter.x-local.x*scaleX,y:nextCenter.y-local.y*scaleY,scaleX,scaleY,rotation:before.rotation+rotationDelta};}

export function transformKeepingLocalPoint(object: VectorObject, before: Transform, fixedLocal: Point, fixedWorld: Point, scaleX: number, scaleY: number): Transform {
  const source = { ...object, transform: before }, center = localCenter(source), cos = Math.cos(before.rotation), sin = Math.sin(before.rotation);
  const localX = (fixedLocal.x - center.x) * scaleX, localY = (fixedLocal.y - center.y) * scaleY;
  const worldCenter = { x: fixedWorld.x - localX * cos + localY * sin, y: fixedWorld.y - localX * sin - localY * cos };
  return { ...before, x: worldCenter.x - center.x * scaleX, y: worldCenter.y - center.y * scaleY, scaleX, scaleY };
}

export function resizeAlongLocalEdge(object: VectorObject, before: Transform, edge: 'top'|'right'|'bottom'|'left', world: Point, fixedCorner?: 'bottomRight'): Transform {
  const source = { ...object, transform: before }, bounds = localBounds(source), center = localCenter(source), cos = Math.cos(before.rotation), sin = Math.sin(before.rotation);
  const horizontal = edge === 'left' || edge === 'right', axis = horizontal ? { x: cos, y: sin } : { x: -sin, y: cos };
  const fixedLocal = fixedCorner === 'bottomRight'
    ? { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
    : horizontal
      ? { x: edge === 'left' ? bounds.x + bounds.width : bounds.x, y: center.y }
      : { x: center.x, y: edge === 'top' ? bounds.y + bounds.height : bounds.y };
  const fixedWorld = localToWorld(source, fixedLocal.x, fixedLocal.y);
  const movingLocal = horizontal ? (edge === 'left' ? bounds.x : bounds.x + bounds.width) : (edge === 'top' ? bounds.y : bounds.y + bounds.height);
  const fixedCoordinate = horizontal ? fixedLocal.x : fixedLocal.y, localDelta = movingLocal - fixedCoordinate;
  const projected = (world.x - fixedWorld.x) * axis.x + (world.y - fixedWorld.y) * axis.y;
  const rawScale = projected / (Math.abs(localDelta) < 1e-9 ? 1 : localDelta), previousScale = horizontal ? before.scaleX : before.scaleY;
  const scale = Math.abs(rawScale) < .08 ? (Math.sign(previousScale) || 1) * .08 : rawScale;
  return transformKeepingLocalPoint(object, before, fixedLocal, fixedWorld, horizontal ? scale : before.scaleX, horizontal ? before.scaleY : scale);
}
