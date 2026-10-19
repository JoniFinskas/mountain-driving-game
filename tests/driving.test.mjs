import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,integrate,constrain,vehicleSpec} from '../game/driving.js';
const road={x:0,y:100,z:0,tx:0,ty:0,tz:1,nx:-1,nz:0,s:0,index:0,width:8,railOffset:4.62,offset:0};
const dt=1/120;
function run(s,input,seconds,p=road){for(let i=0;i<Math.round(seconds/dt);i++)integrate(s,input,p,dt);return s;}
function stop(input,p=road){const s=createState(p);s.speed=100/3.6;let distance=0,t=0;while(s.speed>.1&&t<12){const before=s.speed;integrate(s,input,p,dt);distance+=(before+Math.max(0,s.speed))*.5*dt;t+=dt;}return {distance,t,s};}
const energy=s=>.5*vehicleSpec.mass*(s.speed*s.speed+s.lateral*s.lateral)+.5*vehicleSpec.yawInertia*s.yaw*s.yaw;

test('barrier damage follows impact severity and repeated heavy impacts disable the car',()=>{
  const impact=(s,speed)=>{Object.assign(s,{heading:-Math.PI/2,speed,lateral:0,yaw:0,collision:0});constrain(s,{...road,offset:4},1000);};
  const gentle=createState(road);impact(gentle,.3);assert.equal(gentle.health,100);assert.equal(gentle.barrierContact,true,'even a gentle touch invalidates a clean run');
  const damaged=createState(road);impact(damaged,25);assert.ok(damaged.health<40&&damaged.health>0);impact(damaged,25);assert.equal(damaged.health,0);assert.equal(damaged.wrecked,true);run(damaged,{throttle:1},3);assert.ok(Math.abs(damaged.speed)<.1,'disabled car stops and cannot accelerate');
  const fresh=createState(road);assert.equal(fresh.health,100);assert.equal(fresh.wrecked,false);
});

test('dry braking is plausible, stronger than gravel and lengthens downhill',()=>{
 const dry=stop({brake:1}),gravel=stop({brake:1},{...road,offset:4.2}),hill=stop({brake:1},{...road,ty:-.15});
 assert.ok(dry.distance>30&&dry.distance<38,`dry stop ${dry.distance} m`);
 assert.ok(gravel.distance>dry.distance*1.25);assert.ok(hill.distance>dry.distance);
 assert.ok(dry.s.frontLoad>dry.s.rearLoad,'braking transfers load forward');
});
test('brakes override the accelerator',()=>assert.ok(Math.abs(stop({brake:1}).distance-stop({brake:1,throttle:1}).distance)<.02));
test('handbrake stops and holds the car on a slope, even with throttle held',()=>{
 const s=createState(road);s.speed=15;run(s,{handbrake:true,throttle:1},10,{...road,ty:-.12});assert.equal(s.speed,0);assert.ok(Math.abs(s.lateral)<.02);
});
test('reverse requires a deliberate hold after stopping and respects its speed limit',()=>{
 const s=createState(road);run(s,{brake:1},.3);assert.equal(s.speed,0);run(s,{brake:1},8);assert.ok(s.speed<-2&&s.speed>=-7);
 run(s,{throttle:1},5);assert.ok(s.speed>0);
});
test('standing still, coasting and aerodynamic resistance remain stable',()=>{
 const idle=run(createState(road),{},30);assert.equal(idle.speed,0);assert.equal(idle.yaw,0);
 const slow=createState(road),fast=createState(road);slow.speed=15;fast.speed=45;run(slow,{},1);run(fast,{},1);assert.ok(45-fast.speed>15-slow.speed);
});
test('steering direction follows the controls and reverses while backing up',()=>{
 const forward=createState(road),reverse=createState(road);forward.speed=12;reverse.speed=-5;
 run(forward,{steer:1,throttle:.2},1);run(reverse,{steer:1,brake:.3},1);assert.ok(forward.heading>0);assert.ok(reverse.heading<0);
});
test('rear-wheel lock creates more sideslip than balanced cornering',()=>{
 const normal=createState(road),locked=createState(road);normal.speed=locked.speed=22;
 run(normal,{steer:.65,throttle:.15},.6);run(locked,{steer:.65,throttle:.15},.6);
 run(normal,{steer:.65,brake:.15},.65);run(locked,{steer:.65,handbrake:true},.65);
 assert.ok(Math.abs(locked.rearSlip)>Math.abs(normal.rearSlip)*1.5,`normal ${normal.rearSlip}, locked ${locked.rearSlip}`);
});
test('combined braking and cornering stays inside the available tyre force',()=>{
 const s=createState(road);s.speed=25;run(s,{brake:.7,steer:1},.5);
 assert.ok(Math.hypot(s.acceleration,s.lateralAcceleration)<1.3*9.81);
 assert.ok(s.speed<25&&Math.abs(s.heading)>.01);
});
test('rail contact follows road width and the whole vehicle footprint',()=>{
 for(const width of [5.6,8,9.2])for(const heading of [0,.6,1.5,-.6]){
  const s=createState(road);s.x=-width/2;s.heading=heading;s.speed=22;s.lateral=-3;
  const before=energy(s),p={...road,offset:-s.x,width,railOffset:width/2+.62};
  constrain(s,p,3000);
  const extent=Math.abs(Math.sin(s.heading)) * vehicleSpec.halfLength+Math.abs(Math.cos(s.heading))*vehicleSpec.halfWidth;
  assert.ok(Math.abs(s.x)+extent<=p.railOffset+.002);
  assert.ok(energy(s)<=before*1.001,'rail cannot add kinetic energy');assert.equal(s.heading,heading);
 }
});
test('a glancing impact preserves more speed than a head-on impact',()=>{
 const impact=heading=>{const s=createState(road);s.heading=heading;s.speed=25;s.x=-4;constrain(s,{...road,offset:4},3000);return energy(s);};
 assert.ok(impact(-.12)>impact(-Math.PI/2));
});
test('route progress unwraps at the finish line',()=>{
 const s=createState(road);s.s=2998;constrain(s,{...road,s:2,offset:0},3000);assert.equal(s.travel,4);
});
test('exhaust pops require hot high-rev lift-off and have a cooldown',()=>{
 const idle=run(createState(road),{},10);assert.equal(idle.popCount,0);
 const s=createState(road);s.speed=30;s.gear=2;s.rpm=5200;run(s,{throttle:1},.1);run(s,{},.2);assert.equal(s.popCount,1);
 assert.ok(s.popStrength>=.15&&s.popStrength<=.55,'event strength remains available after its short visual envelope');
 const strength=s.popStrength;run(s,{throttle:1},.1);run(s,{},.2);assert.equal(s.popCount,1);assert.equal(s.popStrength,strength);
 const cold=createState(road);cold.speed=30;cold.gear=2;cold.rpm=5200;cold.engineHeat=0;run(cold,{throttle:1},.1);run(cold,{},.2);assert.equal(cold.popCount,0);
});
test('mixed controls remain finite over a sustained drive',()=>{
 const s=createState(road);
 for(let i=0;i<24000;i++){
  integrate(s,{throttle:i%950<700?1:0,brake:i%950>850?1:0,steer:Math.sin(i*.003),handbrake:i%1600>1500},road,dt);
  for(const k of ['x','z','speed','lateral','heading','yaw','rpm'])assert.ok(Number.isFinite(s[k]),k);
  assert.ok(Math.abs(s.yaw)<10);assert.ok(Math.abs(s.lateral)<90);
 }
});

