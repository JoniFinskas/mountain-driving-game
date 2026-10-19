import {frames,routeBounds,sample} from './road.js';
import {coastX} from './geography.js';
import {activeMap} from './maps.js';

export function createNavigation(canvas){
  const c=canvas.getContext('2d'),route=new Path2D(),land=new Path2D(),size=canvas.width,centre=size/2;
  frames.forEach((p,i)=>{if(i%3===0)i?route.lineTo(p.x,p.z):route.moveTo(p.x,p.z);});route.closePath();
  const mid={x:(routeBounds.minX+routeBounds.maxX)/2,z:(routeBounds.minZ+routeBounds.maxZ)/2};
  const span=Math.max(routeBounds.maxX-routeBounds.minX,routeBounds.maxZ-routeBounds.minZ)+160;
  const bottom=mid.z+span,top=mid.z-span,east=mid.x+span;
  land.moveTo(east,top);land.lineTo(coastX(top),top);for(let z=top;z<bottom;z+=24)land.lineTo(coastX(z),z);land.lineTo(east,bottom);land.closePath();
  let overview=activeMap.kind==='circuit';
  return {toggle(){overview=!overview;return overview;},draw(state,goal,viewpoints=[],finish=null){
    c.clearRect(0,0,size,size);c.fillStyle='#0c0c0b';c.fillRect(0,0,size,size);
    const scale=overview?(size-40)/span:(size/420),angle=overview?0:Math.PI+state.heading,x=overview?mid.x:state.x,z=overview?mid.z:state.z;
    const project=p=>{const dx=(p.x-x)*scale,dz=(p.z-z)*scale;return {x:centre+dx*Math.cos(angle)-dz*Math.sin(angle),y:centre+dx*Math.sin(angle)+dz*Math.cos(angle)};};
    c.save();c.translate(centre,centre);c.rotate(angle);c.scale(scale,scale);c.translate(-x,-z);
    if(activeMap.kind!=='circuit'){c.fillStyle='#14232a';c.fillRect(x-span*2,z-span*2,span*4,span*4);c.fillStyle='#191b16';c.fill(land);}
    else{c.fillStyle='#191b16';c.fillRect(x-span*2,z-span*2,span*4,span*4);}
    c.lineJoin=c.lineCap='round';c.lineWidth=(overview?8:12)/scale;c.strokeStyle='#080808';c.stroke(route);c.lineWidth=(overview?4:6)/scale;c.strokeStyle='#aaa69a';c.stroke(route);c.restore();
    for(const point of viewpoints){const p=project(sample(point.s));if(p.x<8||p.y<8||p.x>size-8||p.y>size-8)continue;c.beginPath();c.arc(p.x,p.y,6,0,Math.PI*2);c.fillStyle=point.found?'#8b9875':'#89847b';c.fill();}
    if(goal!==null){
      const p=project(sample(goal)),dx=p.x-centre,dy=p.y-centre,limit=centre-22,ratio=Math.min(1,limit/Math.max(Math.abs(dx),Math.abs(dy)));
      c.save();c.translate(centre+dx*ratio,centre+dy*ratio);c.fillStyle='#e6b86b';c.strokeStyle='#090909';c.lineWidth=3;
      if(ratio<1){c.rotate(Math.atan2(dy,dx)+Math.PI/2);c.beginPath();c.moveTo(0,-11);c.lineTo(-8,7);c.lineTo(8,7);c.closePath();}
      else{c.beginPath();c.arc(0,0,9,0,Math.PI*2);}c.fill();c.stroke();c.restore();
    }
    if(finish!==null){
      const p=project(sample(finish)),dx=p.x-centre,dy=p.y-centre,ratio=Math.min(1,(centre-30)/Math.max(1,Math.abs(dx),Math.abs(dy)));
      const fx=centre+dx*ratio,fy=centre+dy*ratio;c.save();c.translate(fx,fy);c.fillStyle='#fff';c.fillRect(-2,-22,3,28);
      for(let y=0;y<3;y++)for(let x=0;x<4;x++){c.fillStyle=(x+y)%2?'#111':'#fff';c.fillRect(x*5,-22+y*5,5,5);}c.font='bold 15px sans-serif';c.textAlign='center';c.strokeStyle='#111';c.lineWidth=4;c.strokeText('FINISH',8,24);c.fillStyle='#fff';c.fillText('FINISH',8,24);c.restore();
    }
    const car=project(state);c.save();c.translate(car.x,car.y);c.rotate(Math.PI-state.heading+angle);c.scale(1.6,1.6);c.shadowColor='#000';c.shadowBlur=5;
    c.fillStyle='#080808';for(const side of [-1,1])for(const axle of [-1,1])c.fillRect(side*7-2,axle*8-4,4,8);
    c.fillStyle='#fff4db';c.beginPath();c.roundRect(-6,-14,12,28,3);c.fill();c.shadowBlur=0;c.fillStyle='#302c25';c.fillRect(-4,-8,8,6);c.fillRect(-4,5,8,5);c.fillStyle='#e6b86b';c.fillRect(-5,-14,10,3);c.restore();
  }};
}
