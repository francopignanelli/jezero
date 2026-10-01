# Research: 3D engine for a Mars globe + 1 m local terrain

Researched 2026-09-25 against source code, changelogs and npm. **UNVERIFIED** marks anything not confirmed from a source.

## Comparison

| Engine | Effort to make Mars correct | Terrain/imagery LOD | Precision | Bundle (gzip) | Risk |
|---|---|---|---|---|---|
| **CesiumJS 1.145** (1.146 due 10-01) | Medium: `Ellipsoid.default` (since 1.119) plus ~12 overrides | Best: quantized-mesh/heightmap terrain, draped imagery, 3D Tiles | Relative-to-eye rendering, tile-local centers, log depth by default, multi-frustum | ~1.75 MB (+ Workers 1.1 MB, Assets 4.4 MB on demand) | Low–medium |
| 3DTilesRendererJS 0.5.3 + three r186 | Medium–high: `tiles.ellipsoid` / `3DTILES_ellipsoid`; sun, sky and fly-to are DIY | Good: 3D Tiles, QuantizedMeshPlugin, ImageOverlayPlugin | Per-object double-precision matrices; own geometry must use a local origin | ~0.3 MB | Medium (0.x, API changes often) |
| Babylon.js 9.28 | `GeospatialCamera({planetRadius})`, sphere only | Weak 3D Tiles support | Floating origin | ~1.85 MB | High |
| deck.gl 9.4 GlobeView | Impossible: hardcoded `EARTH_RADIUS = 6370972` | No TerrainLayer; low precision above zoom 12 | Poor | — | Unsuitable |
| MapLibre 6.11 globe | Impossible: `earthRadius` constant, Web Mercator | Web Mercator only | — | — | Unsuitable |
| iTowns 2.46 | Its Mars example uses the Earth globe | — | — | — | Unsuitable |

**Decision: CesiumJS.** Fallback: 3DTilesRendererJS if bundle size on mobile becomes the constraint. Prior art: `enomis-dev/perseverance-traverse-3d` (Cesium + Mars ellipsoid + Trek WMTS + quantized-mesh).

## Cesium ion Mars

- "Cesium Mars" is asset 3644333, 3D Tiles in `IAU_2015:49901`: 200 m MOLA/HRSC terrain and 232 m Viking imagery.
- **At Jezero it has only CTX data** (6 m imagery, 20 m terrain).
- **Terms:** the Community plan is personal and non-commercial; the ToS forbids offline storage or redistribution and running it "as a service for … third parties", and requires the logo.
- **Not used.**

## Earth defaults to override

1. **Set the Mars ellipsoid everywhere.**
   - Set `Ellipsoid.default` before `new Viewer`.
   - Also pass the ellipsoid to `Viewer`, `Globe`, `GeographicTilingScheme`, `CesiumTerrainProvider.fromUrl` and `CustomHeightmapTerrainProvider`.
   - `Cesium3DTileset` defaults to WGS84, not `Ellipsoid.default`.
2. **Use a sphere, not `Ellipsoid.MARS`.**
   - `Ellipsoid.MARS = (3396190, 3396190, 3376200)` is flattened and reads latitude as planetographic.
   - Planetocentric data placed on it shifts about **12 km north–south at 18.4°N** and about 2 km vertically.
   - Use `new Ellipsoid(3396190, 3396190, 3396190)` instead.
   - Note: `IAU_2015:49901` is west-positive.
3. **Disable Earth widgets and defaults:**
   - `baseLayer: false` (it would otherwise load Bing through ion).
   - `baseLayerPicker`, `geocoder` and `sceneModePicker` set to false.
   - Set `Camera.DEFAULT_VIEW_RECTANGLE`.
4. **Automatic on a non-WGS84 ellipsoid:** fog, `SkyAtmosphere`, `Moon` and ground atmosphere turn off. `scene.sun` is still created whenever `skyBox !== false`.
5. **Sun position.** `UniformState` uses `Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame`.
   - Set `scene.light = new DirectionalLight({direction})` from astronomy-engine `HelioVector(Body.Mars)` + `RotationAxis(Body.Mars)`.
   - Set `scene.sun.show = false`, disable bloom, and use `DynamicAtmosphereLightingType.SCENE_LIGHT`.
6. **Frame hook.** `Transforms.computeIcrfToCentralBodyFixedMatrix` (a hook since 1.120) needs a Mars IAU implementation.
7. **Star background.**
   - The `SkyBox` shader uses `czm_temeToPseudoFixed`, which is Earth's rotation.
   - Use `CubeMapPanorama({sources, transform})` with an ICRF→Mars-fixed matrix instead. Whether that matrix can be updated per frame is UNVERIFIED.
