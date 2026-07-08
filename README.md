# TERRA — interactive globe with live country data

An interactive 3D globe. Rotate it, click any country, and get **live** population,
economy, and country facts pulled from public APIs at request time — no stored table,
no API keys, no backend.

![status](https://img.shields.io/badge/data-live-e9a93c) ![keys](https://img.shields.io/badge/API%20keys-none-6fc2e0)

## What it does

- **Globe** — d3 orthographic projection rendered on canvas. Drag to rotate, scroll/pinch
  to zoom, click a country to survey it, or use the search box to fly to one.
- **Live data** on selection:
  - **[World Bank Indicators API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392)**
    → GDP (nominal), GDP per capita, real GDP growth, population, capital, region, income group.
  - **[countries.dev](https://countries.dev)** → currency, languages, land area, neighbours,
    time zones, population density, flag.
- Each source degrades independently: if one is unreachable, the panel still shows whatever
  the other returned.

## Run it

It's a static site — no build step.

```bash
# any static server works; e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from the file system also works in most browsers, because
d3 and the map geometry are vendored locally; only the two data APIs are fetched over the
network (both send permissive CORS headers).

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "TERRA: interactive globe with live country data"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
pick `main` / `/ (root)`, save. The site publishes at
`https://<your-username>.github.io/<repo>/` within a minute or two.

## Project layout

```
index.html        markup + script includes
styles.css        the "optical instrument" theme
app.js            globe rendering, interaction, and the data pipeline
data/data.js      embedded world geometry (110m) + ISO 3166 code map
vendor/d3.min.js  vendored d3 v7 (no CDN dependency)
.nojekyll         tell GitHub Pages to serve files as-is
```

## Notes & limitations

- World Bank figures lag 1–2 years for most countries (that's the nature of the source);
  the panel shows the year of each value it displays.
- Three territories without an ISO numeric code (Kosovo, Northern Cyprus, Somaliland) fall
  back to a name lookup and may show partial data.
- Geometry is Natural Earth 110m via [world-atlas](https://github.com/topojson/world-atlas);
  country data © their respective providers (World Bank; countries.dev, data from GeoNames CC BY 4.0).

## License

MIT — see [LICENSE](LICENSE).
