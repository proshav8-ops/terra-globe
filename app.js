/* TERRA — interactive globe with live third-party data.
   Rendering: d3 orthographic projection on canvas (vendored d3, embedded geometry).
   Data: World Bank Indicators API (economy, population, capital, region, income)
         + countries.dev (currency, languages, area, borders, timezones, flag).
   No API keys, no backend. */
(function(){
  "use strict";
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stage    = document.getElementById('stage');
  const canvas   = document.getElementById('globe');
  const ctx      = canvas.getContext('2d');
  const tooltip  = document.getElementById('tooltip');
  const maploader= document.getElementById('maploader');
  const readout  = document.getElementById('readout');
  const panel    = document.getElementById('panel');
  const searchEl = document.getElementById('search');
  const datalist = document.getElementById('countries');
  const spinBtn  = document.getElementById('spin');

  let W=0, H=0, DPR=Math.min(window.devicePixelRatio||1, 2);
  let features=[], selected=null, hovered=null;
  let autoRotate=!reduce, animatingTo=null, dragging=false, reqToken=0, time=0;

  const projection = d3.geoOrthographic().precision(0.5).clipAngle(90);
  const path = d3.geoPath(projection, ctx);
  const graticule = d3.geoGraticule10();
  let baseScale = 300;

  /* ---------- non-recognised territories: nudge them toward a data source ---------- */
  const SPECIAL = {
    'Kosovo':     { a3:'XKX', cdName:'Kosovo' },
    'N. Cyprus':  { cdName:'Northern Cyprus' },
    'Somaliland': { cdName:'Somaliland' }
  };

  /* ---------- inline TopoJSON decoder ---------- */
  function decodeTopo(topo, objName){
    const o=topo.objects[objName], t=topo.transform;
    const sx=t.scale[0], sy=t.scale[1], tx=t.translate[0], ty=t.translate[1];
    const arcs=topo.arcs.map(arc=>{
      let x=0,y=0; const out=[];
      for(let i=0;i<arc.length;i++){ x+=arc[i][0]; y+=arc[i][1]; out.push([x*sx+tx, y*sy+ty]); }
      return out;
    });
    function ring(idxs){
      let pts=[];
      for(let k=0;k<idxs.length;k++){
        const idx=idxs[k];
        let a = idx<0 ? arcs[~idx].slice().reverse() : arcs[idx];
        if(pts.length) a=a.slice(1);
        pts=pts.concat(a);
      }
      return pts;
    }
    function geom(g){
      let coords;
      if(g.type==='Polygon') coords=g.arcs.map(ring);
      else if(g.type==='MultiPolygon') coords=g.arcs.map(p=>p.map(ring));
      else return null;
      return { type:'Feature', id:g.id, properties:g.properties||{}, geometry:{ type:g.type, coordinates:coords } };
    }
    return o.geometries.map(geom).filter(Boolean);
  }

  /* ---------- sizing ---------- */
  function resize(){
    const r = stage.getBoundingClientRect();
    W=r.width; H=r.height;
    canvas.width=W*DPR; canvas.height=H*DPR;
    canvas.style.width=W+'px'; canvas.style.height=H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
    baseScale = Math.min(W,H)/2 - 26;
    const cur = projection.scale();
    projection.translate([W/2, H/2]);
    if(!cur || cur < 10) projection.scale(baseScale);
  }
  window.addEventListener('resize', resize);

  /* ---------- render ---------- */
  function draw(){
    const cx=W/2, cy=H/2, s=projection.scale();
    ctx.clearRect(0,0,W,H);

    const halo=ctx.createRadialGradient(cx,cy,s*0.97, cx,cy,s*1.28);
    halo.addColorStop(0,'rgba(111,194,224,0.16)');
    halo.addColorStop(1,'rgba(111,194,224,0)');
    ctx.fillStyle=halo;
    ctx.beginPath(); ctx.arc(cx,cy,s*1.28,0,Math.PI*2); ctx.fill();

    const g=ctx.createRadialGradient(cx-s*0.34,cy-s*0.34,s*0.08, cx,cy,s*1.06);
    g.addColorStop(0,'#243469'); g.addColorStop(0.55,'#14204a'); g.addColorStop(1,'#0a1028');
    ctx.beginPath(); path({type:'Sphere'}); ctx.fillStyle=g; ctx.fill();

    ctx.beginPath(); path(graticule);
    ctx.strokeStyle='rgba(111,194,224,0.08)'; ctx.lineWidth=0.6; ctx.stroke();

    for(const f of features){
      if(f===selected) continue;
      ctx.beginPath(); path(f);
      ctx.fillStyle = (f===hovered) ? '#e7ede6' : '#b3c1b9';
      ctx.fill();
      ctx.strokeStyle='rgba(20,30,46,0.55)'; ctx.lineWidth=0.5; ctx.stroke();
    }

    if(selected){
      ctx.save();
      ctx.shadowColor='rgba(246,198,103,0.9)'; ctx.shadowBlur=20;
      ctx.beginPath(); path(selected); ctx.fillStyle='#e9a93c'; ctx.fill();
      ctx.restore();
      ctx.beginPath(); path(selected);
      ctx.strokeStyle='#ffdfa6'; ctx.lineWidth=1.1; ctx.stroke();
      drawReticle(selected);
    }

    ctx.beginPath(); ctx.arc(cx,cy,s,0,Math.PI*2);
    ctx.strokeStyle='rgba(200,214,255,0.12)'; ctx.lineWidth=1; ctx.stroke();
  }

  function drawReticle(f){
    const c=d3.geoCentroid(f);
    const center=[-projection.rotate()[0], -projection.rotate()[1]];
    if(d3.geoDistance(c, center) > Math.PI/2) return;
    const p=projection(c); if(!p) return;
    const [x,y]=p;
    const pulse = reduce ? 0 : (Math.sin(time*3)*0.5+0.5);
    const r = 16 + pulse*7;
    ctx.save();
    ctx.strokeStyle='rgba(246,198,103,0.85)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=0.5;
    ctx.beginPath();
    ctx.moveTo(x-r-6,y); ctx.lineTo(x-r+3,y);
    ctx.moveTo(x+r-3,y); ctx.lineTo(x+r+6,y);
    ctx.moveTo(x,y-r-6); ctx.lineTo(x,y-r+3);
    ctx.moveTo(x,y+r-3); ctx.lineTo(x,y+r+6);
    ctx.stroke();
    ctx.restore();
  }

  function tick(t){
    time = t/1000;
    if(animatingTo){
      const k=Math.min(1,(t-animatingTo.t0)/animatingTo.dur);
      const e=1-Math.pow(1-k,3);
      projection.rotate(animatingTo.interp(e));
      if(k>=1) animatingTo=null;
    } else if(autoRotate && !dragging){
      const rot=projection.rotate(); rot[0]+=0.14; projection.rotate(rot);
    }
    draw();
    requestAnimationFrame(tick);
  }

  /* ---------- interaction ---------- */
  let moved=0, last=null, downPt=null;
  const pointers=new Map(); let pinchDist=0;

  canvas.addEventListener('pointerdown', e=>{
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){ pinchDist=twoDist(); return; }
    dragging=true; moved=0; last={x:e.clientX,y:e.clientY};
    downPt={x:e.clientX,y:e.clientY};
    canvas.classList.add('dragging'); animatingTo=null;
  });

  canvas.addEventListener('pointermove', e=>{
    if(pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){
      const d=twoDist();
      if(pinchDist) zoomBy(d/pinchDist);
      pinchDist=d; return;
    }
    if(dragging){
      const dx=e.clientX-last.x, dy=e.clientY-last.y;
      moved+=Math.abs(dx)+Math.abs(dy);
      last={x:e.clientX,y:e.clientY};
      const k=75/projection.scale();
      const rot=projection.rotate();
      rot[0]+=dx*k; rot[1]=Math.max(-90,Math.min(90, rot[1]-dy*k));
      projection.rotate(rot); hideTooltip();
    } else hover(e);
  });

  function endPointer(e){
    pointers.delete(e.pointerId);
    if(pointers.size<2) pinchDist=0;
    if(!dragging) return;
    dragging=false; canvas.classList.remove('dragging');
    if(moved<6 && downPt) pick(downPt.x, downPt.y);
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', ()=>{ hovered=null; hideTooltip(); });

  function twoDist(){ const p=[...pointers.values()]; return Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y); }
  function zoomBy(f){ projection.scale(Math.max(baseScale*0.7, Math.min(baseScale*4.5, projection.scale()*f))); }
  canvas.addEventListener('wheel', e=>{ e.preventDefault(); zoomBy(1 - e.deltaY*0.0016); }, {passive:false});

  function locate(px,py){
    const r=canvas.getBoundingClientRect();
    const inv=projection.invert([px-r.left, py-r.top]);
    if(!inv) return null;
    for(const f of features) if(d3.geoContains(f,inv)) return f;
    return null;
  }
  function hover(e){
    const f=locate(e.clientX,e.clientY); hovered=f;
    if(f){
      const r=stage.getBoundingClientRect();
      tooltip.textContent=f.properties.name;
      tooltip.style.left=(e.clientX-r.left)+'px';
      tooltip.style.top=(e.clientY-r.top)+'px';
      tooltip.classList.add('on'); canvas.style.cursor='pointer';
    } else { hideTooltip(); canvas.style.cursor='grab'; }
  }
  function hideTooltip(){ tooltip.classList.remove('on'); }
  function pick(px,py){ const f=locate(px,py); if(f) select(f); }

  function select(f){
    selected=f; autoRotate=false; setSpin(false);
    flyTo(d3.geoCentroid(f)); loadData(f);
  }
  function flyTo(coord){
    if(reduce){ projection.rotate([-coord[0],-coord[1], projection.rotate()[2]]); return; }
    const from=projection.rotate(), to=[-coord[0], -coord[1], from[2]];
    animatingTo={t0:performance.now(), dur:750, interp:d3.interpolate(from,to)};
  }

  function setSpin(on){ autoRotate=on; spinBtn.classList.toggle('paused',!on); }
  spinBtn.addEventListener('click', ()=> setSpin(!autoRotate));

  searchEl.addEventListener('change', runSearch);
  searchEl.addEventListener('keydown', e=>{ if(e.key==='Enter') runSearch(); });
  function runSearch(){
    const q=searchEl.value.trim().toLowerCase(); if(!q) return;
    const f=features.find(x=>x.properties.name.toLowerCase()===q)
         || features.find(x=>x.properties.name.toLowerCase().startsWith(q))
         || features.find(x=>x.properties.name.toLowerCase().includes(q));
    if(f){ select(f); searchEl.value=f.properties.name; }
  }

  /* ==================== live data ==================== */
  const WB='https://api.worldbank.org/v2';
  const WB_CODES={ gdp:'NY.GDP.MKTP.CD', gdppc:'NY.GDP.PCAP.CD', growth:'NY.GDP.MKTP.KD.ZG', pop:'SP.POP.TOTL' };

  function wbLatest(json){
    // World Bank shape: [meta, [ {value,date,...}, ... ]]
    try{
      const arr=json && json[1];
      if(Array.isArray(arr)) for(const row of arr){ if(row && row.value!=null) return {value:+row.value, date:row.date}; }
    }catch(e){}
    return null;
  }

  async function loadWorldBank(a3, info){
    // metadata: capital, region, income level
    try{
      const meta=await fetch(`${WB}/country/${a3}?format=json`).then(r=>r.json());
      const m=meta && meta[1] && meta[1][0];
      if(m){
        if(m.capitalCity) info.capital=m.capitalCity;
        if(m.region && m.region.value && !/aggregate/i.test(m.region.value)) info.region=m.region.value;
        if(m.incomeLevel && m.incomeLevel.value && !/not classified/i.test(m.incomeLevel.value)) info.income=m.incomeLevel.value;
      }
    }catch(e){}
    // indicators in parallel (most-recent non-empty value)
    const keys=Object.keys(WB_CODES);
    const res=await Promise.all(keys.map(k=>
      fetch(`${WB}/country/${a3}/indicator/${WB_CODES[k]}?format=json&mrnev=1&per_page=1`)
        .then(r=>r.json()).catch(()=>null)));
    keys.forEach((k,i)=>{
      const v=wbLatest(res[i]); if(!v) return;
      if(k==='gdp'){ info.gdp=v.value; info.gdpYear=v.date; }
      else if(k==='gdppc'){ info.gdppc=v.value; }
      else if(k==='growth'){ info.growth=v.value; }
      else if(k==='pop'){ info.wbPop=v.value; info.popYear=v.date; }
    });
  }

  async function loadCountriesDev(numeric, name, info){
    const base='https://countries.dev';
    let c=null;
    // primary: numeric ISO code
    if(numeric!=null){
      try{ const r=await fetch(`${base}/numericcode/${numeric}`); if(r.ok) c=await r.json(); }catch(e){}
    }
    // fallback: name search (handles disputed territories with no numeric code)
    if(!c){
      const sp=SPECIAL[name];
      const q=encodeURIComponent(sp && sp.cdName ? sp.cdName : name);
      try{
        const r=await fetch(`${base}/name/${q}`);
        if(r.ok){ const arr=await r.json(); c=Array.isArray(arr)?arr[0]:arr; }
      }catch(e){}
    }
    if(!c) return;
    if(c.alpha3Code) info.cdA3=c.alpha3Code;
    if(c.flag) info.flag=c.flag;
    if(Array.isArray(c.currencies)&&c.currencies[0]){
      const cu=c.currencies[0];
      info.currency=(cu.name||cu.code||'')+(cu.code?` (${cu.code})`:'');
    }
    if(Array.isArray(c.languages)) info.languages=c.languages.map(l=>l.name).filter(Boolean).slice(0,3).join(', ')||info.languages;
    if(c.area!=null) info.area=c.area;
    if(Array.isArray(c.borders)) info.borders=c.borders.length;
    if(Array.isArray(c.timezones)) info.timezones=c.timezones.length;
    if(c.populationDensity!=null) info.density=c.populationDensity;
    if(c.population!=null) info.cdPop=c.population;
    if(c.subregion) info.subregion=c.subregion;
    if(info.capital==='n/a' && c.capital) info.capital=c.capital;
    if(info.region==='n/a' && c.region) info.region=c.region;
  }

  async function loadData(feature){
    const token=++reqToken;
    const name=feature.properties.name;
    renderLoading(name);

    const numRaw = feature.id!=null ? parseInt(feature.id,10) : NaN;
    const numeric = Number.isFinite(numRaw) ? String(numRaw) : null;
    const sp = SPECIAL[name] || {};
    let a3 = (window.ISO[numeric] && window.ISO[numeric].a3) || sp.a3 || null;

    const info={ name, flag:'', capital:'n/a', region:'n/a', income:'n/a', subregion:null,
      gdp:null, gdppc:null, growth:null, gdpYear:null, popYear:null,
      wbPop:null, cdPop:null, currency:'n/a', languages:'n/a',
      area:null, borders:null, timezones:null, density:null, cdA3:null };

    // run both sources together
    const jobs=[ loadCountriesDev(numeric, name, info) ];
    if(a3) jobs.push(loadWorldBank(a3, info));
    await Promise.allSettled(jobs);
    if(token!==reqToken) return;

    // if we had no ISO3 up front but countries.dev supplied one, query World Bank now
    if(!a3 && info.cdA3){
      try{ await loadWorldBank(info.cdA3, info); }catch(e){}
      if(token!==reqToken) return;
    }

    info.population = info.wbPop!=null ? info.wbPop : info.cdPop;
    if(info.wbPop==null && info.cdPop!=null) info.popYear=null; // countries.dev year unknown

    const gotSomething = info.gdp!=null || info.population!=null ||
                         info.capital!=='n/a' || info.currency!=='n/a';
    if(gotSomething) renderData(info);
    else renderError(name, 'no records returned from the World Bank or countries.dev for this territory');
  }

  /* ---------- formatting ---------- */
  function money(v){
    if(v==null) return 'n/a';
    const a=Math.abs(v);
    if(a>=1e12) return '$'+(v/1e12).toFixed(2)+'T';
    if(a>=1e9)  return '$'+(v/1e9).toFixed(1)+'B';
    if(a>=1e6)  return '$'+(v/1e6).toFixed(1)+'M';
    return '$'+Math.round(v).toLocaleString();
  }
  function money0(v){ return v==null?'n/a':'$'+Math.round(v).toLocaleString(); }
  function pop(v){
    if(v==null) return 'n/a';
    if(v>=1e9) return (v/1e9).toFixed(2)+' billion';
    if(v>=1e6) return (v/1e6).toFixed(1)+' million';
    if(v>=1e3) return (v/1e3).toFixed(0)+'k';
    return String(v);
  }
  function pct(v){ return v==null?'n/a':(v>=0?'+':'')+v.toFixed(1)+'%'; }
  function num(v){ return v==null?null:Math.round(v).toLocaleString(); }

  /* ---------- panel ---------- */
  const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  function renderLoading(name){
    panel.scrollTop=0;
    readout.innerHTML=`
      <div class="eyebrow">surveying</div>
      <div class="country-name">${esc(name)}</div>
      <div class="country-sub">querying World Bank &amp; countries.dev…</div>
      <div class="loading">
        <div class="lbl"><span class="pulse"></span> acquiring live figures</div>
        <div class="skel w90"></div><div class="skel w70"></div>
        <div class="skel"></div><div class="skel w40"></div>
        <div class="skel w70"></div><div class="skel w90"></div>
      </div>`;
  }

  function economyText(i){
    const s=[];
    if(i.gdp!=null){
      let seg=`Nominal GDP is about ${money(i.gdp)}`+(i.gdpYear?` (${i.gdpYear})`:'');
      if(i.gdppc!=null) seg+=`, roughly ${money0(i.gdppc)} per person`;
      if(i.growth!=null) seg+=`, with real growth of ${pct(i.growth)} that year`;
      s.push(seg+'.');
    }
    const reg = i.region!=='n/a' ? i.region : i.subregion;
    if(i.income!=='n/a' || reg){
      let seg='The World Bank classifies it as ';
      const art = w => /^[aeiou]/i.test(w) ? 'an' : 'a';
      seg += (i.income!=='n/a') ? `${art(i.income)} ${i.income.toLowerCase()} economy` : 'an economy';
      if(reg) seg += ` in the ${reg} region`;
      s.push(seg+'.');
    }
    if(!s.length) s.push('Economic indicators were not available for this territory — it may not be a separate World Bank reporting economy.');
    return s.join(' ');
  }

  function factList(i){
    const f=[];
    if(i.area!=null) f.push(`Covers about ${num(i.area)} km² of land.`);
    if(i.languages && i.languages!=='n/a') f.push(`Spoken languages include ${i.languages}.`);
    if(i.borders!=null) f.push(i.borders===0
      ? 'Has no land borders — an island or otherwise self-contained.'
      : `Shares land borders with ${i.borders} ${i.borders===1?'country':'countries'}.`);
    if(i.timezones!=null) f.push(`Spans ${i.timezones} time ${i.timezones===1?'zone':'zones'}.`);
    if(i.density!=null) f.push(`Population density is about ${num(i.density)} people per km².`);
    if(i.income!=='n/a' && i.region!=='n/a') f.push(`Grouped with ${i.region} economies at ${i.income.toLowerCase()} level.`);
    return f;
  }

  function renderData(i){
    panel.scrollTop=0;
    const facts=factList(i);
    const srcYears=[];
    if(i.gdpYear) srcYears.push(`GDP ${i.gdpYear}`);
    if(i.popYear) srcYears.push(`population ${i.popYear}`);
    readout.innerHTML=`
      <div class="eyebrow">survey complete</div>
      <div class="country-name">${i.flag?`<span class="flag">${i.flag}</span>`:''}${esc(i.name)}</div>
      <div class="country-sub">${esc(i.capital)} · ${esc(i.currency)}</div>

      <div class="grid">
        <div class="cell"><div class="k">Population</div><div class="v hi">${esc(pop(i.population))}</div></div>
        <div class="cell"><div class="k">GDP · nominal</div><div class="v hi">${esc(money(i.gdp))}</div></div>
        <div class="cell"><div class="k">GDP per capita</div><div class="v">${esc(money0(i.gdppc))}</div></div>
        <div class="cell"><div class="k">Real growth</div><div class="v">${esc(pct(i.growth))}</div></div>
      </div>

      <div class="block">
        <h4>Economy</h4>
        <p>${esc(economyText(i))}</p>
      </div>

      ${facts.length?`<div class="block">
        <h4>Facts</h4>
        <ul class="facts">${facts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
      </div>`:''}

      <div class="asof">
        <span class="src">◇ World Bank + countries.dev</span> · live query${srcYears.length?' · '+esc(srcYears.join(', ')):''}
      </div>`;
  }

  function renderError(name, detail){
    readout.innerHTML=`
      <div class="eyebrow">survey failed</div>
      <div class="country-name">${esc(name)}</div>
      <div class="err">
        Couldn't complete the survey for this region.
        ${detail?`<br><br><span class="detail">detail: ${esc(detail)}</span>`:''}
        <br><button id="retry">retry survey</button>
      </div>`;
    const b=document.getElementById('retry');
    if(b) b.addEventListener('click', ()=>{ if(selected) loadData(selected); });
  }

  /* ---------- boot ---------- */
  function boot(){
    if(typeof d3==='undefined'){ maploader.innerHTML='<div>d3 failed to load</div>'; return; }
    if(!window.WORLD){ maploader.innerHTML='<div>geometry data missing</div>'; return; }
    features = decodeTopo(window.WORLD,'countries').filter(f=>f.properties && f.properties.name);
    features.sort((a,b)=>a.properties.name.localeCompare(b.properties.name));
    datalist.innerHTML = features.map(f=>`<option value="${esc(f.properties.name)}">`).join('');
    maploader.style.display='none';
    resize();
    projection.rotate([-10,-18,0]);
    setSpin(!reduce);
    requestAnimationFrame(tick);
  }

  resize();
  boot();
})();
