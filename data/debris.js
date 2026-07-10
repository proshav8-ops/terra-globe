/* Representative debris fragments at historically congested altitudes (SSA catalog subset). */
window.DEBRIS = [
  { id:"deb-c2251", name:"COSMOS-2251 debris",   ownerA3:"RUS", regime:"DEBRIS", alt_km:780,  inc:74.0, raan:140, M0:30,  period_min:100.2, debris:true },
  { id:"deb-fy1c",  name:"Fengyun-1C fragment", ownerA3:"CHN", regime:"DEBRIS", alt_km:865,  inc:98.8, raan:20,  M0:90,  period_min:102.1, debris:true },
  { id:"deb-irid",  name:"Iridium-33 fragment",   ownerA3:"USA", regime:"DEBRIS", alt_km:789,  inc:86.4, raan:260, M0:150, period_min:100.5, debris:true },
  { id:"deb-iss",   name:"ISS-altitude debris",   ownerA3:"—",   regime:"DEBRIS", alt_km:415,  inc:51.6, raan:125, M0:200, period_min:92.8,  debris:true },
  { id:"deb-sl-a",  name:"Starlink-shell debris", ownerA3:"—",   regime:"DEBRIS", alt_km:545,  inc:53.0, raan:35,  M0:80,  period_min:95.4,  debris:true },
  { id:"deb-sl-b",  name:"Starlink-shell debris", ownerA3:"—",   regime:"DEBRIS", alt_km:558,  inc:53.2, raan:38,  M0:240, period_min:95.6,  debris:true },
  { id:"deb-suns",  name:"Sun-sync debris",       ownerA3:"—",   regime:"DEBRIS", alt_km:705,  inc:98.2, raan:180, M0:45,  period_min:98.9,  debris:true },
  { id:"deb-geo",   name:"GEO drift object",      ownerA3:"—",   regime:"DEBRIS", alt_km:35750,inc:0.5,  raan:0,   M0:55,  period_min:1436.1, lonFixed:55.0, debris:true }
];

/* Global orbital chokepoints — tracked object density estimates (SSA public summaries). */
window.ORBITAL_CHOKEPOINTS = [
  { id:"iss-corridor",  label:"ISS crewed corridor",     alt_km:420,  band_km:30,  trackable_est:28,  risk:"critical" },
  { id:"starlink",      label:"Mega-constellation shell", alt_km:550,  band_km:50,  trackable_est:6200,risk:"elevated" },
  { id:"sun-sync",      label:"Sun-synchronous imaging", alt_km:700,  band_km:40,  trackable_est:890, risk:"elevated" },
  { id:"collision-780", label:"COSMOS-Iridium band",     alt_km:780,  band_km:25,  trackable_est:340, risk:"critical" },
  { id:"meo-nav",       label:"MEO navigation shell",    alt_km:20200,band_km:3000,trackable_est:120, risk:"strategic" },
  { id:"geo-belt",      label:"Clarke geostationary belt",alt_km:35786,band_km:400, trackable_est:580, risk:"elevated" }
];
