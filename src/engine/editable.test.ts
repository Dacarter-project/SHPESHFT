import {describe,expect,it} from 'vitest';
import {createEllipse,createRectangle,createTriangle} from '../core/document';
import {localToWorld} from './geometry';
import {toEditablePath} from './editable';

describe('entering Node Mode',()=>{
  for(const degrees of [0,27,45,90,135])it(`converts a transformed rectangle without moving it at ${degrees}°`,()=>{const rectangle=createRectangle(135,245),before={...rectangle,transform:{...rectangle.transform,scaleX:degrees===90?-1.3:1.3,scaleY:.68,rotation:degrees*Math.PI/180}},after=toEditablePath(before);expect(after.transform).toEqual(before.transform);if(after.geometry.kind!=='path')throw new Error('Expected path');const corners=[{x:0,y:0},{x:180,y:0},{x:180,y:140},{x:0,y:140}];after.geometry.nodes.forEach((node,index)=>{const expected=localToWorld(before,corners[index].x,corners[index].y),actual=localToWorld(after,node.anchor.x,node.anchor.y);expect(actual.x).toBeCloseTo(expected.x,8);expect(actual.y).toBeCloseTo(expected.y,8);});});

  it('preserves a transformed ellipse and its four cardinal anchors',()=>{const ellipse=createEllipse(330,180),before={...ellipse,transform:{...ellipse.transform,scaleX:-.75,scaleY:1.6,rotation:.73}},after=toEditablePath(before);expect(after.transform).toEqual(before.transform);if(after.geometry.kind!=='path')throw new Error('Expected path');const cardinals=[{x:90,y:0},{x:0,y:90},{x:-90,y:0},{x:0,y:-90}];after.geometry.nodes.forEach((node,index)=>{const expected=localToWorld(before,cardinals[index].x,cardinals[index].y),actual=localToWorld(after,node.anchor.x,node.anchor.y);expect(actual.x).toBeCloseTo(expected.x,8);expect(actual.y).toBeCloseTo(expected.y,8);});});

  it('leaves existing path geometry untouched',()=>{const triangle=createTriangle(10,20);expect(toEditablePath(triangle)).toBe(triangle);});
});
