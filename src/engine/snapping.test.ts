import {describe,expect,it} from 'vitest';
import {snapPoint,snapProportionalScale,snapRotation,snapTranslation} from './snapping';

describe('shared snapping',()=>{
  it('snaps a point directly and emits point feedback',()=>{const result=snapPoint({x:48,y:52},[{x:50,y:50,kind:'node'}],5);expect(result.point).toEqual({x:50,y:50});expect(result.guides[0].axis).toBe('point');});
  it('snaps independent x and y alignment',()=>{const result=snapPoint({x:48,y:83},[{x:50,y:0},{x:0,y:80}],5);expect(result.point).toEqual({x:50,y:80});expect(result.guides.map((guide)=>guide.axis)).toEqual(['x','y']);});
  it('snaps translation using any moving geometry point',()=>{const result=snapTranslation([{x:10,y:10},{x:20,y:20}],[{x:51,y:79}],{x:30,y:60},2);expect(result.delta).toEqual({x:31,y:59});});
  it('snaps proportional scaling without moving the fixed corner',()=>{const fixed={x:10,y:20},moving={x:110,y:70},result=snapProportionalScale(fixed,moving,{x:207,y:121},[{x:210,y:120}],5);expect(result.point).toEqual({x:210,y:120});expect(fixed).toEqual({x:10,y:20});expect(result.guides[0].axis).toBe('point');});
  for(const degrees of [0,15,30,45,60,90])it(`snaps rotation to ${degrees}°`,()=>{const radians=degrees*Math.PI/180,result=snapRotation(radians+.01,[0]);expect(result.snapped).toBe(true);expect(result.angle).toBeCloseTo(radians,8);});
});
