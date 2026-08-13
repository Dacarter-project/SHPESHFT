import type { Point } from '../core/document';

export function normalizedSelectionFrame(points:readonly Point[],padding:number){
  if(!points.length)return null;const xs=points.map((point)=>point.x),ys=points.map((point)=>point.y),left=Math.min(...xs)-padding,right=Math.max(...xs)+padding,top=Math.min(...ys)-padding,bottom=Math.max(...ys)+padding;
  const topLeft={x:left,y:top},topRight={x:right,y:top},bottomRight={x:right,y:bottom},bottomLeft={x:left,y:bottom};
  return{topLeft,topRight,bottomRight,bottomLeft,outline:[topLeft,topRight,bottomRight,bottomLeft],midpoints:{top:{x:(left+right)/2,y:top},right:{x:right,y:(top+bottom)/2},bottom:{x:(left+right)/2,y:bottom},left:{x:left,y:(top+bottom)/2}}};
}
