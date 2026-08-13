import type { Point } from '../core/document';

export type SnapGuide={axis:'x';value:number}|{axis:'y';value:number}|{axis:'line';from:Point;to:Point}|{axis:'point';value:Point}|{axis:'angle';from:Point;to:Point;angle:number};
export type SnapTarget=Point&{kind?:'corner'|'centre'|'edge'|'node'|'workspace'};

export function snapPoint(point:Point,targets:readonly SnapTarget[],threshold:number,origin?:Point){
  let x:SnapTarget|null=null,y:SnapTarget|null=null,direct:SnapTarget|null=null;
  for(const target of targets){const dx=Math.abs(target.x-point.x),dy=Math.abs(target.y-point.y),distance=Math.hypot(target.x-point.x,target.y-point.y);if(distance<=threshold&&(!direct||distance<Math.hypot(direct.x-point.x,direct.y-point.y)))direct=target;if(dx<=threshold&&(!x||dx<Math.abs(x.x-point.x)))x=target;if(dy<=threshold&&(!y||dy<Math.abs(y.y-point.y)))y=target;}
  if(direct)return{point:{x:direct.x,y:direct.y},guides:[{axis:'point',value:{x:direct.x,y:direct.y}} as SnapGuide]};
  const snapped={x:x?.x??point.x,y:y?.y??point.y},guides:SnapGuide[]=[];if(x)guides.push({axis:'x',value:x.x});if(y)guides.push({axis:'y',value:y.y});
  if(origin&&!x&&!y){const dx=point.x-origin.x,dy=point.y-origin.y,distance=Math.hypot(dx,dy);if(distance>1){const angle=Math.atan2(dy,dx),snappedAngle=Math.round(angle/(Math.PI/4))*Math.PI/4,offset=Math.abs(Math.sin(angle-snappedAngle)*distance);if(offset<=threshold){const result={x:origin.x+Math.cos(snappedAngle)*distance,y:origin.y+Math.sin(snappedAngle)*distance};return{point:result,guides:[{axis:'line',from:origin,to:result}] as SnapGuide[]};}}}
  return{point:snapped,guides};
}

export function snapTranslation(points:readonly Point[],targets:readonly SnapTarget[],delta:Point,threshold:number){
  let bestX:{offset:number;value:number}|null=null,bestY:{offset:number;value:number}|null=null;
  for(const point of points)for(const target of targets){const offsetX=target.x-(point.x+delta.x),offsetY=target.y-(point.y+delta.y);if(Math.abs(offsetX)<=threshold&&(!bestX||Math.abs(offsetX)<Math.abs(bestX.offset)))bestX={offset:offsetX,value:target.x};if(Math.abs(offsetY)<=threshold&&(!bestY||Math.abs(offsetY)<Math.abs(bestY.offset)))bestY={offset:offsetY,value:target.y};}
  return{delta:{x:delta.x+(bestX?.offset??0),y:delta.y+(bestY?.offset??0)},guides:[...(bestX?[{axis:'x' as const,value:bestX.value}]:[]),...(bestY?[{axis:'y' as const,value:bestY.value}]:[])]};
}

export function snapProportionalScale(fixed:Point,moving:Point,pointer:Point,targets:readonly SnapTarget[],threshold:number){
  const initial={x:moving.x-fixed.x,y:moving.y-fixed.y},denominator=initial.x*initial.x+initial.y*initial.y,raw=denominator<1e-9?1:((pointer.x-fixed.x)*initial.x+(pointer.y-fixed.y)*initial.y)/denominator;let best:{factor:number;distance:number;guide:SnapGuide}|null=null;
  for(const target of targets){const directFactor=denominator<1e-9?1:((target.x-fixed.x)*initial.x+(target.y-fixed.y)*initial.y)/denominator,directPoint={x:fixed.x+initial.x*directFactor,y:fixed.y+initial.y*directFactor},directDistance=Math.hypot(directPoint.x-target.x,directPoint.y-target.y);if(directDistance<=threshold&&(!best||directDistance<best.distance))best={factor:directFactor,distance:directDistance,guide:{axis:'point',value:target}};if(Math.abs(initial.x)>1e-9){const factor=(target.x-fixed.x)/initial.x,actualY=fixed.y+initial.y*factor,distance=Math.abs(actualY-(fixed.y+initial.y*raw));if(Math.abs(target.x-(fixed.x+initial.x*raw))<=threshold&&(!best||distance<best.distance))best={factor,distance,guide:{axis:'x',value:target.x}};}if(Math.abs(initial.y)>1e-9){const factor=(target.y-fixed.y)/initial.y,actualX=fixed.x+initial.x*factor,distance=Math.abs(actualX-(fixed.x+initial.x*raw));if(Math.abs(target.y-(fixed.y+initial.y*raw))<=threshold&&(!best||distance<best.distance))best={factor,distance,guide:{axis:'y',value:target.y}};}}
  const factor=best?.factor??raw;return{point:{x:fixed.x+initial.x*factor,y:fixed.y+initial.y*factor},factor,guides:best?[best.guide]:[]};
}

const normalise=(angle:number)=>{while(angle>Math.PI)angle-=Math.PI*2;while(angle<=-Math.PI)angle+=Math.PI*2;return angle;};
export function snapRotation(raw:number,geometryAngles:readonly number[],threshold=Math.PI/60){
  const common=Array.from({length:24},(_,index)=>index*Math.PI/12);let best:{angle:number;distance:number}|null=null;
  for(const target of common)for(const geometry of geometryAngles.length?geometryAngles:[0]){const candidate=raw+normalise(target-(raw+geometry)),distance=Math.abs(normalise(candidate-raw));if(distance<=threshold&&(!best||distance<best.distance))best={angle:candidate,distance};}
  return best?{angle:best.angle,snapped:true}:{angle:raw,snapped:false};
}
