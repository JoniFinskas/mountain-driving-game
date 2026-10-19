export const maps=Object.freeze([
  {id:'coastal-pass',name:'Coastal Pass',location:'Costa Alta, Italy',distance:'3.2 km',kind:'classic',description:'The original pass. Tight cliff roads and mountain bends.',version:1},
  {id:'ocean-road',name:'Ocean Road',location:'Costa Alta, Italy',distance:'10.2 km',kind:'coast',description:'A long coastal tour with open bays and sea-view terraces.',version:1},
  {id:'nurburgring-gp',name:'Nürburgring GP',location:'Nürburg, Germany',distance:'5.1 km',kind:'circuit',description:'An unofficial Grand Prix circuit with kerbs and a pit straight.',version:1},
]);
export const getMap=id=>maps.find(map=>map.id===id)||maps[0];
export const activeMap=getMap(typeof location==='undefined'?null:new URLSearchParams(location.search).get('map'));
export const paints=Object.freeze([
  {id:'matte-black',name:'Matte black',color:'#101112',roughness:.78,metalness:.10,clearcoat:.08},
  {id:'ivory',name:'Ivory',color:'#d8d4c7',roughness:.35,metalness:.18,clearcoat:.4},
  {id:'racing-red',name:'Racing red',color:'#851b19',roughness:.32,metalness:.32,clearcoat:.5},
  {id:'deep-blue',name:'Deep blue',color:'#163458',roughness:.34,metalness:.4,clearcoat:.5},
  {id:'forest-green',name:'Forest green',color:'#163c2b',roughness:.40,metalness:.24,clearcoat:.35},
  {id:'sunset',name:'Burnt orange',color:'#aa4b20',roughness:.38,metalness:.35,clearcoat:.4},
]);
