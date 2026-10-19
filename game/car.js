import * as THREE from './vendor/three.module.js';
import {paints} from './maps.js';

export function animateWheels(wheels,speed,steering,dt,state={}){
  const front=wheels.filter(w=>w.front),rear=wheels.filter(w=>!w.front);
  const wheelbase=front[0].center.z-rear[0].center.z;
  const turnRadius=wheelbase/Math.max(.001,Math.abs(Math.tan(steering)));
  for(const wheel of wheels){
    const angle=wheel.front?Math.sign(steering)*Math.atan(wheelbase/(turnRadius-wheel.center.x*Math.sign(steering))):0;
    wheel.steer.rotation.y=angle;
    const forward=speed-(state.yaw||0)*wheel.center.x;
    const sideways=(state.lateral||0)+(state.yaw||0)*wheel.center.z;
    const rolling=forward*Math.cos(angle)+sideways*Math.sin(angle);
    const lock=wheel.front?0:THREE.MathUtils.clamp(state.handbrakeAmount??(state.handbrake?1:0),0,1);
    wheel.spin.rotation.x=(wheel.spin.rotation.x+rolling*dt/wheel.radius*(1-lock))%(Math.PI*2);
  }
}

export async function loadCar(){
  const {GLTFLoader}=await import('./vendor/GLTFLoader.js');
  const {scene:source}=await new GLTFLoader().loadAsync('./assets/goblin.glb');
  source.updateMatrixWorld(true);
  const root=new THREE.Group(),body=new THREE.Group();root.name='V12 Goblin';root.add(body);
  const materials=new Set();source.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;materials.add(n.material);}});
  const brakeGlow={value:.25};
  for(const material of materials){
    material.envMapIntensity=1.15;
    if(material.name==='Glass'){
      material.onBeforeCompile=shader=>{
        shader.uniforms.brakeGlow=brakeGlow;
        shader.vertexShader='varying float carZ;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncarZ=position.z;');
        shader.fragmentShader='uniform float brakeGlow;varying float carZ;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
          if(carZ < -1.7) diffuseColor.rgb=vec3(.35,.006,.003);
          else if(carZ > 1.7) diffuseColor.rgb=vec3(.55,.60,.65);
        `);
        shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
          if(carZ < -1.7) totalEmissiveRadiance += vec3(1.,.012,.004)*brakeGlow;
          else if(carZ > 1.7) totalEmissiveRadiance += vec3(.12,.14,.16);
        `);
      };
    }
  }
  const wheels=[];
  for(const suffix of ['BL','BR','FL','FR']){
    const node=source.getObjectByName('car_wheel_'+suffix),caliper=source.getObjectByName('car_brake_'+suffix);
    if(!node||!caliper)throw new Error('Car wheel assembly is missing');
    const tyreBox=new THREE.Box3();node.traverse(n=>{if(n.isMesh&&n.material.name==='Tyres')tyreBox.union(new THREE.Box3().setFromObject(n));});
    if(tyreBox.isEmpty())throw new Error('Car tyre geometry is missing');
    const center=tyreBox.getCenter(new THREE.Vector3()),size=tyreBox.getSize(new THREE.Vector3());
    const steer=new THREE.Group(),spin=new THREE.Group();steer.name='Steering '+suffix;spin.name='Rolling '+suffix;steer.position.copy(center);steer.add(spin);root.add(steer);
    // Model vertices share vehicle coordinates; only rolling parts go under spin.
    for(const [part,parent] of [[node,spin],[caliper,steer]]){part.removeFromParent();part.position.sub(center);parent.add(part);}
    wheels.push({steer,spin,front:suffix[0]==='F',center,radius:(size.y+size.z)/4});
  }
  body.add(source);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,12,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.65)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const contact=new THREE.Mesh(new THREE.PlaneGeometry(2.6,5.2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.set(0,.025,.145);root.add(contact);
  const paintMaterial=[...materials].find(m=>m.name==='Paint');
  function setPaint(id){const paint=paints.find(p=>p.id===id)||paints[0];paintMaterial.color.set(paint.color);paintMaterial.roughness=paint.roughness;paintMaterial.metalness=paint.metalness;paintMaterial.clearcoat=paint.clearcoat;paintMaterial.clearcoatRoughness=.45;}
  setPaint('matte-black');
  return {root,body,wheels,setPaint,update(speed,steering,dt,braking,state={}){
    animateWheels(wheels,speed,steering,dt,state);brakeGlow.value=braking?2.4:.25;
  }};
}
