/* TERRA Conjunction Model — miss distance, P_c estimate, debris risk, chokepoints.
   Uses Keplerian ECI positions (SGP4-ready architecture; TLE hook for future). */
(function(global){
  "use strict";

  const R_EARTH = 6371.008;
  const PC_ALERT = 1e-4;
  const PC_WARN  = 1e-6;
  const SIGMA_KM = 0.5; // assumed 1σ position uncertainty per object

  function deg2rad(d){ return d * Math.PI / 180; }

  /** ECI position (km) from circular orbital elements. */
  function eciPositionKm(sat, elapsedSec){
    if(sat.lonFixed != null){
      const lon = deg2rad(sat.lonFixed);
      const a = R_EARTH + sat.alt_km;
      return [a * Math.cos(lon), a * Math.sin(lon), 0];
    }
    const a = R_EARTH + sat.alt_km;
    const n = 2 * Math.PI / (sat.period_min * 60);
    const M = deg2rad(sat.M0) + n * elapsedSec;
    const i = deg2rad(sat.inc);
    const O = deg2rad(sat.raan);
    const w = deg2rad(sat.argPerigee || 0);
    const u = w + M;
    return [
      a * (Math.cos(O)*Math.cos(u) - Math.sin(O)*Math.sin(u)*Math.cos(i)),
      a * (Math.sin(O)*Math.cos(u) + Math.cos(O)*Math.sin(u)*Math.cos(i)),
      a * Math.sin(u) * Math.sin(i)
    ];
  }

  function vecSub(a, b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  function vecMag(v){ return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }

  /** Simplified Foster-style P_c from miss distance (Gaussian, equal σ). */
  function estimatePc(dMissKm, sigma){
    const s = sigma || SIGMA_KM;
    const denom = 4 * s * s;
    if(denom <= 0) return 0;
    return Math.exp(-(dMissKm * dMissKm) / denom);
  }

  function riskLevel(pc, dMiss){
    if(pc >= PC_ALERT || dMiss < 2) return "critical";
    if(pc >= PC_WARN || dMiss < 15) return "elevated";
    if(dMiss < 100) return "watch";
    return "nominal";
  }

  function fmtPc(pc){
    if(pc >= 1e-3) return pc.toExponential(1);
    if(pc >= 1e-6) return pc.toExponential(1);
    return "<10⁻⁶";
  }

  /** Pairwise conjunction screen across catalog + debris. */
  function screenAll(objects, elapsedSec, maxPairs){
    const state = objects.map(o => ({
      obj: o,
      pos: eciPositionKm(o, elapsedSec)
    }));
    const pairs = [];
    for(let i = 0; i < state.length; i++){
      for(let j = i + 1; j < state.length; j++){
        const d = vecMag(vecSub(state[i].pos, state[j].pos));
        const altDiff = Math.abs(state[i].obj.alt_km - state[j].obj.alt_km);
        if(altDiff > 800 && d > 5000) continue; // cheap prune
        const pc = estimatePc(d);
        pairs.push({
          a: state[i].obj, b: state[j].obj,
          dMiss: d, pc,
          level: riskLevel(pc, d)
        });
      }
    }
    pairs.sort((x, y) => x.dMiss - y.dMiss);
    return pairs.slice(0, maxPairs || 40);
  }

  function chokepointsForCountry(owned, chokepoints){
    if(!chokepoints) return [];
    return chokepoints.map(cp => {
      const near = owned.filter(s => Math.abs(s.alt_km - cp.alt_km) <= cp.band_km);
      return { ...cp, assets: near.map(s => s.name) };
    }).filter(cp => cp.assets.length > 0 || cp.risk === "strategic" || cp.risk === "critical");
  }

  function debrisRiskForCountry(owned, debris, chokepoints){
    const shells = (chokepoints || []).map(cp => {
      const nearDebris = (debris || []).filter(d => Math.abs(d.alt_km - cp.alt_km) <= cp.band_km);
      const nearOwned = owned.filter(s => Math.abs(s.alt_km - cp.alt_km) <= cp.band_km);
      let score = nearDebris.length * 2 + (cp.trackable_est || 0) / 500;
      if(nearOwned.length) score += 3;
      if(cp.risk === "critical") score += 2;
      const level = score >= 8 ? "critical" : score >= 4 ? "elevated" : score >= 2 ? "watch" : "nominal";
      return { ...cp, debrisNear: nearDebris.length, assetsNear: nearOwned.length, score, level };
    });
    shells.sort((a, b) => b.score - a.score);
    return shells;
  }

  function analyzeForCountry(feature, satellites, debris, features, ISO, SPECIAL, chokepoints, elapsedSec){
    const TS = global.TerraSpace;
    const a3 = TS.getA3(feature, ISO, SPECIAL);
    const base = TS.analyzeCountry(feature, satellites, features, ISO, SPECIAL);
    const all = satellites.concat(debris || []);
    const pairs = screenAll(all, elapsedSec, 50);

    const ownedIds = new Set(base.owned.map(s => s.id));
    const relevant = pairs.filter(p =>
      p.a.ownerA3 === a3 || p.b.ownerA3 === a3 ||
      p.a.debris || p.b.debris ||
      p.level === "critical" || p.level === "elevated"
    ).slice(0, 12);

    const hotspots = pairs.filter(p => p.level === "critical" || p.level === "elevated").slice(0, 8);
    const cp = chokepointsForCountry(base.owned, chokepoints);
    const debrisRisk = debrisRiskForCountry(base.owned, debris, chokepoints);

    const inferences = buildInferences(base, relevant, debrisRisk, cp, a3);

    return {
      ...base,
      pairs: relevant,
      hotspots,
      chokepoints: cp,
      debrisRisk,
      inferences
    };
  }

  function buildInferences(base, pairs, debrisRisk, chokepoints, a3){
    const out = [];
    if(!a3) out.push("No ISO registry code — conjunction liability defaults to operator of record in full SSA systems.");
    if(base.owned.length === 0) out.push("No catalogued registered assets, but foreign and debris objects still transit overhead continuously.");
    if(base.foreignOverhead > 0) out.push(`Foreign registered objects (${base.foreignOverhead}) currently overfly this territory — shared collision risk, no territorial exclusion.`);

    const crit = pairs.filter(p => p.level === "critical");
    const elev = pairs.filter(p => p.level === "elevated");
    if(crit.length) out.push(`${crit.length} critical conjunction pair(s) now (d_miss < 15 km or P_c ≥ 10⁻⁴) — would trigger SSA alert in operational systems.`);
    if(elev.length) out.push(`${elev.length} elevated pair(s) warrant watch-list monitoring.`);

    const topShell = debrisRisk[0];
    if(topShell && topShell.level !== "nominal"){
      out.push(`Highest debris exposure: ${topShell.label} (${topShell.alt_km} km) — ${topShell.debrisNear} modelled fragment(s), ~${topShell.trackable_est.toLocaleString()} trackable objects in band.`);
    }

    const navCp = chokepoints.find(c => c.id === "meo-nav");
    if(navCp && navCp.assets.length){
      out.push("MEO navigation assets sit in a strategic chokepoint — GPS/BeiDou/GLONASS/Galileo share similar shells; disruption is globally cascading.");
    }

    const mega = base.owned.find(s => s.fleet && s.fleet > 100);
    if(mega) out.push(`Mega-constellation operator (${mega.name}) multiplies conjunction pairs roughly as N² — catalog aggregation hides per-object risk.`);

    if(!out.length) out.push("Nominal conjunction posture in this snapshot — risk is dominated by unmodelled small debris and objects not in the public catalog.");
    return out;
  }

  /** Draw conjunction warning arcs between subsatellite points on the globe. */
  function drawHotspots(ctx, projection, W, H, hotspots, subsatFn, elapsedSec, rot){
    const cx = W / 2, cy = H / 2, s = projection.scale();
    const center = [-rot[0], -rot[1]];

    function toScreen(sat){
      const ll = subsatFn(sat, elapsedSec);
      if(d3.geoDistance(ll, center) > Math.PI / 2) return null;
      const p = projection(ll);
      if(!p) return null;
      const altBump = s * (sat.alt_km / R_EARTH) * 0.55;
      return [cx + (p[0] - cx) * (1 + altBump / s), cy + (p[1] - cy) * (1 + altBump / s)];
    }

    for(const h of hotspots){
      const p1 = toScreen(h.a), p2 = toScreen(h.b);
      if(!p1 || !p2) continue;
      const col = h.level === "critical" ? "rgba(255,90,90,0.85)" : "rgba(255,170,80,0.65)";
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = h.level === "critical" ? 1.4 : 0.9;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p1[0], p1[1], 3, 0, Math.PI * 2);
      ctx.arc(p2[0], p2[1], 3, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    }
  }

  global.TerraConjunction = {
    PC_ALERT, PC_WARN, SIGMA_KM,
    eciPositionKm, estimatePc, riskLevel, fmtPc,
    screenAll, analyzeForCountry, drawHotspots,
    chokepointsForCountry, debrisRiskForCountry
  };
})(window);
