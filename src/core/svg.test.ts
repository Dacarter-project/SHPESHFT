import { describe,expect,it } from 'vitest';
import { createDocument,createRectangle } from './document';
import { exportSvg } from './svg';
it('serializes standards-compatible fill and stroke properties',()=>{const object=createRectangle(10,20), styled={...object,style:{...object.style,strokeEnabled:true,strokeColor:'#123456',strokeWidth:12,strokeOpacity:.4,strokeDashArray:[24,12],strokeLineCap:'round' as const,strokeLineJoin:'bevel' as const}},doc=createDocument();const svg=exportSvg({...doc,objects:{[styled.id]:styled},order:[styled.id]});expect(svg).toContain('stroke="#123456"');expect(svg).toContain('stroke-dasharray="24 12"');expect(svg).toContain('stroke-linecap="round"');expect(svg).toContain('stroke-linejoin="bevel"');});
