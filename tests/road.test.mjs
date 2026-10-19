import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoute} from '../game/road.js';
const {frames,length,sample,nearest,ribbon,routeBounds}=createRoute('ocean-road');
import {MeshBasicMaterial} from '../game/vendor/three.module.js';
import * as road from '../game/road.js';
import {Vector3} from '../game/vendor/three.module.js';
import {coastX} from '../game/geography.js';
import {activeMap,getMap} from '../game/maps.js';

test('Coastal Pass is the default while explicit map selections stay available',()=>{
  assert.equal(activeMap.id,'coastal-pass');
  for(const value of [null,undefined,'','unknown'])assert.equal(getMap(value).id,'coastal-pass');
  for(const id of ['coastal-pass','ocean-road','nurburgring-gp'])assert.equal(getMap(id).id,id);
});
test('all three selected routes close and provide finite driving frames',()=>{
  for(const [id,min,max] of [['coastal-pass',3100,3300],['ocean-road',10000,11000],['nurburgring-gp',5100,5200]]){
    const route=road.createRoute(id);assert.ok(route.length>min&&route.length<max);assert.ok(route.count<7000);const a=route.sample(.01),b=route.sample(route.length-.01);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.03);
    for(let i=0;i<route.frames.length;i+=3){const p=route.frames[i];for(const value of Object.values(p))assert.ok(Number.isFinite(value));const nearest=route.nearest(p.x,p.z,i);assert.ok(nearest.distance<1e-7);assert.ok(p.railOffset>p.width/2);}
    if(id==='nurburgring-gp'){assert.ok(route.frames.every(p=>p.width===12.5&&p.y===627));assert.ok(route.routeBounds.maxX-route.routeBounds.minX>1100);}
  }
});

test('coastal route closes smoothly and contains narrow and wide sections',()=>{
 assert.ok(length>10000&&length<11000,'the extended coastal loop uses more than three times the old driving distance');
 assert.ok(Math.min(...frames.map(p=>p.width))<=5.61);assert.ok(Math.max(...frames.map(p=>p.width))>=9.19);
 const a=sample(.01),b=sample(length-.01);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.03);assert.ok(Math.abs(a.y-b.y)<.01);
});
test('both legs stay by the ocean and cover the northern and southern coastline',()=>{
 assert.ok(routeBounds.maxZ-routeBounds.minZ>4900,'the road uses the extended coast');
 assert.ok(length/frames.length<=1.6,'extending the route retains its surface sampling density');
 let lower=0,upper=0;
 for(const p of frames){
  const inland=p.x-coastX(p.z,'ocean-road');
  assert.ok(inland>0&&inland<200,'the route stays on the coastal terraces');
  assert.ok(Math.abs(p.ty)/Math.hypot(p.tx,p.tz)<.16,'grades remain drivable');
  if(inland<45)lower++;if(inland>120)upper++;
 }
 assert.ok(lower>frames.length*.35&&upper>frames.length*.35,'both coastal legs have substantial driving distance');
});
test('road normals, edges and projection agree around the whole route',()=>{
 for(let i=0;i<frames.length;i+=4){const p=frames[i];assert.ok(Math.abs(Math.hypot(p.nx,p.nz)-1)<1e-9);
  for(const offset of [-p.width/2,0,p.width/2]){
   const nearestPoint=nearest(p.x+p.nx*offset,p.z+p.nz*offset,i);
   assert.ok(Math.abs(nearestPoint.offset-offset)<.04,`offset mismatch at ${i}`);
   assert.ok(Math.abs(nearestPoint.width-p.width)<.03);
   assert.ok(Math.abs(nearestPoint.railOffset-nearestPoint.width/2-.62)<1e-8);
  }
 }
});
test('road ribbons have upward normals and no degenerate triangles',()=>{
 const mesh=ribbon(p=>-p.width/2,p=>p.width/2,.025,new MeshBasicMaterial());
 const positions=mesh.geometry.attributes.position,normals=mesh.geometry.attributes.normal;
 for(let i=0;i<positions.count;i++){assert.ok(Number.isFinite(positions.getY(i)));assert.ok(normals.getY(i)>.94);}
 mesh.geometry.dispose();mesh.material.dispose();
});

test('vehicle orientation follows the road plane when braking or sliding across a slope',()=>{
 for(const heading of [0,.6,Math.PI/2,2.5,Math.PI]){
  const p={tx:0,ty:.2,tz:Math.sqrt(.96)},q=road.surfaceOrientation(p,heading);
  const up=new Vector3(0,1,0).applyQuaternion(q),front=new Vector3(0,0,1).applyQuaternion(q);
  assert.ok(up.distanceTo(new Vector3(0,Math.sqrt(.96),-.2))<1e-10,'all four wheel positions share the road plane');
  assert.ok(Math.abs(Math.sin(Math.atan2(front.x,front.z)-heading))<1e-10,'slope alignment preserves steering heading');
 }
});

test('spatial road lookup agrees with an exhaustive search across bends and grid boundaries',()=>{
  for(let i=0;i<frames.length;i+=13)for(const offset of [-70,-24,0,24,70]){
    const frame=frames[i],x=frame.x+frame.nx*offset,z=frame.z+frame.nz*offset;
    let distance=Infinity,index=0;
    for(let j=0;j<frames.length;j++){const p=frames[j],d=(x-p.x)**2+(z-p.z)**2;if(d<distance){distance=d;index=j;}}
    const expected=nearest(x,z,index),actual=nearest(x,z);
    assert.ok(actual);
    for(const field of ['x','y','z','distance','offset','width'])assert.ok(Math.abs(actual[field]-expected[field])<1e-8,`${field} differs at frame ${i}, offset ${offset}`);
  }
});
