import {activeMap} from './maps.js';
// Shared shoreline coordinates keep the road, cliffs, surf and map aligned.
export const coastline=[
  [-4000,-300],[-3000,-400],[-2300,-550],[-1700,-640],
  [-1000,-590],[-250,-740],[500,-830],[1250,-750],
  [1900,-610],[2650,-650],[3300,-480],[4000,-380],
];
const exportsCoast=coastline;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const originalCoast=[[-1700,-190],[-1100,-300],[-650,-300],[-500,-422],[-350,-545],[-160,-590],[5,-536],[170,-642],[320,-637],[450,-492],[800,-310],[1500,-240],[2800,-100]];
export function coastX(z,mapId=activeMap.id){
  const coastline=mapId==='coastal-pass'?originalCoast:exportsCoast;
  for(let i=0;i<coastline.length-1;i++){
    const [a,x]=coastline[i],[b,y]=coastline[i+1];
    if(z<=b)return x+(y-x)*smooth((z-a)/(b-a));
  }
  return coastline.at(-1)[1];
}
export function coastElevation(z){
  return 104+60*smooth((z+1800)/3800)+12*Math.sin(z*.0024);
}
export function coastalShelfRise(z,inland){
  const lower=16+70*smooth((z+2100)/4760),upper=58+47*smooth((z+1960)/3080);
  return lower+(upper-lower)*smooth(inland/250);
}
