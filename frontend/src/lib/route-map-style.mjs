/**
 * The planner map's basemap, drawn in Linje's own colours.
 *
 * Vector tiles from OpenFreeMap (OpenMapTiles schema, OpenStreetMap data). The
 * style is built here rather than loaded from the provider, so:
 *   - day and night are real palettes, not a filter over a raster: the night
 *     map is drawn dark, its labels are not inverted;
 *   - a theme switch recolours the drawn map in place (`basemapPaint`), without
 *     reloading the style or losing the route, markers or view;
 *   - when the provider is unreachable the map still has a style: the route and
 *     its numbered stops draw over the paper background, and nothing waits on
 *     a style request that never answers.
 *
 * Deliberately quiet: no icons, sprites, 3D or POIs, so the day's own stops are
 * the only points on the map. Town names hide at street zoom, where they would
 * sit on the route.
 *
 * Provider settings live in BASEMAP_PROVIDER, apart from the renderer.
 */

export const BASEMAP_PROVIDER = {
  // TileJSON for the OpenMapTiles vector planet.
  tiles: "https://tiles.openfreemap.org/planet",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  attribution:
    '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
};

// One palette per theme. Paper and ink are the Linje tokens (tokens.css); the
// rest are quiet tints of them, so the route's ember stays the loudest colour.
export const BASEMAP_PALETTES = {
  day: {
    paper: "#EEECE7",
    water: "#C9D3D6",
    waterLabel: "#5B727A",
    park: "#DFE2D5",
    wood: "#D9DDCD",
    building: "#E3E0D9",
    buildingLine: "#D6D2CA",
    path: "#F6F4EF",
    minor: "#FFFFFF",
    major: "#FFFFFF",
    casing: "#D6D2CA",
    rail: "#CBC6BD",
    label: "#57534C",
    halo: "#EEECE7",
  },
  night: {
    paper: "#111012",
    water: "#1A2327",
    waterLabel: "#7E98A1",
    park: "#161B15",
    wood: "#151A14",
    building: "#1B1A1A",
    buildingLine: "#242222",
    path: "#1F1D1C",
    minor: "#2A2725",
    major: "#34302D",
    casing: "#0A0909",
    rail: "#33302D",
    label: "#A29D94",
    halo: "#111012",
  },
};

const SOURCE = "openmaptiles";
const lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const polygons = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
const notTunnel = ["!=", ["get", "brunnel"], "tunnel"];
// Local names in Latin script where the data has them (Malmö, not Malmo).
const localName = ["coalesce", ["get", "name:latin"], ["get", "name"]];

