import * as THREE from './vendor/three.module.js';

// Adjacent tiles share the same four-metre boundary, even when their interiors
// have different densities. Fans stitch those boundaries without open seams.
export function adaptiveTerrain(bounds,height,detailed,{tileSize=128,fine=4,coarse=16,skip=()=>false}={}){
  const positions=[],normals=[],indices=[],vertices=new Map();
  const vertex=(x,z)=>{
    const key=x+','+z;if(vertices.has(key))return vertices.get(key);
    const y=height(x,z),dx=height(x+2,z)-height(x-2,z),dz=height(x,z+2)-height(x,z-2),n=Math.hypot(dx,4,dz);
    const index=positions.length/3;positions.push(x,y,z);normals.push(-dx/n,4/n,-dz/n);vertices.set(key,index);return index;
  };
  for(let z0=bounds.minZ;z0<bounds.maxZ;z0+=tileSize)for(let x0=bounds.minX;x0<bounds.maxX;x0+=tileSize){
    const x1=Math.min(bounds.maxX,x0+tileSize),z1=Math.min(bounds.maxZ,z0+tileSize),step=detailed(x0,z0,x1,z1)?fine:coarse;
    if(skip(x0,z0,x1,z1))continue;
    for(let z=z0;z<z1;z+=step)for(let x=x0;x<x1;x+=step){
      const right=Math.min(x1,x+step),bottom=Math.min(z1,z+step);
      if(step===fine){const a=vertex(x,z),b=vertex(x,bottom),c=vertex(right,z),d=vertex(right,bottom);indices.push(a,b,c,c,b,d);continue;}
      const ring=[];
      for(let v=z;v<bottom;v+=x===x0?fine:step)ring.push(vertex(x,v));
      for(let v=x;v<right;v+=bottom===z1?fine:step)ring.push(vertex(v,bottom));
      for(let v=bottom;v>z;v-=right===x1?fine:step)ring.push(vertex(right,v));
      for(let v=right;v>x;v-=z===z0?fine:step)ring.push(vertex(v,z));
      const centre=vertex((x+right)/2,(z+bottom)/2);
      for(let i=0;i<ring.length;i++)indices.push(centre,ring[i],ring[(i+1)%ring.length]);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setIndex(indices);return geometry;
}
