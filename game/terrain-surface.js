import * as THREE from './vendor/three.module.js';

// Specialize only when the original shader's blend is exactly zero or one
// throughout a triangle. Keep uncertain slopes and altitude transitions mixed.
export function splitTerrainSurface(geometry,altitudeBlend=true){
  const position=geometry.attributes.position,normal=geometry.attributes.normal,groups={grass:[],rock:[],mixed:[]};
  const normals=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  for(let i=0;i<geometry.index.count;i+=3){
    const a=geometry.index.getX(i),b=geometry.index.getX(i+1),c=geometry.index.getX(i+2);
    normals[0].fromBufferAttribute(normal,a).normalize();normals[1].fromBufferAttribute(normal,b).normalize();normals[2].fromBufferAttribute(normal,c).normalize();
    const low=!altitudeBlend||(position.getY(a)<319.999&&position.getY(b)<319.999&&position.getY(c)<319.999);
    const grass=low&&normals[0].y>.91501&&normals[1].y>.91501&&normals[2].y>.91501;
    // The squared length of any interpolated normal is at least the smallest
    // pairwise dot product, which bounds its normalized vertical component.
    const dot=Math.min(normals[0].dot(normals[1]),normals[1].dot(normals[2]),normals[2].dot(normals[0]));
    const rock=dot>0&&Math.max(normals[0].y,normals[1].y,normals[2].y)/Math.sqrt(dot)<.62999;
    groups[grass?'grass':rock?'rock':'mixed'].push(a,b,c);
  }
  const result={};
  for(const [kind,indices] of Object.entries(groups))if(indices.length){
    const part=new THREE.BufferGeometry();for(const [name,attribute] of Object.entries(geometry.attributes))part.setAttribute(name,attribute);
    part.setIndex(indices);result[kind]=part;
  }
  return result;
}
