// Planar two-axle dynamics. SI units: metres, seconds, newtons, radians.
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const M=1680,G=9.81,A=1.43,B=1.27,L=A+B,H=.48,I=2850;
const ratios=[3.40,2.19,1.63,1.29,1.03,.84,.63],finalDrive=3.67,radius=.335;
const damp=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));
export const vehicleSpec=Object.freeze({mass:M,wheelbase:L,cgHeight:H,yawInertia:I,halfWidth:1.10,halfLength:2.45});
export function createState(p){
  return {x:p.x+p.nx*Math.min(1.65,(p.width||8)/4),z:p.z+p.nz*Math.min(1.65,(p.width||8)/4),y:p.y,heading:Math.atan2(p.tx,p.tz),speed:0,lateral:0,steer:0,yaw:0,acceleration:0,lateralAcceleration:0,index:p.index||0,s:p.s||0,travel:0,elapsed:0,lap:0,best:null,collision:0,impact:0,offroad:false,slip:0,frontSlip:0,rearSlip:0,frontLoad:M*G*B/L,rearLoad:M*G*A/L,gear:1,rpm:850,shiftTime:0,reverseHold:0,engineHeat:.45,previousThrottle:0,popDelay:0,popCooldown:0,exhaustPop:0,popStrength:0,popCount:0,handbrake:false,health:100,wrecked:false};
}
function axleGrip(road,heading,axle){
  const n=Math.hypot(road.nx,road.nz)||1;
  const forward=(Math.sin(heading)*road.nx+Math.cos(heading)*road.nz)/n;
  const right=(Math.cos(heading)*road.nx-Math.sin(heading)*road.nz)/n;
  const centre=(road.offset||0)+forward*axle,edge=(road.width||8)/2;
  return [-.83,.83].reduce((sum,side)=>sum+1.19-.63*clamp((Math.abs(centre+right*side)-edge+.1)/.3,0,1),0)/2;
}
// A saturating tyre curve, with a modest fall from peak to sliding grip.
function tyreForces(alpha,requestedX,load,mu,stiffness){
  const limit=mu*load;
  let y=-limit*Math.sin(1.35*Math.atan(stiffness*alpha/(1.35*limit)));
  let x=clamp(requestedX,-limit,limit);
  const combined=Math.hypot(x,y)/limit;
  if(combined>1){x/=combined;y/=combined;}
  return {x,y};
}
function drivetrain(s,throttle,dt){
  s.shiftTime=Math.max(0,s.shiftTime-dt);
  const wheelRpm=Math.abs(s.speed)/radius*60/(2*Math.PI)*finalDrive;
  const currentRpm=wheelRpm*ratios[s.gear-1];
  if(s.shiftTime===0&&s.speed>0){
    const next=currentRpm>6200&&s.gear<7?s.gear+1:currentRpm<1900&&s.gear>1?s.gear-1:s.gear;
    if(next!==s.gear){s.gear=next;s.shiftTime=.22;}
  }
  const target=Math.max(850,Math.min(6800,wheelRpm*(s.speed<0?3.1:ratios[s.gear-1])),throttle*1400);
  s.rpm=damp(s.rpm,target,14,dt);
  const torque=s.rpm<1800?400+s.rpm*.09:s.rpm<4800?565:Math.max(385,565-(s.rpm-4800)*.085);
  return torque*ratios[s.gear-1]*finalDrive*.89/radius*(s.shiftTime>0?.16:1);
}
function exhaust(s,load,dt){
  s.engineHeat=clamp(s.engineHeat+dt*(load>.5&&s.rpm>3000?.035:-.006),0,1);
  s.exhaustPop=Math.max(0,s.exhaustPop-dt*9);
  s.popCooldown=Math.max(0,s.popCooldown-dt);
  if(s.previousThrottle>.65&&load<.15&&s.rpm>3800&&s.engineHeat>.35&&s.popCooldown===0){s.popDelay=.07;s.popCooldown=1.8;}
  if(s.popDelay>0){s.popDelay-=dt;if(s.popDelay<=0){s.popStrength=clamp((s.rpm-2800)/6000,.15,.55);s.exhaustPop=s.popStrength;s.popCount++;}}
  s.previousThrottle=load;
}
// Consume caller deltas in fixed substeps; limit pathological catch-up to 100 ms.
export function integrate(s,input,road,dt){
  let remaining=clamp(dt,0,.1);
  while(remaining>1e-9){const step=Math.min(remaining,1/120);integrateStep(s,input,road,step);remaining-=step;}
}
function integrateStep(s,input,road,dt){
  const throttle=s.wrecked?0:clamp(input.throttle||0,0,1),brake=s.wrecked?1:clamp(input.brake||0,0,1);
  const handbrake=!!input.handbrake,v=Math.abs(s.speed),direction=s.speed<0?-1:1;
  s.handbrake=handbrake;
  s.handbrakeAmount=damp(s.handbrakeAmount||0,handbrake?1:0,handbrake?12:7,dt);
  const maxSteer=.52/(1+v*v*.006);
  const target=clamp(input.steer||0,-1,1)*maxSteer*clamp(input.sensitivity??.85,.5,1.2);
  s.steer=damp(s.steer,target,input.steer?10:17,dt);
  const cos=Math.cos(s.steer),sin=Math.sin(s.steer);
  const grade=road.ty*Math.cos(s.heading-Math.atan2(road.tx,road.tz));
  const driveLoad=brake||handbrake?0:throttle;
  const driveTorque=drivetrain(s,driveLoad,dt)*(.55+.45*(s.health??100)/100);
  exhaust(s,driveLoad,dt);
  s.reverseHold=brake>0&&!throttle&&!handbrake&&v<.15?s.reverseHold+dt:0;
  const reverse=!s.wrecked&&brake>0&&!throttle&&!handbrake&&(s.speed<-.1||s.reverseHold>.45);
  const stopping=reverse?0:brake;
  const weight=M*G*Math.sqrt(Math.max(.5,1-road.ty*road.ty));
  const transfer=clamp(M*H/L*s.acceleration,-weight*.25,weight*.25);
  s.frontLoad=weight*B/L-transfer;s.rearLoad=weight-s.frontLoad;
  const muF=axleGrip(road,s.heading,A),muR=axleGrip(road,s.heading,-B);
  const shoulder=clamp((1.19-(muF+muR)/2)/.63,0,1);s.offroad=shoulder>.15;
  const frontVelocity=s.lateral+A*s.yaw,rearVelocity=s.lateral-B*s.yaw;
  s.frontSlip=Math.atan2(frontVelocity*cos-s.speed*sin,Math.max(2,Math.abs(s.speed*cos+frontVelocity*sin)));
  s.rearSlip=Math.atan2(rearVelocity,Math.max(2,v));
  // Idealised ABS and brake distribution: braking and cornering share available grip.
  const requestedBrake=stopping*M*12.5,frontBias=clamp(s.frontLoad/weight+.025,.55,.76);
  const frontX=-direction*requestedBrake*frontBias;
  const engineBrake=driveLoad===0&&!handbrake?Math.min(1500,210+s.rpm*.16)*clamp(v/3,0,1):0;
  let drive=reverse?-M*2.5*brake:driveLoad*(s.speed<-.1?M*8:driveTorque);
  if(drive>0&&s.speed>=0)drive=Math.min(drive,muR*s.rearLoad*.94);
  if(reverse&&s.speed<=-7)drive=0;
  const rearX=drive-direction*(requestedBrake*(1-frontBias)+engineBrake);
  const front=tyreForces(s.frontSlip,frontX,s.frontLoad,muF,105000);
  let rear=tyreForces(s.rearSlip,rearX,s.rearLoad,muR,115000);
  if(s.handbrakeAmount>.001){
    // Apply rear lock progressively; returning grip takes a short, predictable moment.
    const contactSpeed=Math.max(.4,Math.hypot(s.speed,rearVelocity)),force=muR*s.rearLoad*.68;
    rear.x+=( -force*s.speed/contactSpeed-rear.x)*s.handbrakeAmount;
    rear.y+=( -force*rearVelocity/contactSpeed-rear.y)*s.handbrakeAmount;
  }
  const fx=front.x*cos-front.y*sin+rear.x,fy=front.y*cos+front.x*sin+rear.y;
  const drag=.5*1.18*.34*2.05*s.speed*v;
  const rolling=(.012+shoulder*.045)*weight*Math.tanh(s.speed*3);
  const ax=(fx-drag-rolling)/M-G*grade,ay=fy/M,oldSpeed=s.speed;
  s.speed+=(ax+s.yaw*s.lateral)*dt;s.lateral+=(ay-s.yaw*oldSpeed)*dt;
  s.yaw+=(A*(front.y*cos+front.x*sin)-B*rear.y)/I*dt;
  // Stability assistance keeps ordinary cornering planted and makes a deliberate slide recoverable.
  // It represents a forgiving driving aid, rather than a detailed differential-braking controller.
  if(v>1){
    const sliding=s.handbrakeAmount,grip=(muF+muR)*.5;
    const yawLimit=grip*G/Math.max(v,3)*(.90+sliding*.28);
    const yawRequest=s.speed/L*Math.tan(s.steer)/(1+v*v*.0015)*(1+sliding*.28);
    const yawTarget=clamp(yawRequest,-yawLimit,yawLimit);
    const assistance=(8+stopping*10)*(1-sliding)+4*sliding;
    s.yaw=damp(s.yaw,yawTarget,assistance,dt);
    const lateralTarget=B*s.yaw-Math.sign(s.steer)*v*.22*sliding*clamp(Math.abs(s.steer)/.08,0,1);
    s.lateral=damp(s.lateral,lateralTarget,((3.5+stopping*3)*(1-sliding)+1.8*sliding)*grip/1.19,dt);
  }
  // Blend to parking-speed geometry to avoid the slip-angle singularity at rest.
  const low=1-clamp((v-.7)/2.3,0,1);
  if(low){s.yaw=damp(s.yaw,s.speed/L*Math.tan(s.steer),low*18,dt);s.lateral=damp(s.lateral,B*s.yaw,low*18,dt);}
  if((stopping||handbrake||throttle&&oldSpeed<0)&&oldSpeed*s.speed<0)s.speed=0;
  const holdForce=(handbrake?muR*s.rearLoad*.68:0)+stopping*M*12.5+.012*weight;
  if(v<.12&&!reverse&&(handbrake||stopping||!throttle)&&M*G*Math.abs(grade)<=holdForce){s.speed=0;s.lateral=damp(s.lateral,0,24,dt);s.yaw=damp(s.yaw,0,24,dt);}
  s.speed=clamp(s.speed,-7,85);s.acceleration=damp(s.acceleration,ax,15,dt);s.lateralAcceleration=damp(s.lateralAcceleration,ay,15,dt);
  s.heading+=s.yaw*dt;s.x+=(Math.sin(s.heading)*s.speed+Math.cos(s.heading)*s.lateral)*dt;s.z+=(Math.cos(s.heading)*s.speed-Math.sin(s.heading)*s.lateral)*dt;
  s.slip=damp(s.slip,Math.max(Math.abs(s.frontSlip),Math.abs(s.rearSlip),handbrake&&v>3?.22:0),14,dt);
  s.elapsed+=dt;s.collision=Math.max(0,s.collision-dt);s.impact=Math.max(0,s.impact-dt*2);
}
export function constrain(s,p,routeLength){
  const delta=p.s-s.s,wrapped=delta>routeLength/2?delta-routeLength:delta<-routeLength/2?delta+routeLength:delta;
  s.travel+=clamp(wrapped,-10,10);s.s=p.s;s.index=p.index;s.y=p.y;
  const size=Math.hypot(p.nx,p.nz)||1,nx=p.nx/size,nz=p.nz/size;
  const fx=Math.sin(s.heading),fz=Math.cos(s.heading),rx=fz,rz=-fx,fn=fx*nx+fz*nz,rn=rx*nx+rz*nz;
  const extent=Math.abs(fn)*vehicleSpec.halfLength+Math.abs(rn)*vehicleSpec.halfWidth;
  const side=Math.sign(p.offset)||1,penetration=Math.abs(p.offset)+extent-(p.railOffset??5.05);
  s.barrierContact=penetration>0;
  if(penetration<=0)return false;
  const inwardX=-nx*side,inwardZ=-nz*side;
  const along=clamp(fn*side/.22,-1,1)*vehicleSpec.halfLength,across=clamp(rn*side/.22,-1,1)*vehicleSpec.halfWidth;
  const cx=fx*along+rx*across,cz=fz*along+rz*across;
  let vx=fx*s.speed+rx*s.lateral,vz=fz*s.speed+rz*s.lateral;
  const normalSpeed=(vx+s.yaw*cz)*inwardX+(vz-s.yaw*cx)*inwardZ;
  let hit=false;
  if(normalSpeed<0){
    // Spread the barrier impulse through the body to avoid a single-corner yaw kick.
    const contactInertia=I*4,lever=cz*inwardX-cx*inwardZ,impulse=-normalSpeed/(1/M+lever*lever/contactInertia);
    vx+=inwardX*impulse/M;vz+=inwardZ*impulse/M;s.yaw+=lever*impulse/contactInertia;
    const tx=-inwardZ,tz=inwardX,tlever=cz*tx-cx*tz;
    const tangentSpeed=(vx+s.yaw*cz)*tx+(vz-s.yaw*cx)*tz;
    const friction=clamp(-tangentSpeed/(1/M+tlever*tlever/contactInertia),-.12*impulse,.12*impulse);
    vx+=tx*friction/M;vz+=tz*friction/M;s.yaw+=tlever*friction/contactInertia;
    s.speed=vx*fx+vz*fz;s.lateral=vx*rx+vz*rz;s.impact=Math.max(s.impact,clamp(-normalSpeed/16,0,1));
    if(s.collision===0&&normalSpeed<-.5){
      s.collision=.75;hit=true;
      s.health=Math.max(0,(s.health??100)-clamp((-normalSpeed-1.3)*3.5,0,72));
      s.wrecked=s.health===0;
    }
  }
  // Resolve contact overlap only, without resetting heading or moving to the centreline.
  s.x+=inwardX*(penetration+.001);s.z+=inwardZ*(penetration+.001);
  return hit;
}
