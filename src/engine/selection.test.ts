import {describe,expect,it} from 'vitest';
import {normalizedSelectionFrame} from './selection';

describe('fresh selection frame reconstruction',()=>{
  it('restores semantic controls to standard screen positions around rotated visible geometry',()=>{const angle=Math.PI/4,points=[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:0,y:50}].map((point)=>({x:200+point.x*Math.cos(angle)-point.y*Math.sin(angle),y:100+point.x*Math.sin(angle)+point.y*Math.cos(angle)})),frame=normalizedSelectionFrame(points,8);expect(frame).not.toBeNull();expect(frame!.topLeft.x).toBeLessThan(frame!.topRight.x);expect(frame!.topLeft.y).toBe(frame!.topRight.y);expect(frame!.bottomLeft.x).toBe(frame!.topLeft.x);expect(frame!.bottomLeft.y).toBeGreaterThan(frame!.topLeft.y);});
  it('normalises a horizontal visible edge without changing artwork points',()=>{const points=[{x:20,y:40},{x:180,y:40},{x:150,y:130},{x:50,y:130}],snapshot=structuredClone(points),frame=normalizedSelectionFrame(points,5);expect(frame!.outline[0].y).toBe(frame!.outline[1].y);expect(frame!.outline[2].y).toBe(frame!.outline[3].y);expect(points).toEqual(snapshot);});
});
