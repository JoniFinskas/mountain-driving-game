import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,updateRun,resetRunPosition,loadRecord,saveRecord,recordKey} from '../game/events.js';
const car=()=>({travel:0,speed:20,lateral:0,heading:0,x:0,y:0,z:0,offroad:false,wrecked:false});
function advance(run,state,distance,dt=.05){const steps=Math.ceil(Math.abs(distance)/(Math.abs(state.speed)*dt));for(let i=0;i<steps&&!run.finished;i++){state.travel+=distance/steps;updateRun(run,state,dt);}}
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};};
test('a lap crosses twelve ordered checkpoints and three sectors before finishing',()=>{
  const run=createRun('lap',1200),state=car();advance(run,state,1199);assert.equal(run.finished,false);assert.equal(run.next,11);assert.equal(run.sectors.length,2);advance(run,state,2);assert.equal(run.result.eligible,true);assert.equal(run.sectors.length,3);assert.ok(Math.abs(run.sectors.reduce((a,b)=>a+b,0)-run.time)<1e-8);
});
test('reversing across the start cannot manufacture forward progress',()=>{
  const run=createRun('sprint',3000),state=car();state.speed=-10;advance(run,state,-80);state.speed=20;advance(run,state,80);assert.ok(Math.abs(run.progress)<1e-8);assert.equal(run.next,0);
});
test('reset and teleport keep a practice result out of saved records',()=>{
  const run=createRun('sprint',1000),state=car();advance(run,state,100);resetRunPosition(run,state.travel);advance(run,state,350);assert.equal(run.result.eligible,false);assert.equal(saveRecord(memory(),{id:'coast',version:1},run).saved,false);
  const jumped=createRun('lap',1000);state.travel=1000;updateRun(jumped,state,.01);assert.equal(jumped.valid,false);assert.equal(jumped.next,0);assert.equal(jumped.finished,false);
});
test('clean runs stop on contact and a disabled car stops every event',()=>{
  let run=createRun('clean',3000);updateRun(run,car(),.01,true);assert.equal(run.result.title,'Barrier contact');assert.equal(run.result.eligible,false);
  for(const id of ['lap','sprint','free','drift','clean']){run=createRun(id,3000);updateRun(run,{...car(),wrecked:true},.01,true);assert.equal(run.result.title,'Car disabled');}
});
test('drift points require a moving slide followed by forward recovery',()=>{
  const run=createRun('drift',3000),state=car();state.lateral=6;advance(run,state,30);assert.equal(run.score,0);assert.ok(run.pendingScore>0);state.lateral=0;advance(run,state,20);assert.ok(run.score>0);assert.equal(run.pendingScore,0);
  state.lateral=6;advance(run,state,20);updateRun(run,state,.05,true);assert.equal(run.pendingScore,0);assert.equal(run.combo,1);
  const score=run.score;state.speed=-10;advance(run,state,-100);assert.equal(run.score,score);assert.equal(run.pendingScore,0);
});
test('repeating a road section in reverse cannot farm drift points',()=>{
  const run=createRun('drift',3000),state=car();
  const pass=()=>{state.speed=20;state.lateral=6;advance(run,state,30);state.lateral=0;advance(run,state,20);state.speed=-10;advance(run,state,-50);};
  pass();const firstScore=run.score;assert.ok(firstScore>0);for(let i=0;i<10;i++)pass();assert.equal(run.score,firstScore);assert.ok(Math.abs(run.progress)<1e-6);
});
test('best records are separated by map, version and event and ignore corrupt data',()=>{
  const storage=memory(),map={id:'one',version:1},run=createRun('lap',1200),state=car();advance(run,state,1201);assert.equal(saveRecord(storage,map,run).saved,true);assert.equal(loadRecord(storage,map,'lap').time,run.time);assert.equal(loadRecord(storage,{id:'two',version:1},'lap'),null);assert.equal(loadRecord(storage,{id:'one',version:2},'lap'),null);assert.equal(loadRecord(storage,map,'sprint'),null);
  const key=recordKey(map,'drift');storage.setItem(key,JSON.stringify({time:3,score:'broken',sectors:[],medal:null,ghost:[]}));assert.equal(loadRecord(storage,map,'drift'),null);
  storage.setItem(key,JSON.stringify({time:3,score:20,sectors:[],medal:null,ghost:[[2,0,0,0,0],[1,0,0,0,0]]}));assert.deepEqual(loadRecord(storage,map,'drift').ghost,[]);
  assert.equal(saveRecord({getItem(){throw Error();},setItem(){throw Error();}},map,run).saved,false);
});

test('circuit sprint requires a full circuit and cannot finish after ten seconds',()=>{
  const run=createRun('sprint',5148,true),state=car();advance(run,state,200, .05);
  assert.equal(run.finished,false);assert.equal(run.distance,5148);advance(run,state,4949);assert.equal(run.result.completed,true);
});
