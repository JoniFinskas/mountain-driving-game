import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Vector3} from '../game/vendor/three.module.js';
import {animateWheels} from '../game/car.js';
const wheels=()=>[-1,1].flatMap(side=>[false,true].map(front=>({front,center:new Vector3(side*.9,.35,front?1.36:-1.27),radius:front?.34:.36,steer:new Group(),spin:new Group()})));
test('wheel rotation follows distance, tyre radius and reverse travel',()=>{
 const ws=wheels();animateWheels(ws,10,0,.05);
 for(const w of ws)assert.ok(Math.abs(w.spin.rotation.x-.5/w.radius)<1e-10);
 animateWheels(ws,-10,0,.05);for(const w of ws)assert.ok(Math.abs(w.spin.rotation.x)<1e-10);
});
test('front wheels steer independently while the handbrake locks only the rear',()=>{
 const ws=wheels();animateWheels(ws,12,.25,.05,{handbrakeAmount:1,yaw:.5,lateral:2});
 const front=ws.filter(w=>w.front),rear=ws.filter(w=>!w.front);
 assert.ok(front[1].steer.rotation.y>front[0].steer.rotation.y);
 assert.ok(front.every(w=>w.spin.rotation.x>0));assert.ok(rear.every(w=>w.spin.rotation.x===0&&w.steer.rotation.y===0));
 animateWheels(ws,12,0,.05,{handbrakeAmount:0});assert.ok(rear.every(w=>w.spin.rotation.x>0));
});
test('turning gives outside wheels more travel and stopped wheels remain still',()=>{
 const ws=wheels();animateWheels(ws,10,0,.05,{yaw:1});
 const rear=ws.filter(w=>!w.front);assert.ok(rear[0].spin.rotation.x>rear[1].spin.rotation.x);
 const before=ws.map(w=>w.spin.rotation.x);animateWheels(ws,0,0,1);assert.deepEqual(ws.map(w=>w.spin.rotation.x),before);
});