test('coasting from rest rolls downhill, but brakes hold',()=>{
 const downhill={...road,ty:-.15};
 const free=run(createState(road),{},3,downhill),held=run(createState(road),{brake:1,throttle:1},3,downhill);
 assert.ok(free.speed>1);assert.equal(held.speed,0);
 const uphill=run(createState(road),{},3,{...road,ty:.15});assert.ok(uphill.speed<-1);
});
test('30, 60 and 120 Hz caller deltas produce the same fixed-step motion',()=>{
 const states=[30,60,120].map(hz=>{const s=createState(road);for(let i=0;i<hz*2;i++)integrate(s,{throttle:1,steer:.3},road,1/hz);return s;});
 for(const s of states)for(const k of ['elapsed','speed','lateral','heading','z'])assert.ok(Math.abs(s[k]-states[0][k])<1e-8,k);
});

test('ordinary braking through a bend stays controllable without spinning',()=>{
 for(const speed of [15,22,30]){
  const p={...road,width:100,railOffset:50.62},s=createState(p);s.speed=speed;s.gear=2;
  run(s,{throttle:.2,steer:.8},.6,p);
  let maxSlip=0;
  for(let i=0;i<90;i++){integrate(s,{steer:.8,brake:1},p,dt);if(s.speed>3)maxSlip=Math.max(maxSlip,Math.abs(Math.atan2(s.lateral,s.speed)));}
  assert.ok(maxSlip<.21,`braking sideslip ${maxSlip} at ${speed} m/s`);
  run(s,{throttle:.35},1.25,p);
  assert.ok(Math.abs(s.yaw)<.15,'releasing steering settles rotation');
 }
});

test('a short handbrake turn produces a limited slide and regains grip on release',()=>{
 for(const speed of [15,22,30]){
  const p={...road,width:100,railOffset:50.62},s=createState(p);s.speed=speed;s.gear=2;
  run(s,{throttle:.2,steer:.8},.6,p);run(s,{steer:.8,handbrake:true},.5,p);
  const slip=Math.abs(Math.atan2(s.lateral,s.speed));
  assert.ok(slip>.08&&slip<.60,`deliberate slide angle ${slip} at ${speed} m/s`);
  run(s,{throttle:.35},1.25,p);
  assert.ok(Math.abs(Math.atan2(s.lateral,s.speed))<.10,'rear grip returns after release');
  assert.ok(Math.abs(s.yaw)<.15,'slide does not keep rotating');
  assert.ok(s.speed>speed*.55,'a handbrake tap preserves useful forward speed');
 }
});

test('a square-on barrier impact stops the car without an arbitrary sideways spin',()=>{
 for(const angle of [-Math.PI/2-.001,-Math.PI/2,-Math.PI/2+.001]){
  const s=createState(road);s.x=-3.6;s.heading=angle;s.speed=20;
  constrain(s,{...road,offset:-s.x},3000);
  assert.ok(Math.abs(s.yaw)<.1,`head-on yaw ${s.yaw}`);
  assert.ok(Math.abs(s.speed)<1,'direct impact removes normal speed');
 }
});

test('a shallow barrier scrape keeps moving without a sudden spin',()=>{
 const s=createState(road);s.x=-3.6;s.heading=-.2;s.speed=20;
 constrain(s,{...road,offset:-s.x},3000);
 assert.ok(s.speed>17,'scrape preserves forward motion');
 assert.ok(Math.abs(s.yaw)<.7,`scrape yaw ${s.yaw}`);
});
