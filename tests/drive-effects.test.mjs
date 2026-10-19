import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,Vector3} from '../game/vendor/three.module.js';
import {createGhost,createTyreMarks} from '../game/drive-effects.js';
import {sample} from '../game/road.js';
test('ghost playback resets its cursor when a disabled ghost changes recordings',()=>{
  const scene=new Scene(),ghost=createGhost(scene),car=new Vector3(),long=Array.from({length:100},(_,i)=>[i,100+i,10,0,0]);
  ghost.update(long,80,true,car);ghost.update(long,81,false,car);
  const short=[[0,10,10,0,0],[100,20,10,0,.5]];ghost.update(short,82,false,car);ghost.update(short,83,true,car);assert.ok(scene.children[0].position.x>18&&scene.children[0].position.x<19);ghost.update(short,0,true,car);assert.equal(scene.children[0].position.x,10);
});
test('tyre marks follow the rear contact points and break across position resets',()=>{
  const scene=new Scene(),marks=createTyreMarks(scene);
  const state=s=>{const p=sample(s);return {...p,heading:Math.atan2(p.tx,p.tz),speed:15,handbrakeAmount:1,slip:.2,collision:0};};
  for(let s=0;s<10;s+=.4)marks.update(state(s));assert.ok(marks.count>30);const count=marks.count;marks.update(state(1000));assert.equal(marks.count,count);marks.break();marks.update(state(2000));assert.equal(marks.count,count);marks.clear();assert.equal(marks.count,0);assert.equal(scene.children[0].geometry.drawRange.count,0);
});

test('tyre marks use the selected model rear-wheel spacing',()=>{
 const scene=new Scene(),contacts=[{x:-.91,z:-1.27},{x:.91,z:-1.27}],marks=createTyreMarks(scene,contacts);
 const state=s=>{const p=sample(s);return {...p,heading:Math.atan2(p.tx,p.tz),speed:15,handbrakeAmount:1,slip:.2,collision:0};};
 const a=state(0);marks.update(a);marks.update(state(.5));assert.equal(marks.count,2);
 const points=scene.children[0].geometry.attributes.position;
 for(let i=0;i<2;i++){
  const mid=new Vector3().fromBufferAttribute(points,i*6).add(new Vector3().fromBufferAttribute(points,i*6+1)).multiplyScalar(.5);
  const expectedX=a.x+Math.sin(a.heading)*contacts[i].z+Math.cos(a.heading)*contacts[i].x;
  const expectedZ=a.z+Math.cos(a.heading)*contacts[i].z-Math.sin(a.heading)*contacts[i].x;
  assert.ok(Math.hypot(mid.x-expectedX,mid.z-expectedZ)<.001);
 }
});
