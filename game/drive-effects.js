import * as THREE from './vendor/three.module.js';
import {sample,surfaceOrientation,length} from './road.js';

export function createTyreMarks(scene,rearContacts=[{x:-.83,z:-1.27},{x:.83,z:-1.27}]){
  const capacity=2048,positions=new Float32Array(capacity*18),colours=new Float32Array(capacity*18);
  const geometry=new THREE.BufferGeometry(),p=new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage),c=new THREE.BufferAttribute(colours,3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',p);geometry.setAttribute('color',c);geometry.setDrawRange(0,0);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.48,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-3}));mesh.frustumCulled=false;scene.add(mesh);
  let cursor=0,total=0,previous=null,lastS=0;
  const wheel=(state,contact)=>{
    const road=sample(state.s),x=state.x+Math.sin(state.heading)*contact.z+Math.cos(state.heading)*contact.x,z=state.z+Math.cos(state.heading)*contact.z-Math.sin(state.heading)*contact.x;
    const h=Math.hypot(road.tx,road.tz),y=road.y+((x-road.x)*road.tx+(z-road.z)*road.tz)*road.ty/(h*h)+.046;
    const offset=(x-road.x)*road.nx+(z-road.z)*road.nz;return {x,y,z,onRoad:Math.abs(offset)<road.width/2-.15};
  };
  return {get count(){return total;},break(){previous=null;},clear(){cursor=total=0;previous=null;geometry.setDrawRange(0,0);},update(state){
    const sliding=Math.abs(state.speed)>3&&(state.handbrakeAmount>.25||state.slip>.15);
    if(!sliding||state.collision>0){previous=null;return;}
    const wheels=rearContacts.map(contact=>wheel(state,contact));
    if(previous){
      const d=Math.hypot(wheels[0].x-previous[0].x,wheels[0].z-previous[0].z);
      if(d<.20)return;
      if(d<4&&Math.abs(state.s-lastS)<8)for(let j=0;j<2;j++){
        const a=previous[j],b=wheels[j];if(!a.onRoad||!b.onRoad)continue;
        const nx=-(b.z-a.z)/d*.13,nz=(b.x-a.x)/d*.13;
        const points=[[a.x+nx,a.y,a.z+nz],[a.x-nx,a.y,a.z-nz],[b.x+nx,b.y,b.z+nz],[a.x-nx,a.y,a.z-nz],[b.x-nx,b.y,b.z-nz],[b.x+nx,b.y,b.z+nz]];
        p.array.set(points.flat(),cursor*18);c.array.fill(.055,cursor*18,cursor*18+18);p.addUpdateRange(cursor*18,18);c.addUpdateRange(cursor*18,18);
        cursor=(cursor+1)%capacity;total=Math.min(capacity,total+1);
      }
      p.needsUpdate=c.needsUpdate=true;geometry.setDrawRange(0,total*6);
    }
    previous=wheels;lastS=state.s;
  }};
}

export function createRouteMarker(scene){
  const root=new THREE.Group(),material=new THREE.MeshBasicMaterial({color:'#e5b45b',transparent:true,opacity:.82,depthWrite:false});
  const posts=[-1,1].map(side=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(.12,3,.12),material);mesh.position.y=1.5;mesh.userData.side=side;root.add(mesh);return mesh;});
  const bar=new THREE.Mesh(new THREE.BoxGeometry(1,.12,.12),material);bar.position.y=3;root.add(bar);
  const stripe=new THREE.Mesh(new THREE.PlaneGeometry(1,.5),material);stripe.rotation.x=-Math.PI/2;stripe.position.y=.048;root.add(stripe);scene.add(root);
  return {update(s,position,finish=false){if(s===null){root.visible=false;return;}const p=sample(s%length);root.visible=Math.hypot(p.x-position.x,p.z-position.z)<500;if(!root.visible)return;root.position.set(p.x,p.y,p.z);surfaceOrientation(p,Math.atan2(p.tx,p.tz),root.quaternion);for(const post of posts)post.position.x=post.userData.side*(p.width/2-.25);bar.scale.x=p.width-.5;stripe.scale.x=p.width;material.color.set(finish?'#f1eee4':'#e5b45b');}};
}

export function createGhost(scene){
  const root=new THREE.Group(),material=new THREE.MeshBasicMaterial({color:'#d6bc87',transparent:true,opacity:.18,depthWrite:false});
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.85,.6,4.35),material);body.position.y=.53;root.add(body);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.5,.48,1.85),material);cabin.position.set(0,1.01,-.2);root.add(cabin);root.visible=false;scene.add(root);
  let index=0,lastTime=0,recording=null;
  return {update(points,time,enabled,position){
    if(points!==recording||time<lastTime){recording=points;index=0;}lastTime=time;
    if(!enabled||!points?.length||time>points.at(-1)[0]){root.visible=false;return;}
    index=Math.min(index,points.length-1);
    while(index<points.length-2&&points[index+1][0]<time)index++;
    const a=points[index],b=points[Math.min(index+1,points.length-1)],t=THREE.MathUtils.clamp((time-a[0])/(b[0]-a[0]||1),0,1);
    root.position.set(THREE.MathUtils.lerp(a[1],b[1],t),THREE.MathUtils.lerp(a[2],b[2],t),THREE.MathUtils.lerp(a[3],b[3],t));
    const angle=Math.atan2(Math.sin(b[4]-a[4]),Math.cos(b[4]-a[4]));root.rotation.y=a[4]+angle*t;
    root.visible=root.position.distanceTo(position)>4&&root.position.distanceTo(position)<250;
  }};
}
