import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveTerrain} from '../game/terrain-geometry.js';
test('adaptive terrain stitches every internal edge and preserves the fine boundary',()=>{
  const bounds={minX:0,maxX:256,minZ:0,maxZ:256},height=(x,z)=>Math.sin(x*.02)*10+Math.cos(z*.01)*8;
  const geometry=adaptiveTerrain(bounds,height,x=>x<128),position=geometry.attributes.position,normal=geometry.attributes.normal,edges=new Map();
  for(let i=0;i<geometry.index.count;i+=3)for(let j=0;j<3;j++){const a=geometry.index.getX(i+j),b=geometry.index.getX(i+(j+1)%3),key=Math.min(a,b)+','+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}
  for(const [key,count] of edges){const [a,b]=key.split(',').map(Number);if(count===1)assert.ok((position.getX(a)===0&&position.getX(b)===0)||(position.getX(a)===256&&position.getX(b)===256)||(position.getZ(a)===0&&position.getZ(b)===0)||(position.getZ(a)===256&&position.getZ(b)===256),'open seam inside terrain');else assert.equal(count,2);}
  for(let i=0;i<position.count;i++){assert.ok(Math.abs(position.getY(i)-height(position.getX(i),position.getZ(i)))<1e-5);assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-6);assert.ok(normal.getY(i)>.8);}
  assert.ok(geometry.index.count<64*64*6*.7,'inaccessible half uses substantially fewer triangles');geometry.dispose();
});