/** Every basemap layer and which palette colour each painted property takes. */
const LAYERS = [
  { layer: { id: "background", type: "background" }, paint: { "background-color": "paper" } },
  {
    layer: { id: "landcover-wood", type: "fill", source: SOURCE, "source-layer": "landcover", minzoom: 10, filter: ["all", polygons, ["==", ["get", "class"], "wood"]] },
    paint: { "fill-color": "wood" },
  },
  { layer: { id: "park", type: "fill", source: SOURCE, "source-layer": "park", filter: polygons }, paint: { "fill-color": "park" } },
  { layer: { id: "water", type: "fill", source: SOURCE, "source-layer": "water", filter: ["all", polygons, notTunnel] }, paint: { "fill-color": "water" } },
  {
    layer: { id: "waterway", type: "line", source: SOURCE, "source-layer": "waterway", filter: lines, staticPaint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 3] } },
    paint: { "line-color": "water" },
  },
  {
    layer: { id: "building", type: "fill", source: SOURCE, "source-layer": "building", minzoom: 13 },
    paint: { "fill-color": "building", "fill-outline-color": "buildingLine" },
  },
  {
    layer: {
      id: "road-path", type: "line", source: SOURCE, "source-layer": "transportation", minzoom: 14,
      filter: ["all", lines, ["match", ["get", "class"], ["path", "pedestrian"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 14, 1, 20, 8] },
    },
    paint: { "line-color": "path" },
  },
  {
    layer: {
      id: "road-minor", type: "line", source: SOURCE, "source-layer": "transportation", minzoom: 12,
      filter: ["all", lines, ["match", ["get", "class"], ["minor", "service", "track"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.6, 20, 18] },
    },
    paint: { "line-color": "minor" },
  },
  {
    layer: {
      id: "road-major-casing", type: "line", source: SOURCE, "source-layer": "transportation", minzoom: 11,
      filter: ["all", lines, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 3, 20, 23] },
    },
    paint: { "line-color": "casing" },
  },
  {
    layer: {
      id: "road-major", type: "line", source: SOURCE, "source-layer": "transportation", minzoom: 9,
      filter: ["all", lines, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 2, 20, 20] },
    },
    paint: { "line-color": "major" },
  },
  {
    layer: {
      id: "rail", type: "line", source: SOURCE, "source-layer": "transportation", minzoom: 12,
      filter: ["all", lines, ["match", ["get", "class"], ["rail", "transit"], true, false], ["!", ["has", "service"]]],
      staticPaint: { "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 2.5] },
    },
    paint: { "line-color": "rail" },
  },
  {
    layer: {
      id: "water-name", type: "symbol", source: SOURCE, "source-layer": "water_name", minzoom: 11,
      layout: { "text-field": localName, "text-font": ["Noto Sans Italic"], "text-size": 13, "text-letter-spacing": 0.1, "text-max-width": 6 },
      staticPaint: { "text-halo-width": 1.2 },
    },
    paint: { "text-color": "waterLabel", "text-halo-color": "halo" },
  },
  {
    layer: {
      id: "road-name", type: "symbol", source: SOURCE, "source-layer": "transportation_name", minzoom: 14,
      filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "minor", "pedestrian"], true, false],
      layout: { "symbol-placement": "line", "text-field": localName, "text-font": ["Noto Sans Regular"], "text-size": 12, "text-rotation-alignment": "map" },
      staticPaint: { "text-halo-width": 1.4 },
    },
    paint: { "text-color": "label", "text-halo-color": "halo" },
  },
  {
    layer: {
      id: "place-district", type: "symbol", source: SOURCE, "source-layer": "place", minzoom: 12,
      filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood"], true, false],
      layout: { "text-field": localName, "text-font": ["Noto Sans Bold"], "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 },
      staticPaint: { "text-halo-width": 1.4 },
    },
    paint: { "text-color": "label", "text-halo-color": "halo" },
  },
  {
    // Town and city names only while zoomed out; at street zoom they would sit
    // on the day's own route.
    layer: {
      id: "place-town", type: "symbol", source: SOURCE, "source-layer": "place", minzoom: 5, maxzoom: 10,
      filter: ["match", ["get", "class"], ["city", "town"], true, false],
      layout: { "text-field": localName, "text-font": ["Noto Sans Bold"], "text-size": 14, "text-max-width": 8 },
      staticPaint: { "text-halo-width": 1.6 },
    },
    paint: { "text-color": "label", "text-halo-color": "halo" },
  },
];

function paletteFor(theme) {
  return BASEMAP_PALETTES[theme === "night" ? "night" : "day"];
}

/** The whole basemap style for a theme ("day" | "night"). */
export function basemapStyle(theme) {
  const palette = paletteFor(theme);
  return {
    version: 8,
    glyphs: BASEMAP_PROVIDER.glyphs,
    sources: {
      // Attribution is the map's own control (RouteMap.tsx), shown from the
      // start; the TileJSON's copy would only repeat it.
      [SOURCE]: { type: "vector", url: BASEMAP_PROVIDER.tiles, attribution: "" },
    },
    layers: LAYERS.map(({ layer, paint }) => {
      const { staticPaint, ...rest } = layer;
      return {
        ...rest,
        paint: {
          ...(staticPaint || {}),
          ...Object.fromEntries(Object.entries(paint).map(([property, colour]) => [property, palette[colour]])),
        },
      };
    }),
  };
}

/** [layer id, paint property, colour] for every themed property, to recolour in place. */
export function basemapPaint(theme) {
  const palette = paletteFor(theme);
  return LAYERS.flatMap(({ layer, paint }) =>
    Object.entries(paint).map(([property, colour]) => [layer.id, property, palette[colour]]),
  );
}

/** The basemap layer ids, bottom to top; route layers go above them. */
export const BASEMAP_LAYER_IDS = LAYERS.map(({ layer }) => layer.id);
