import * as THREE from './vendor/three.module.js';
import {coastX,coastElevation} from './geography.js';
import {activeMap,getMap} from './maps.js';
import trackData from './assets/nurburgring-gp.json' with {type:'json'};

export const ROAD_WIDTH=8;
export function createRoute(id){
const map=getMap(id);
// Follow the shore north, then return along a higher terrace above the same sea.
// Coordinates are inland distance, height above the coastal shelf, and northing.
const anchors=[
  [20,70,1350],[35,82,1700],[90,88,1900],[205,92,1880],[250,98,1620],
  [230,100,1220],[205,104,800],[210,100,380],[215,96,-70],
  [235,88,-500],[230,74,-900],[190,56,-1300],[115,27,-1620],
  [45,24,-1640],[18,18,-1450],[18,16,-1100],[18,24,-750],
  [18,36,-350],[18,44,100],[18,52,500],[18,64,950],
];
const coastalPath=new THREE.CatmullRomCurve3(anchors.map(([inland,height,z])=>new THREE.Vector3((inland-18)*.75+8,height+24,z*1.4)),true,'centripetal');
class CoastalCurve extends THREE.Curve{
  getPoint(t,target=new THREE.Vector3()){
    coastalPath.getPoint(t,target);target.x+=coastX(target.z,map.id);target.y+=coastElevation(target.z);return target;
  }
}
const classic=[[-410,118,-500],[-535,102,-350],[-575,114,-160],[-520,145,5],[-625,176,170],[-615,198,320],[-480,210,410],[-320,240,325],[-205,280,475],[-60,310,400],[60,295,240],[110,285,50],[30,250,-140],[130,220,-290],[70,188,-450],[-80,156,-570],[-270,135,-600]];
function circuitCurve(){
  const coords=trackData.features[0].geometry.coordinates,origin=coords[0],scale=6371000*Math.PI/180;
  const points=[];
  for(const [lon,lat] of coords){const p=new THREE.Vector3((lon-origin[0])*scale*Math.cos(origin[1]*Math.PI/180),627,-(lat-origin[1])*scale);if(!points.length||p.distanceTo(points.at(-1))>.1)points.push(p);}
  if(points[0].distanceTo(points.at(-1))<.1)points.pop();
  return new THREE.CatmullRomCurve3(points,true,'centripetal');
}
const curve=map.kind==='coast'?new CoastalCurve():map.kind==='circuit'?circuitCurve():new THREE.CatmullRomCurve3(classic.map(p=>new THREE.Vector3(...p)),true,'centripetal');curve.arcLengthDivisions=6000;
const length=curve.getLength();
const count=Math.ceil(length/1.6);
const smooth=(a,b,v)=>THREE.MathUtils.smoothstep(v,a,b);
function roadWidth(t){
  if(map.kind==='circuit')return 12.5;
  const ledge=smooth(.065,.095,t)*(1-smooth(.285,.315,t));
  const cut=smooth(.54,.58,t)*(1-smooth(.69,.73,t));
  const overlook=smooth(.34,.38,t)*(1-smooth(.47,.51,t));
  return 8-2.4*ledge-1.9*cut+1.2*overlook;
}
const frames=Array.from({length:count},(_,i)=>{
  const p=curve.getPointAt(i/count),t=curve.getTangentAt(i/count).normalize();
  const horizontal=Math.hypot(t.x,t.z),width=roadWidth(i/count);
  return {x:p.x,y:p.y,z:p.z,tx:t.x,ty:t.y,tz:t.z,nx:-t.z/horizontal,nz:t.x/horizontal,s:i/count*length,width,railOffset:width/2+(map.kind==='circuit'?7:.62),index:i};
});
const routeBounds=frames.reduce((bounds,p)=>({
  minX:Math.min(bounds.minX,p.x),maxX:Math.max(bounds.maxX,p.x),
  minZ:Math.min(bounds.minZ,p.z),maxZ:Math.max(bounds.maxZ,p.z),
}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
function nearRouteBounds(x,z,margin=80){
  return x>routeBounds.minX-margin&&x<routeBounds.maxX+margin&&z>routeBounds.minZ-margin&&z<routeBounds.maxZ+margin;
}
const fields=['x','y','z','tx','ty','tz','nx','nz','width','railOffset'];
function interpolate(a,b,u){const out={};for(const k of fields)out[k]=THREE.MathUtils.lerp(a[k],b[k],u);const n=Math.hypot(out.nx,out.nz);out.nx/=n;out.nz/=n;return out;}
function sample(s){
  const wrapped=(s%length+length)%length,f=wrapped/length*count,i=Math.floor(f);
  return {...interpolate(frames[i],frames[(i+1)%count],f-i),s:wrapped,index:i};
}
const grid=new Map(),cell=24;
frames.forEach((p,i)=>{const k=`${Math.floor(p.x/cell)},${Math.floor(p.z/cell)}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);});
function nearest(x,z,hint){
  let best=Infinity,index=0;
  const check=i=>{i=(i+count)%count;const p=frames[i],d=(x-p.x)**2+(z-p.z)**2;if(d<best){best=d;index=i;}};
  if(hint!==undefined){for(let j=-30;j<=30;j++)check(hint+j);}
  else {
    const gx=Math.floor(x/cell),gz=Math.floor(z/cell);
    for(let radius=0;radius<=4;radius++){
      for(let a=-radius;a<=radius;a++)for(let b=-radius;b<=radius;b++){
        if(radius&&Math.abs(a)!==radius&&Math.abs(b)!==radius)continue;
        const points=grid.get(`${gx+a},${gz+b}`);if(points)for(const i of points)check(i);
      }
      const edge=Math.min(x-(gx-radius)*cell,(gx+radius+1)*cell-x,z-(gz-radius)*cell,(gz+radius+1)*cell-z);
      // Every unvisited cell is farther away than this square's nearest edge.
      if(best<edge*edge)break;
    }
  }
  if(best===Infinity)return null;
  const p=frames[index],next=frames[(index+1)%count],prev=frames[(index+count-1)%count];
  let result={...p,index,distance:Math.sqrt(best)};
  for(const [a,b,idx] of [[p,next,index],[prev,p,(index+count-1)%count]]){
    const vx=b.x-a.x,vz=b.z-a.z,u=THREE.MathUtils.clamp(((x-a.x)*vx+(z-a.z)*vz)/(vx*vx+vz*vz),0,1);
    const px=a.x+vx*u,pz=a.z+vz*u,d=Math.hypot(x-px,z-pz);
    if(d<=result.distance)result={...interpolate(a,b,u),s:(idx+u)/count*length,index:idx,distance:d};
  }
  result.offset=(x-result.x)*result.nx+(z-result.z)*result.nz;
  return result;
}
function ribbon(inner,outer,height,material){
  const positions=[],uvs=[],indices=[];
  for(let i=0;i<=count;i++){
    const p=frames[i%count],a=typeof inner==='function'?inner(p):inner,b=typeof outer==='function'?outer(p):outer;
    for(const side of [a,b]){positions.push(p.x+p.nx*side,p.y+height,p.z+p.nz*side);uvs.push(side/4,i/count*length/4);}
  }
  for(let i=0;i<count;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
  const m=new THREE.Mesh(g,material);m.receiveShadow=true;return m;
}

return {map,curve,length,count,frames,roadWidth,routeBounds,nearRouteBounds,sample,nearest,ribbon};
}
export const {curve,length,count,frames,roadWidth,routeBounds,nearRouteBounds,sample,nearest,ribbon}=createRoute(activeMap.id);
const surfaceUp=new THREE.Vector3(),surfaceForward=new THREE.Vector3(),surfaceRight=new THREE.Vector3(),surfaceBasis=new THREE.Matrix4();
export function surfaceOrientation(p,heading,target=new THREE.Quaternion()){
  const horizontal=Math.hypot(p.tx,p.tz)||1;
  surfaceUp.set(-p.tx*p.ty/horizontal,horizontal,-p.tz*p.ty/horizontal).normalize();
  const x=Math.sin(heading),z=Math.cos(heading);
  surfaceForward.set(x,-(surfaceUp.x*x+surfaceUp.z*z)/surfaceUp.y,z).normalize();
  surfaceRight.crossVectors(surfaceUp,surfaceForward).normalize();
  surfaceBasis.makeBasis(surfaceRight,surfaceUp,surfaceForward);
  return target.setFromRotationMatrix(surfaceBasis);
}