8. **Clamped routes.** `ApproximateTerrainHeights` loads Earth's `approximateTerrainHeights.json` (9,000 m ceiling), which can wrongly cull `GroundPolylinePrimitive` / `GroundPrimitive`. Test early. Fallback: sample heights ourselves and draw un-clamped polylines.
9. **3D Tiles bounding volumes.** `region` volumes are always read as WGS84, so use `box` volumes.
10. **Quantized-mesh headers.** Center, bounding sphere and horizon-occlusion point must be encoded with the Mars body.
11. **Globe defaults.** `globe.baseColor` defaults to (0, 0, 0.5); set a Mars color. Set `depthTestAgainstTerrain = true`.
12. **Already correct:** `EllipsoidGeodesic`, `PolylineGeometry` and the camera controller thresholds follow `Ellipsoid.default`. The clock is Earth UTC, so sols need our own conversion.
13. **Reduced motion and render mode:** `flyTo({duration: 0})`, inertia set to 0, `requestRenderMode: true`.

## Tiling pipeline

- **CRS codes:** `IAU_2015` codes have been in PROJ since 8.2 (49900 = sphere, planetocentric, east-positive; 49910 = equirectangular). **PROJ refuses transforms between different bodies**, so never target 4326 or 3857.
- **Imagery:** morecantile ≥ 6 custom TMS with rio-tiler. Or `gdal raster tile` (GDAL 3.11+; gdal2tiles deprecated from 3.13) after relabeling with `-a_srs EPSG:4326`. The relabel is valid only because tile math uses degrees. Custom TMS JSON with a Mars CRS in GDAL is UNVERIFIED.
- **Terrain:** pydelatin mesh → `quantized_mesh_encoder.encode(..., ellipsoid=Ellipsoid(3396190, 3396190))` + VertexNormalsExtension. `layer.json` with sparse availability.
- **Heightmap-1.0 can't be used.** It encodes value/5 − 1000, so heights below −1000 m are unrepresentable, and Jezero is about −2,600 m. `CustomHeightmapTerrainProvider` with Terrarium-encoded tiles is the fallback.
- **Avoid:**
  - cesium-terrain-builder (hardcodes EPSG:4326).
  - ctod (WGS84 defaults).
  - Cesium ion tiler (reprojects to 4326).
  - py3dtiles (point clouds only).
  - 3DTilesRendererJS `TerrainRGBMeshPlugin` (Web Mercator).
- **Tile resolution:** with 256 px tiles, resolution ≈ 41,677 / 2^z m/px.

## Precision, WebGPU, Vite

- **Precision:** Cesium handles it natively. In three.js, float32 resolves only to about 0.25 m at Mars radius, so a local origin is needed.
- **WebGPU:** Cesium is WebGL2-only (issue #4989 open since 2017).
- **Vite:** the official `cesium-vite-example` uses `vite-plugin-static-copy` and `CESIUM_BASE_URL`. Resium 1.26 exists, but a ref-managed `Viewer` is simpler.

## UNVERIFIED

- ion Mars permissibility.
- A public JPL Jezero tileset.
- Per-frame `CubeMapPanorama.transform` updates.
- How large the `ApproximateTerrainHeights` culling impact is.
- GDAL custom TMS with a Mars CRS.
- Trek latitude type.
- 3DTilesRendererJS WMTS on Mars.
- Mobile FPS.

## Sources

- **CesiumGS/cesium:**
  - `CHANGES.md`.
  - Sources at tag 1.145: Ellipsoid, UniformState, Transforms, SkyBox, CubeMapPanorama, Scene, CesiumWidget, Viewer, Globe, GeographicTilingScheme, CustomHeightmapTerrainProvider, CesiumTerrainProvider, Cesium3DTileset, TileBoundingRegion, ApproximateTerrainHeights, Moon, Atmosphere.
  - Sandcastle mars example; PR #12828; issue #4989.
- **CesiumGS/cesium-vite-example**
- **CesiumGS/3d-tiles:** `3DTILES_ellipsoid`
- **cesium.com:** blog 2025-09-03 "Lift off to Cesium Mars"; ion pricing; terms of service
- **NASA-AMMOS/3DTilesRendererJS:** README, CHANGELOG, plugins, examples (mars, ionLunar); issue #1380
- **deck.gl:** GlobeView docs and source
- **MapLibre:** source
- **iTowns:** mars example
- **Babylon.js:** geospatial camera
- **three.js:** r186
- **GDAL:** gdal2tiles and gdal raster tile docs
- **PROJ / spatialreference.org:** IAU_2015 49900/49901/49910/49912
- **Terrain tooling:** quantized-mesh-encoder, cesium-terrain-builder, ctod, morecantile, py3dtiles
- **astronomy-engine:** source
- **NASA Mars Trek:** WMTS
