export const events=Object.freeze([
  {id:'sprint',name:'Sprint',description:'Reach the finish as quickly as you can.'},
  {id:'clean',name:'Clean run',description:'Complete the section without touching a barrier.'},
  {id:'lap',name:'Full lap',description:'One complete lap. Three sectors. Beat your best.'},
  {id:'drift',name:'Controlled drift',description:'Slide forward, then regain grip to bank points.'},
  {id:'free',name:'Free drive',description:'Explore at your own pace and find three viewpoints.'},
]);
export const formatTime=t=>`${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')}`;
export function createRun(id,routeLength,circuit=false){
  const event=events.find(event=>event.id===id)||events[0],distance=event.id==='lap'||(circuit&&event.id==='sprint')?routeLength:event.id==='clean'?routeLength/3:event.id==='free'?Infinity:Math.min(1200,routeLength*.45);
  const checkpoints=Number.isFinite(distance)?Array.from({length:12},(_,i)=>(i+1)*distance/12):[];
  return {id:event.id,name:event.name,distance,checkpoints,next:0,time:0,progress:0,furthest:0,previousTravel:0,valid:true,finished:false,result:null,sectors:[],sectorStart:0,score:0,pendingScore:0,recovery:0,combo:1,viewpoints:[],ghost:[],ghostClock:0};
}
export function resetRunPosition(run,travel){run.valid=false;run.pendingScore=0;run.combo=1;run.previousTravel=travel;run.ghost.length=0;}
export function updateRun(run,state,dt,hit=false){
  if(run.finished)return run.result;
  const before=run.time;run.time+=dt;
  const delta=state.travel-run.previousTravel;run.previousTravel=state.travel;
  if(!Number.isFinite(delta)||Math.abs(delta)>Math.max(3,Math.abs(state.speed)*dt*2)){run.valid=false;return null;}
  const previous=run.progress;run.progress+=delta;
  const newDistance=Math.max(0,run.progress-run.furthest);run.furthest=Math.max(run.furthest,run.progress);
  if(state.wrecked)return endRun(run,'Car disabled','The car needs repairs. Retry with a fresh car.');
  if(hit){run.pendingScore=0;run.combo=1;if(run.id==='clean')return endRun(run,'Barrier contact','Keep a clean line from start to finish.');}
  if(run.id==='drift'){
    const angle=Math.abs(Math.atan2(state.lateral,Math.max(1,state.speed)));
    if(!hit&&state.speed>8&&delta>0&&angle>.12&&angle<.65&&!state.offroad){run.pendingScore+=newDistance*angle*18*run.combo;run.recovery=0;}
    else if(run.pendingScore>0){
      if(state.speed>5&&delta>0&&angle<.08&&!state.offroad){run.recovery+=dt;if(run.recovery>.65){run.score+=Math.round(run.pendingScore);run.pendingScore=0;run.combo=Math.min(3,run.combo+.25);}}
      else run.recovery=0;
    }
  }
  while(run.next<run.checkpoints.length&&run.progress>=run.checkpoints[run.next]){
    const checkpoint=run.checkpoints[run.next],crossing=before+dt*Math.max(0,Math.min(1,(checkpoint-previous)/Math.max(1e-9,run.progress-previous)));
    run.next++;if(run.next%4===0){run.sectors.push(crossing-run.sectorStart);run.sectorStart=crossing;}
    if(run.next===run.checkpoints.length){run.time=crossing;return endRun(run,'Finish',run.valid?'Your run is complete.':'Practice finish · reset used.');}
  }
  run.ghostClock+=dt;
  if(run.valid&&run.id!=='free'&&run.ghostClock>=.1){run.ghostClock=0;run.ghost.push([+run.time.toFixed(2),+state.x.toFixed(2),+state.y.toFixed(2),+state.z.toFixed(2),+state.heading.toFixed(4)]);if(run.ghost.length>6000){run.ghost=run.ghost.filter((_,i)=>i%2===0);}}
  return null;
}
function endRun(run,title,message){
  run.finished=true;
  const completed=title==='Finish',pace=run.distance/Math.max(.1,run.time);
  const medal=!completed||!run.valid?null:run.id==='drift'?(run.score>=1800?'Gold':run.score>=900?'Silver':run.score>=350?'Bronze':null):(pace>=22?'Gold':pace>=17?'Silver':pace>=12?'Bronze':null);
  run.result={title,message,completed,eligible:completed&&run.valid,medal};return run.result;
}
export function medalTargets(run){return run.id==='drift'?'Gold 1,800 · Silver 900 · Bronze 350 points':Number.isFinite(run.distance)?`Gold ${formatTime(run.distance/22)} · Silver ${formatTime(run.distance/17)} · Bronze ${formatTime(run.distance/12)}`:'Slow down at each marked viewpoint to discover it.';}
export function recordKey(map,event){return `mountain-driving:records:${map.id}:v${map.version}:handling-3:${event}${map.kind==='circuit'&&event==='sprint'?':full-circuit':''}`;}
export function loadRecord(storage,map,event){
  try{const value=JSON.parse(storage?.getItem(recordKey(map,event))||'null');
    if(!value||!Number.isFinite(value.time)||value.time<=0||!Number.isFinite(value.score)||value.score<0||!Array.isArray(value.sectors)||value.sectors.length>3||value.sectors.some(t=>!Number.isFinite(t)||t<0)||![null,'Gold','Silver','Bronze'].includes(value.medal))return null;
    if(!Array.isArray(value.ghost)||value.ghost.length>6000||value.ghost.some((p,i)=>!Array.isArray(p)||p.length!==5||p.some(v=>!Number.isFinite(v))||p[0]<0||p[0]>value.time+.02||(i>0&&p[0]<=value.ghost[i-1][0])))value.ghost=[];
    return value;
  }catch{return null;}
}
export function saveRecord(storage,map,run){
  const previous=loadRecord(storage,map,run.id);
  const better=run.id==='drift'?run.score>(previous?.score??-1):run.time<(previous?.time??Infinity);
  if(!run.result?.eligible||!better)return {best:previous,saved:false};
  const best={time:run.time,score:run.score,medal:run.result.medal,sectors:run.sectors,ghost:run.ghost};
  try{storage?.setItem(recordKey(map,run.id),JSON.stringify(best));return {best,saved:!!storage,improved:true};}catch{return {best,saved:false,improved:true};}
}
