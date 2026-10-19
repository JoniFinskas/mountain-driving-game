import * as THREE from 'three';
import {length,sample,nearest,surfaceOrientation} from './road.js';
import {createWorld,loadLandscapeAssets} from './world.js';
import {loadCar} from './car.js';
import {DrivingAudio} from './audio.js';
import {createState,integrate,constrain,clamp} from './driving.js';
import {maps,activeMap,paints} from './maps.js';
import {events,createRun,updateRun,resetRunPosition,loadRecord,saveRecord,medalTargets,formatTime as time} from './events.js';
import {createTyreMarks,createRouteMarker,createGhost} from './drive-effects.js';
import {createNavigation} from './navigation.js';
import {createProgress} from './progress.js';
import {createAdaptiveResolution,graphicsPixelRatio,graphicsPresets} from './graphics.js';
import {createDropdown} from './vendor/ui-controls.js';

const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.20,60000);
let renderer,world,vehicle,tyreMarks,routeMarker,ghost,state=createState(sample(0)),ready=false,started=false,paused=false,mode=0,clock=0,accumulator=0,noticeUntil=0,last=0,uiClock=0,redraw=true,photo=false;
let selectedEvent=activeMap.kind==='circuit'?'lap':'sprint',run=createRun(selectedEvent,length,activeMap.kind==='circuit'),record=null,paint='matte-black';
const sessionRecords=createProgress();
let graphics='auto';const adaptiveResolution=createAdaptiveResolution();
let graphicsLost=false;
let countdown=0,countdownBeat=0,goUntil=0;
const keys=new Set(),touch=new Set(),reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const cameraPoint=new THREE.Vector3(),targetPoint=new THREE.Vector3(),cameraForward=new THREE.Vector3(),cameraRight=new THREE.Vector3(),cameraBase=new THREE.Vector3();
const navigation=createNavigation($('#map'));
if(activeMap.kind==='circuit'){$('#map-mode').textContent='Full route';$('#map-view').setAttribute('aria-pressed','true');}
const audio=new DrivingAudio();let sound=false,soundChosen=false,sensitivity=.85;audio.volume=.75;
const look={pointer:null,x:0,y:0,yaw:0,pitch:0};
const viewpointNames=activeMap.kind==='circuit'?['Mercedes Arena','Dunlop hairpin','Final chicane']:activeMap.kind==='classic'?['Cliffside terrace','Summit lookout','Southern descent']:['Northern bay','Upper sea terrace','Southern headland'];
const viewpoints=viewpointNames.map((name,i)=>({name,s:length*[.18,.45,.72][i],found:false}));
const controls=()=>({throttle:keys.has('KeyW')||keys.has('ArrowUp')||touch.has('throttle')?1:0,brake:keys.has('KeyS')||keys.has('ArrowDown')||touch.has('brake')?1:0,steer:(keys.has('KeyA')||keys.has('ArrowLeft')||touch.has('left')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')||touch.has('right')?1:0),sensitivity,handbrake:keys.has('Space')||touch.has('handbrake')});
function releaseLook(){look.pointer=null;$('#game').classList.remove('looking');}
function clearInput(){keys.clear();touch.clear();releaseLook();all('[data-control]').forEach(b=>b.classList.remove('held'));}
function handleGraphicsLoss(event){
  event.preventDefault();graphicsLost=true;ready=false;paused=true;clearInput();updateSound(0);renderer.setAnimationLoop(null);
  for(const dialog of all('dialog[open]'))dialog.close();
  $('#graphics-error-dialog').showModal();
}
function notify(text,seconds=3){$('#notice').hidden=false;$('#notice').textContent=text;$('#notice').classList.add('visible');noticeUntil=clock+seconds;}
let resizeFrame=0;
function resize(){
  if(!renderer)return;const {width,height}=$('#scene').getBoundingClientRect();if(width<1||height<1)return;
  const size=renderer.getSize(new THREE.Vector2());if(size.x!==width||size.y!==height){renderer.setSize(width,height,false);adaptiveResolution.reset();}
  updateRenderResolution(width,height);
  camera.aspect=width/height;camera.updateProjectionMatrix();redraw=true;updateScrollHint();
}
function updateRenderResolution(width,height){
  const ratio=graphicsPixelRatio(graphics,width,height,devicePixelRatio,adaptiveResolution.scale);
  if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
}
function queueResize(){if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;resize();});}
function updateScrollHint(){const content=$('.pause-content');$('#pause-scroll-note').hidden=!$('#pause-dialog').open||content.scrollTop+content.clientHeight>=content.scrollHeight-4;}
function syncPauseMenu(){
  viewControl.setValue(mode);$('#menu-sound').textContent=sound?'Sound on':'Sound off';$('#menu-sound').setAttribute('aria-pressed',String(sound));
  $('#pause-time').textContent=time(run.time);$('#pause-lap-status').textContent=run.name+(run.valid?'':' · practice');
  $('#pause-distance').textContent=Math.max(0,state.travel/1000).toFixed(2)+' km';$('#pause-route').textContent=(length/1000).toFixed(1)+' km';
}
function pause(showDialog=true){if(!started||paused)return;paused=true;redraw=true;clearInput();hud();updateSound(0);$('#pause').textContent='Continue';if(showDialog){syncPauseMenu();$('#pause-dialog').showModal();$('.pause-content').scrollTop=0;updateScrollHint();}}
function resume(){if(!ready||run.finished)return;photo=false;$('#game').classList.remove('photo-mode');$('#photo-controls').hidden=true;paused=false;clearInput();$('#pause-dialog').close();$('#pause').textContent='Pause';last=performance.now();}
function beginRun(id=selectedEvent){
  countdown=id==='free'?0:3;countdownBeat=0;goUntil=0;$('#race-countdown').hidden=!countdown;$('#race-countdown').textContent=countdown?'3':'';
  selectedEvent=id;eventControl.setValue(id);welcomeEvent.setValue(id);run=createRun(id,length,activeMap.kind==='circuit');record=loadRecord(sessionRecords,activeMap,id);
  state=createState(sample(0));accumulator=0;look.yaw=look.pitch=0;noticeUntil=0;$('#notice').classList.remove('visible');tyreMarks?.clear();clearInput();updateCar(0);updateCamera(0,true);hud();
}
function reset(restart=false){
  if(!ready||run.finished)return;
  if(restart){beginRun();notify(run.id==='free'?'Stop at the marked viewpoints.':'Run restarted',5);return;}
  const old=state;state=createState(sample(state.s));Object.assign(state,{health:old.health,wrecked:old.wrecked,elapsed:old.elapsed,travel:old.travel});
  resetRunPosition(run,state.travel);tyreMarks.break();clearInput();updateCar(0);updateCamera(0,true);notify('Back on the road · practice run · damage retained',4);
}
function updateCar(dt){
  if(!vehicle)return;const p=sample(state.s);vehicle.root.position.set(state.x,state.y+.027,state.z);surfaceOrientation(p,state.heading,vehicle.root.quaternion);
  const lean=reduceMotion.matches?0:clamp(state.lateralAcceleration*.0024,-.030,.030);
  vehicle.body.rotation.z=THREE.MathUtils.damp(vehicle.body.rotation.z,lean,8,dt);vehicle.body.rotation.x=THREE.MathUtils.damp(vehicle.body.rotation.x,reduceMotion.matches?0:clamp(state.acceleration*.0021,-.024,.016),7,dt);
  vehicle.update(state.speed,state.steer,dt,controls().brake>0,state);
}
function updateCamera(dt,snap=false){
  if(look.pointer===null&&!photo){look.yaw=THREE.MathUtils.damp(look.yaw,0,reduceMotion.matches?30:3,dt);look.pitch=THREE.MathUtils.damp(look.pitch,0,reduceMotion.matches?30:3,dt);}
  const heading=state.heading,f=cameraForward.set(Math.sin(heading),0,Math.cos(heading)),right=cameraRight.set(Math.cos(heading),0,-Math.sin(heading)),base=cameraBase.set(state.x,state.y,state.z);
  if(!started){cameraPoint.copy(base).addScaledVector(f,-8.8).addScaledVector(right,5.5);cameraPoint.y+=4.2;targetPoint.copy(base).addScaledVector(f,5);targetPoint.y+=1.;}
  else if(mode===1){cameraPoint.copy(base).addScaledVector(f,.25);cameraPoint.y+=1.13;targetPoint.copy(cameraPoint).add(new THREE.Vector3(Math.sin(heading+look.yaw)*80,Math.sin(look.pitch)*60,Math.cos(heading+look.yaw)*80));}
  else {const mobile=innerWidth<700,distance=(mode===2?14:9.2)+(mobile?3.3:0),angle=heading+look.yaw;
    cameraPoint.set(base.x-Math.sin(angle)*distance,base.y+(mode===2?6.7:mobile?4.5:3.5)+Math.sin(look.pitch)*distance,base.z-Math.cos(angle)*distance);
    targetPoint.copy(base).addScaledVector(f,(mode===2?10:11)*Math.max(0,Math.cos(look.yaw)));targetPoint.y+=mobile?1:2.7;
  }
  camera.position.copy(cameraPoint);camera.lookAt(targetPoint);const fov=mode===1?67:60;if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}if(snap)redraw=true;
}
function nextGoal(){
  if(run.id==='free')return viewpoints.find(p=>!p.found)?.s??null;
  return run.finished?null:run.checkpoints[run.next]%length;
}
function hud(){
  const kph=Math.round(Math.hypot(state.speed,state.lateral)*3.6);$('#speed').textContent=kph;$('#gear').textContent=state.speed<-.1?'R':kph<2?'N':state.gear;$('#rpm-fill').style.width=state.rpm/70+'%';
  $('#event-name').textContent=run.name;$('#lap-time').textContent=time(run.time);$('#best-time').textContent=record?(run.id==='drift'?'Best '+record.score+' points':'Best '+time(record.time)):run.valid?'No personal best yet':'Practice · reset used';
  $('#altitude').textContent=Math.round(state.y)+' m';$('#progress').textContent=(Math.max(0,run.progress)/1000).toFixed(2)+' km';$('#car-health').value=state.health;$('#health-value').textContent=Math.ceil(state.health)+'%';
  $('#grip').textContent=state.wrecked?'Car disabled':state.health<35?'Engine damaged':controls().handbrake?'Handbrake engaged':state.collision>0?'Guardrail contact':state.offroad?'Loose shoulder':state.slip>.13?'Tyre grip limit':'Tyres gripping';
  const goal=nextGoal();
  $('#goal-title').textContent=run.id==='free'?(viewpoints.find(p=>!p.found)?.name||'All viewpoints discovered'):run.id==='drift'?run.score+' points · '+Math.round(run.pendingScore)+' to bank':run.id==='clean'?'Reach the finish without contact':run.next===11?'Finish ahead':'Checkpoint '+Math.min(12,run.next+1)+' / 12';
  $('#goal-distance').textContent=run.id==='free'?viewpoints.filter(p=>p.found).length+' / 3 viewpoints'+(goal!==null?' · '+Math.round((goal-state.s+length)%length)+' m ahead':''):Math.max(0,Math.round(run.distance-run.progress))+' m to finish';
  $('#sector-status').textContent=run.sectors.map((value,i)=>'S'+(i+1)+' '+time(value)).join(' · ');
  const a=sample(state.s+30),b=sample(state.s+65),turn=Math.atan2(a.tx*b.tz-a.tz*b.tx,a.tx*b.tx+a.tz*b.tz),abs=Math.abs(turn);
  $('#bend').textContent=a.width<6.3?'Narrow cliff road':abs>.65?'Tight '+(turn<0?'left':'right'):abs>.22?(turn<0?'Left':'Right')+' bend':'Open road';$('#bend-icon').textContent=abs>.22?(turn<0?'↰':'↱'):'↑';
  $('#bend-distance').textContent=a.width<6.3?'Hold your line · limited clearance':abs>.65?'Brake before turn-in':abs>.22?'Balance throttle through the bend':'Build speed smoothly';navigation.draw(state,goal,run.id==='free'?viewpoints:[],run.id==='free'?null:run.distance%length);
}
function updateSound(dt){const input=controls();audio.update({speed:Math.abs(state.speed),slip:state.slip,throttle:state.wrecked?0:input.throttle,brake:input.brake||input.handbrake?1:0,rpm:state.rpm,gear:state.gear,popCount:state.popCount,popStrength:state.popStrength,exhaustPop:state.exhaustPop,impact:state.impact,offroad:state.offroad,collision:state.collision,active:started&&!paused&&!state.wrecked,bonnet:mode===1},dt);}
async function toggleSound(){
  sound=!sound;$('#sound').disabled=$('#menu-sound').disabled=true;$('#sound').textContent=sound?'Loading audio…':'Sound off';
  try{await audio.enable(sound);}catch(error){sound=false;notify('Sound could not load. You can keep driving and turn sound on to retry.',5);console.error(error);}
  $('#sound').disabled=$('#menu-sound').disabled=false;$('#sound').textContent=sound?'Sound on':'Sound off';$('#sound').setAttribute('aria-pressed',String(sound));syncPauseMenu();
}
function finish(result){
  paused=true;clearInput();updateCar(0);hud();updateSound(0);redraw=true;
  const saved=saveRecord(sessionRecords,activeMap,run);record=saved.best;
  $('#result-eyebrow').textContent=activeMap.name+' · '+run.name;$('#result-title').textContent=result.title==='Finish'?'Finished':result.title==='Car disabled'?'Car disabled':'Barrier contact';
  $('#result-message').textContent=activeMap.name+' · '+run.name+'. '+result.message;$('#result-time').textContent=run.id==='drift'?run.score+' pts':time(run.time);$('#result-medal').textContent=result.medal?result.medal+' medal':result.completed?'Medal target: '+medalTargets(run):'Car condition '+Math.ceil(state.health)+'%';
  $('#result-sectors').replaceChildren(...run.sectors.map((value,i)=>{const span=document.createElement('span'),strong=document.createElement('strong');span.textContent='Sector '+(i+1);strong.textContent=time(value);span.append(strong);return span;}));
  $('#record-status').textContent=saved.improved?'New personal best · for this session.':result.completed&&!run.valid?'A reset makes this a practice result.':record?'Personal best '+(run.id==='drift'?record.score+' points':time(record.time)):'Retry with a fully repaired car.';
  $('#result-dialog').showModal();$('#retry').focus();
}
function step(dt){
  if(countdown>0){const beat=Math.ceil(countdown);if(beat!==countdownBeat){countdownBeat=beat;audio.startTone(false);}
    countdown=Math.max(0,countdown-dt);$('#race-countdown').textContent=countdown>0?String(Math.ceil(countdown)):'GO';
    if(countdown===0){audio.startTone(true);goUntil=clock+.75;}return;
  }
  const p=nearest(state.x,state.z,state.index)||sample(state.s);integrate(state,controls(),p,dt);const next=nearest(state.x,state.z,state.index),hit=next?constrain(state,next,length):false;
  if(hit)notify('Guardrail contact · car condition '+Math.ceil(state.health)+'%',2);
  const result=updateRun(run,state,dt,hit||state.barrierContact);if(result){finish(result);return;}
  if(run.id==='free'&&Math.abs(state.speed)<4){
    for(const point of viewpoints){if(point.found)continue;const p=sample(point.s);if(Math.hypot(state.x-p.x,state.z-p.z)<25){point.found=true;notify(point.name+' discovered · '+viewpoints.filter(p=>p.found).length+' / 3',5);}}
  }
}
function render(now){
  if(document.hidden||((paused||!started)&&!redraw&&!photo)){last=now;adaptiveResolution.reset();return;}
  if(graphics==='auto'&&adaptiveResolution.sample(now-last,ready&&started&&!paused&&!countdown)!==null){const size=renderer.getSize(new THREE.Vector2());updateRenderResolution(size.x,size.y);}
  const dt=Math.min((now-last)/1000||0,.08);last=now;clock+=dt;
  if(started&&!paused){accumulator+=dt;while(accumulator>=1/120&&!paused){step(1/120);accumulator-=1/120;}updateCar(dt);tyreMarks.update(state);}
  updateSound(dt);
  if(ready){updateCamera(dt);world.update(clock,vehicle.root.position);routeMarker.update(nextGoal(),state,run.next===11);ghost.update(record?.ghost,run.time,$('#ghost-setting').checked&&!paused&&run.valid&&run.id!=='free',vehicle.root.position);}
  if(goUntil&&clock>goUntil){$('#race-countdown').hidden=true;goUntil=0;}
  if(clock>noticeUntil)$('#notice').classList.remove('visible');uiClock+=dt;if(uiClock>.08){hud();uiClock=0;}world.render(camera);redraw=false;
}
async function init(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.domElement.addEventListener('webglcontextlost',handleGraphicsLoss);
    $('#scene').append(renderer.domElement);resize();window.addEventListener('resize',queueResize);new ResizeObserver(queueResize).observe($('#scene'));
    const [loadedCar,hdri]=await Promise.all([loadCar(),loadLandscapeAssets()]);await new Promise(r=>setTimeout(r,30));if(graphicsLost)return;world=createWorld(scene,renderer,hdri);world.setQuality(graphicsPresets[graphics].detail,graphicsPresets[graphics].shadow,graphicsPresets[graphics].groundFiltering);$('#load-status').textContent='Preparing the car';vehicle=loadedCar;vehicle.setPaint(paint);scene.add(vehicle.root);
    tyreMarks=createTyreMarks(scene,vehicle.wheels.filter(w=>!w.front).map(w=>w.center));routeMarker=createRouteMarker(scene);ghost=createGhost(scene);ready=true;record=loadRecord(sessionRecords,activeMap,selectedEvent);updateCar(0);updateCamera(0,true);world.update(0,vehicle.root.position);await world.prepare(camera);
    if(graphicsLost)return;
    $('#start').disabled=false;$('#start').textContent='Start driving';$('#load-status').textContent='';$('#route-distance').textContent=(length/1000).toFixed(1)+' km · '+activeMap.name;renderer.setAnimationLoop(render);
  }catch(error){
    console.error(error);ready=false;clearInput();renderer?.setAnimationLoop(null);
    $('#load-status').setAttribute('role','alert');
    $('#load-status').textContent=renderer?'The game could not start. Check your connection and reload.':'This game needs WebGL 2. Enable graphics acceleration or try an up-to-date browser.';
    $('#start').textContent='Reload game';$('#start').disabled=false;$('#start').onclick=()=>location.reload();
  }
}
function changeMap(id){if(id===activeMap.id)return;const url=new URL(location.href);url.searchParams.set('map',id);location.assign(url.href);}
function chooseEvent(id){selectedEvent=id;welcomeEvent.setValue(id);eventControl.setValue(id);const next=createRun(id,length,activeMap.kind==='circuit');$('#event-description').textContent=events.find(event=>event.id===id).description;$('#medal-targets').textContent=medalTargets(next);}
function choosePaint(id){paint=id;vehicle?.setPaint(id);paintControl.setValue(id);all('.paint-swatch').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.paint===id)));redraw=true;}
const mapItems=maps.map(map=>({value:map.id,label:map.name,description:map.distance+' · '+map.description})),eventItems=events.map(event=>({value:event.id,label:event.name,description:event.description}));
const welcomeMap=createDropdown($('#welcome-map-control'),{id:'welcome-map',label:'Road',value:activeMap.id,items:mapItems,onChange:changeMap});
const mapControl=createDropdown($('#map-control'),{id:'map-setting',label:'Road',value:activeMap.id,items:mapItems,onChange:changeMap});
const welcomeEvent=createDropdown($('#welcome-event-control'),{id:'welcome-event',label:'Event',value:selectedEvent,items:eventItems,onChange:chooseEvent});
const eventControl=createDropdown($('#event-control'),{id:'event-setting',label:'Next event',value:selectedEvent,items:eventItems,onChange:chooseEvent});
const viewControl=createDropdown($('#view-control'),{id:'view-setting',label:'Camera',value:'0',items:['Chase','Bonnet','Wide'].map((label,i)=>({value:String(i),label})),onChange:value=>{mode=Number(value);$('#camera').textContent=['Chase camera','Bonnet camera','Wide camera'][mode];updateCamera(0,true);}});
const graphicsControl=createDropdown($('#graphics-control'),{id:'graphics-setting',label:'Graphics',value:graphics,items:[{value:'auto',label:'Automatic',description:'Adapts the picture for smoother driving'},{value:'performance',label:'Performance',description:'Lower resolution and lighter shadows'},{value:'balanced',label:'Balanced',description:'Sharper image and more detailed trees'},{value:'high',label:'High',description:'Highest resolution; faster GPU recommended'}],onChange:value=>{
  graphics=value;adaptiveResolution.reset(true);const {detail,shadow,groundFiltering}=graphicsPresets[value];
  world?.setQuality(detail,shadow,groundFiltering);queueResize();redraw=true;
}});
const paintControl=createDropdown($('#paint-control'),{id:'paint-setting',label:'Car colour',value:paint,items:paints.map(paint=>({value:paint.id,label:paint.name})),onChange:choosePaint});
for(const preset of paints){const button=document.createElement('button');button.className='paint-swatch';button.dataset.paint=preset.id;button.style.setProperty('--paint',preset.color);button.setAttribute('aria-label',preset.name);button.setAttribute('aria-pressed',String(preset.id===paint));button.title=preset.name;button.onclick=()=>choosePaint(preset.id);$('#paint-swatches').append(button);}
$('#map-description').textContent=activeMap.description;$('#map-location').textContent=activeMap.location;$('#map-origin').textContent=activeMap.kind==='circuit'?'Unofficial GP layout · simplified elevation and scenery':'A fictional coastal road';$('#menu-location').textContent=activeMap.name;chooseEvent(selectedEvent);
function showRange(input){const value=Number(input.value);$('#'+input.id+'-value').textContent=value+'%';input.style.setProperty('--range-fill',((value-Number(input.min))/(Number(input.max)-Number(input.min))*100)+'%');input.setAttribute('aria-valuetext',value+'%');}
$('#volume').oninput=e=>{audio.volume=Number(e.target.value)/100;showRange(e.target);};$('#sensitivity').oninput=e=>{sensitivity=Number(e.target.value)/100;showRange(e.target);};all('.setting input[type="range"]').forEach(showRange);
$('#menu-sound').onclick=()=>{soundChosen=true;toggleSound();};
$('#exit-game').disabled=true;
function exitToMenu(){
  paused=true;started=false;countdown=0;goUntil=0;photo=false;clearInput();updateSound(0);
  all('dialog[open]').forEach(dialog=>dialog.close());$('#game').classList.remove('photo-mode');$('#photo-controls').hidden=true;
  $('#race-countdown').hidden=true;$('#notice').hidden=true;$('#notice').classList.remove('visible');$('#welcome').hidden=false;
  $('#hud').hidden=$('#drive-info').hidden=$('#touch-controls').hidden=true;$('#pause').textContent='Pause';$('#exit-game').disabled=true;redraw=true;$('#start').focus();
}
$('#exit-game').onclick=$('#menu-exit').onclick=exitToMenu;
$('#start').onclick=()=>{if(!ready)return;beginRun();started=true;paused=false;$('#exit-game').disabled=false;$('#welcome').hidden=true;$('#hud').hidden=$('#drive-info').hidden=$('#touch-controls').hidden=false;clearInput();updateCamera(0,true);notify(run.id==='free'?'Slow down at the marked viewpoints to discover them.':'Follow the gold checkpoints to the finish. Brake before tight bends.',6);if(!soundChosen&&!sound)toggleSound();};
async function fullScreen(){
  const game=$('#game'),focus=game.classList.contains('focus-view');
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(focus)game.classList.remove('focus-view');
    else if(game.requestFullscreen)await game.requestFullscreen({navigationUI:'hide'});
    else throw new Error('Fullscreen unavailable');
    $('#display-status').textContent='';
  }catch{game.classList.add('focus-view');$('#display-status').textContent='This browser blocks full screen. Focus view now fills the browser window.';}
  syncFullscreen();queueResize();
}
function syncFullscreen(){$('#full-screen span').textContent=document.fullscreenElement?'Exit full screen':$('#game').classList.contains('focus-view')?'Exit focus view':'Full screen';}
$('#full-screen').onclick=fullScreen;document.addEventListener('fullscreenchange',()=>{syncFullscreen();queueResize();});
$('#pause-dialog').addEventListener('keydown',e=>{
  if(e.key!=='Tab'||e.ctrlKey||e.altKey||e.metaKey||document.querySelector('[data-game-dropdown]'))return;
  const targets=[...e.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')].filter(element=>element.getClientRects().length&&element.tabIndex>=0),first=targets[0],last=targets.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});
$('.pause-content').addEventListener('scroll',updateScrollHint,{passive:true});
$('#pause').onclick=()=>paused?resume():pause();$('#resume').onclick=$('#pause-close').onclick=resume;$('#restart').onclick=()=>{reset(true);resume();};$('#pause-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!document.querySelector('[data-game-dropdown]'))resume();});
$('#reset').onclick=()=>reset();$('#camera').onclick=()=>{mode=(mode+1)%3;viewControl.setValue(mode);$('#camera').textContent=['Chase camera','Bonnet camera','Wide camera'][mode];if(ready)updateCamera(0,true);};$('#sound').onclick=()=>{soundChosen=true;toggleSound();};
$('#map-view').onclick=()=>{const overview=navigation.toggle();$('#map-view').setAttribute('aria-pressed',String(overview));$('#map-mode').textContent=overview?'Full route':'Nearby route';hud();};
$('#retry').onclick=()=>{$('#result-dialog').close();beginRun();resume();};$('#result-free').onclick=()=>{$('#result-dialog').close();beginRun('free');resume();};$('#choose-drive').onclick=()=>{$('#result-dialog').close();started=false;paused=false;$('#welcome').hidden=false;$('#hud').hidden=$('#drive-info').hidden=$('#touch-controls').hidden=true;beginRun();countdown=0;$('#race-countdown').hidden=true;$('#exit-game').disabled=true;$('#welcome-event').focus();};$('#result-dialog').addEventListener('cancel',e=>{e.preventDefault();$('#choose-drive').click();});
$('#photo-mode').onclick=()=>{photo=true;$('#pause-dialog').close();$('#game').classList.add('photo-mode');$('#photo-controls').hidden=false;redraw=true;};$('#photo-exit').onclick=resume;
const surface=$('#scene');surface.addEventListener('pointerdown',e=>{if(!started||(paused&&!photo)||(e.pointerType==='mouse'&&e.button!==0&&e.button!==2))return;e.preventDefault();surface.setPointerCapture(e.pointerId);Object.assign(look,{pointer:e.pointerId,x:e.clientX,y:e.clientY});$('#game').classList.add('looking');});
surface.addEventListener('pointermove',e=>{if(e.pointerId!==look.pointer)return;look.yaw=clamp(look.yaw-(e.clientX-look.x)*.006,-Math.PI,Math.PI);look.pitch=clamp(look.pitch+(e.clientY-look.y)*.005,-.12,.75);look.x=e.clientX;look.y=e.clientY;redraw=true;});for(const event of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(event,releaseLook);surface.addEventListener('dblclick',()=>{look.yaw=look.pitch=0;redraw=true;});surface.addEventListener('contextmenu',e=>e.preventDefault());
let creditWasPaused=false;$('#credits-button').onclick=()=>{creditWasPaused=paused;pause(false);$('#credits').showModal();};$('#credits .close').onclick=()=>$('#credits').close();$('#credits').addEventListener('close',()=>{if(started&&!creditWasPaused)resume();$('#credits-button').focus();});
window.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&photo){e.preventDefault();resume();return;}
  if(e.code==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();pause();return;}
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||document.querySelector('dialog[open]')||document.querySelector('[data-game-dropdown]'))return;
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)){if(started&&!paused){e.preventDefault();keys.add(e.code);}}
  if(e.repeat)return;if(e.code==='KeyR'&&started)reset();if(e.code==='KeyC')$('#camera').click();
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{clearInput();pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();}});
all('[data-control]').forEach(b=>{b.addEventListener('pointerdown',e=>{if(paused)return;e.preventDefault();b.setPointerCapture(e.pointerId);touch.add(b.dataset.control);b.classList.add('held');});const release=()=>{touch.delete(b.dataset.control);b.classList.remove('held');};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});
export function telemetry(){return {ready,started,paused,mode,speed:state.speed,lateral:state.lateral,yaw:state.yaw,rpm:state.rpm,gear:state.gear,popCount:state.popCount,roadWidth:sample(state.s).width,health:state.health,wrecked:state.wrecked,tyreMarks:tyreMarks?.count||0,event:run.id,checkpoints:run.next,goal:nextGoal(),score:run.score,finished:run.finished,look:{yaw:look.yaw,pitch:look.pitch},impact:state.impact,position:[state.x,state.y,state.z],s:state.s,travel:state.travel,elapsed:state.elapsed,runTime:run.time,slip:state.slip,heading:state.heading,offroad:state.offroad,audio:audio.status(),input:controls(),acceleration:state.acceleration,grade:sample(state.s).ty,routeLength:length,map:activeMap.id,paint,cameraFov:camera.fov,cameraPosition:camera.position.toArray(),triangles:renderer?.info.render.triangles,drawCalls:renderer?.info.render.calls};}
$('#reload-graphics').addEventListener('click',()=>location.reload());
$('#graphics-error-dialog').addEventListener('cancel',event=>event.preventDefault());
init();
