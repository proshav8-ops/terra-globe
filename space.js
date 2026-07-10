/* TERRA Space Model — orbital geometry, registry mapping, boundary theory.
   Math: Keplerian mean motion, ECI→geodetic, spherical Voronoi jurisdiction,
   Kármán envelope, GEO longitude slots. */
(function(global){
  "use strict";

  const R_EARTH = 6371.008;          // km, mean radius
  const KARMAN_KM = 100;             // practical space boundary
  const GEO_ALT_KM = 35786;          // Clarke belt
  const MU = 398600.4418;            // km³/s², Earth GM

  const REGIME_COLOR = {
    LEO: "rgba(111,194,224,0.95)",
    MEO: "rgba(233,169,60,0.95)",
    GEO: "rgba(246,198,103,0.95)",
    HEO: "rgba(200,140,255,0.95)"
  };

  function deg2rad(d){ return d * Math.PI / 180; }
  function rad2deg(r){ return r * 180 / Math.PI; }

  /** Mean motion (rad/s) from circular altitude. n = √(μ/a³) */
  function meanMotionRadS(alt_km){
    const a = (R_EARTH + alt_km) * 1000; // metres
    return Math.sqrt(MU * 1e9 / (a * a * a));
  }

  /** Subsatellite [lon, lat] at elapsed seconds from epoch. */
  function subsatellitePoint(sat, elapsedSec){
    if(sat.lonFixed != null) return [sat.lonFixed, 0];
    const n = 2 * Math.PI / (sat.period_min * 60);
    const M = deg2rad(sat.M0) + n * elapsedSec;
    const i = deg2rad(sat.inc);
    const O = deg2rad(sat.raan);
    const w = deg2rad(sat.argPerigee || 0);
    const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(i) * Math.sin(w + M))));
    const lon = O + Math.atan2(Math.cos(i) * Math.sin(w + M), Math.cos(w + M));
    return [((rad2deg(lon) + 540) % 360) - 180, rad2deg(lat)];
  }

  /** Great-circle distance on unit sphere (radians). */
  function geoDist(a, b){
    return d3.geoDistance(a, b);
  }

  /** Nearest country centroid — spherical Voronoi cell owner at a ground point. */
  function voronoiOwner(lonLat, features){
    let best = null, bestD = Infinity;
    for(const f of features){
      const d = geoDist(lonLat, d3.geoCentroid(f));
      if(d < bestD){ bestD = d; best = f; }
    }
    return { feature: best, distanceRad: bestD };
  }

  function getA3(feature, ISO, SPECIAL){
    const num = feature.id != null ? String(parseInt(feature.id, 10)) : null;
    return (num && ISO[num] && ISO[num].a3) || (SPECIAL[feature.properties.name] && SPECIAL[feature.properties.name].a3) || null;
  }

  /** Theoretical vertical envelope above a nation's surface (not law — a model). */
  function verticalEnvelope(feature){
    const areaKm2 = d3.geoArea(feature) * (R_EARTH * R_EARTH);
    return {
      karman: { floor_km: 0, ceiling_km: KARMAN_KM, label: "Aerospace (Kármán cylinder)" },
      leo:    { floor_km: KARMAN_KM, ceiling_km: 2000, label: "Low Earth orbit shell" },
      meo:    { floor_km: 2000, ceiling_km: 35786, label: "Medium / transfer shell" },
      geo:    { floor_km: GEO_ALT_KM - 200, ceiling_km: GEO_ALT_KM + 200, label: "Geostationary belt (±200 km)" },
      surface_km2: Math.round(areaKm2)
    };
  }

  /** GEO longitude slot nearest to country's centroid meridian (ITU-style heuristic). */
  function geoSlotLongitude(feature){
    const lon = d3.geoCentroid(feature)[0];
    return Math.round(lon * 2) / 2; // 0.5° slot grid
  }

  function analyzeCountry(feature, satellites, features, ISO, SPECIAL){
    const a3 = getA3(feature, ISO, SPECIAL);
    const name = feature.properties.name;
    const owned = satellites.filter(s => s.ownerA3 === a3);
    const envelope = verticalEnvelope(feature);
    const slotLon = geoSlotLongitude(feature);

    const regimes = { LEO:0, MEO:0, GEO:0, HEO:0 };
    owned.forEach(s => { if(regimes[s.regime] != null) regimes[s.regime]++; });

    const t0 = performance.now() / 1000;
    const positions = satellites.map(s => {
      const ll = subsatellitePoint(s, t0);
      const vor = voronoiOwner(ll, features);
      const vorA3 = getA3(vor.feature, ISO, SPECIAL);
      return { sat: s, lonLat: ll, voronoiCountry: vor.feature.properties.name, voronoiA3: vorA3 };
    });

    const overhead = positions.filter(p => p.voronoiA3 === a3 && p.sat.ownerA3 === a3);
    const foreignOverhead = positions.filter(p => p.voronoiA3 === a3 && p.sat.ownerA3 !== a3);
    const abroad = positions.filter(p => p.sat.ownerA3 === a3 && p.voronoiA3 !== a3);

    return {
      name, a3, owned, envelope, slotLon, regimes,
      overhead: overhead.length,
      foreignOverhead: foreignOverhead.length,
      abroad: abroad.length,
      positions
    };
  }

  function boundaryTheoryText(){
    return [
      "Outer Space Treaty (1967): no nation may claim sovereignty over outer space, but each state retains jurisdiction over objects it registers.",
      "Kármán model: extend national territory vertically to ~100 km (aerodynamic lift ≈ orbital lift). This is a physics convention, not a legal border.",
      "Spherical Voronoi shell: at altitude h, assign each subsatellite point to the nearest country centroid on Earth's surface — a geometric \"influence\" partition, not recognized law.",
      "GEO belt: satellites at ~35,786 km remain fixed over one longitude; ITU coordinates slot allocation on the equatorial arc."
    ];
  }

  function extraSuggestion(){
    return {
      title: "Conjunction & debris screening",
      body: "Track covariance ellipsoids for each registered asset (position + velocity uncertainty). Propagate with SGP4 from TLEs, compute miss distance d_miss, and estimate collision probability P_c via Alfano or Foster models. Flag when P_c exceeds 10⁻⁴ — the same math used by space situational awareness (SSA) networks."
    };
  }

  function mathNeeded(){
    return [
      { topic: "Spherical geometry", detail: "Haversine / great-circle distance, geodesic centroids, d3.geoDistance on S²" },
      { topic: "Orbital mechanics", detail: "Keplerian elements (a, e, i, Ω, ω, ν); mean motion n = √(μ/a³); subsatellite ground track" },
      { topic: "Coordinate transforms", detail: "ECI ↔ ECEF ↔ geodetic (WGS-84); Earth rotation θ_GMST(t)" },
      { topic: "Spherical Voronoi", detail: "Partition the sphere by nearest country centroid — Delaunay dual on S²" },
      { topic: "GEO slot math", detail: "1-D longitude interval assignment; station-keeping Δv budget" },
      { topic: "Conjunction analysis", detail: "Covariance propagation, Mahalanobis distance, P_c integrals (advanced)" }
    ];
  }

  /** Draw altitude shells and satellite markers on the globe canvas. */
  function drawSpaceLayer(ctx, projection, W, H, satellites, features, selectedA3, elapsedSec, hoveredSatId){
    const cx = W / 2, cy = H / 2;
    const s = projection.scale();
    const rot = projection.rotate();

    // Kármán shell (~100 km visual bump)
    const shells = [
      { km: KARMAN_KM, color: "rgba(111,194,224,0.06)", width: 0.8 },
      { km: 2000, color: "rgba(111,194,224,0.04)", width: 0.6 },
      { km: GEO_ALT_KM, color: "rgba(233,169,60,0.05)", width: 0.7 }
    ];
    for(const sh of shells){
      const bump = s * (sh.km / R_EARTH) * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, s + bump, 0, Math.PI * 2);
      ctx.strokeStyle = sh.color;
      ctx.lineWidth = sh.width;
      ctx.stroke();
    }

    const center = [-rot[0], -rot[1]];
    for(const sat of satellites){
      const ll = subsatellitePoint(sat, elapsedSec);
      if(d3.geoDistance(ll, center) > Math.PI / 2) continue;

      const p = projection(ll);
      if(!p) continue;
      const [x, y] = p;
      const altBump = s * (sat.alt_km / R_EARTH) * 0.55;
      const px = cx + (x - cx) * (1 + altBump / s);
      const py = cy + (y - cy) * (1 + altBump / s);

      const isOwned = selectedA3 && sat.ownerA3 === selectedA3;
      const isHover = hoveredSatId === sat.id;
      const r = isHover ? 5 : (isOwned ? 4 : 2.5);

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = isOwned ? "#f6c667" : (REGIME_COLOR[sat.regime] || "#6fc2e0");
      if(isOwned || isHover){
        ctx.shadowColor = "rgba(246,198,103,0.8)";
        ctx.shadowBlur = 10;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      if(isHover || (isOwned && sat.regime === "GEO")){
        ctx.font = "10px IBM Plex Mono, monospace";
        ctx.fillStyle = "rgba(238,241,250,0.85)";
        ctx.fillText(sat.name, px + 7, py - 5);
      }
    }
  }

  function findSatAt(px, py, projection, W, H, satellites, elapsedSec){
    const cx = W / 2, cy = H / 2;
    const s = projection.scale();
    let best = null, bestD = 14;
    for(const sat of satellites){
      const ll = subsatellitePoint(sat, elapsedSec);
      const p = projection(ll);
      if(!p) continue;
      const [x, y] = p;
      const altBump = s * (sat.alt_km / R_EARTH) * 0.55;
      const sx = cx + (x - cx) * (1 + altBump / s);
      const sy = cy + (y - cy) * (1 + altBump / s);
      const d = Math.hypot(px - sx, py - sy);
      if(d < bestD){ bestD = d; best = sat; }
    }
    return best;
  }

  global.TerraSpace = {
    R_EARTH, KARMAN_KM, GEO_ALT_KM,
    subsatellitePoint, voronoiOwner, getA3, analyzeCountry,
    boundaryTheoryText, extraSuggestion, mathNeeded,
    drawSpaceLayer, findSatAt, REGIME_COLOR
  };
})(window);
