/**
 * The planner's map. It follows the same authority hierarchy as the copy:
 *
 *   - a composed day gets numbered primary-route markers joined in order. The
 *     line is solid only when the route carries walking geometry; a line made of
 *     the stops' own coordinates is drawn dotted, because straight segments
 *     crossing water and buildings are not a walking path Parranda computed;
 *   - optional detour ideas are muted dots, drawn only while the detour list is
 *     open, so a mark on the map is never left without its explanation;
 *   - without a route (candidates only) there is no connecting line and no
 *     sequence number at all — nothing may read as an order never claimed.
 *
 * The renderer is MapLibre GL over OpenFreeMap vector tiles, drawn in Linje's
 * own day and night palettes (route-map-style.mjs). Each mounted map owns
 * exactly one MapLibre instance and releases it with the element, so a new day
 * always draws into a live container. A theme switch recolours the drawn map in
 * place: the route, markers and view stay.
 *
 * If the browser cannot draw it (no WebGL2, a lost graphics context) or the
 * tile provider is unreachable, the day is untouched: no map is drawn, or the
 * route draws over plain paper, and one line says so. Nothing retries on its
 * own.
 *
 * The view never puts a stop under the map's own controls (route-map-fit.mjs):
 * the zoom buttons, the attribution and the expand button are measured, and
 * every marker's disc is kept clear of them at the position it is drawn at.
 *
 * A tap on a stop's visible number opens that stop. Screen-space placement
 * keeps badge footprints apart and clear of controls at the current zoom.
 * Displaced badges retain a dot at their authoritative geographic coordinate.
 * Stops, their order, route geometry and the Maps handoff remain unchanged.
 */
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { routeMarkerPresentation, screenMarkerPresentation } from "../../lib/route-map-presentation.mjs";
import { controlAwareView, type FitMark, type MapBox } from "../../lib/route-map-fit.mjs";
import { BASEMAP_PROVIDER, basemapPaint, basemapStyle, type BasemapTheme } from "../../lib/route-map-style.mjs";
import type { RouteContextSuggestion } from "../../lib/route-context-view.mjs";
import { CollapseIcon, ExpandIcon } from "../shared/icons";
import type { DistrictArea } from "./types";
import type { Translate } from "./copy";

// Footprints the fit keeps clear of the controls, in px. A route marker's
// visible disc is 30px (tailwind.css: the 44px `.route-map-marker`, its
// `::before` inset 7px); a dot is a circle of radius 5 plus its stroke.
const MARKER_RADIUS = 15;
const DOT_RADIUS = 7;
// Every footprint stays this far inside the map edge (so a marker's whole 44px
// icon and target stay on the map) and this far from any control.
const EDGE_GAP = 7;
const CONTROL_GAP = 4;
// MapLibre's world is 512px at zoom 0 (Leaflet's was 256), so zoom 14 here is
// the scale Leaflet called 15: the same closest view of a day.
const TILE_SIZE = 512;
const FIT_MAX_ZOOM = 14;

const ROUTE_SOURCE = "parranda-route";
const CONTEXT_SOURCE = "parranda-context";
const CANDIDATE_SOURCE = "parranda-candidates";

type MapLibre = typeof import("maplibre-gl");
type Tip = { name: string; x: number; y: number; direction: "left" | "right" } | null;

let maplibreModule: Promise<MapLibre> | null = null;
/** MapLibre and its worker, loaded once and only when a map is drawn. */
function loadMapLibre(): Promise<MapLibre> {
  maplibreModule ??= Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
  ]).then(([mod, worker]) => {
    mod.setWorkerUrl(worker.default);
    return mod;
  });
  return maplibreModule;
}

function currentTheme(): BasemapTheme {
  const root = document.documentElement;
  const set = root.getAttribute("data-theme");
  if (set === "day" || set === "night") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

/** A Linje role colour as CSS rgb(), read from the theme tokens. */
function roleColour(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value ? `rgb(${value.split(/\s+/).join(", ")})` : fallback;
}

// Web Mercator in MapLibre's world pixels, for the control-aware fit.
function project(mark: { lat: number; lng: number }, zoom: number) {
  const world = TILE_SIZE * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((mark.lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((mark.lng + 180) / 360) * world,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world,
  };
}
function unproject(point: { x: number; y: number }, zoom: number) {
  const world = TILE_SIZE * 2 ** zoom;
  const lng = (point.x / world) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / world;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

/** The controls laid over the map — MapLibre's own and Parranda's — relative to the map container. */
function controlBoxes(frame: HTMLElement, container: HTMLElement): MapBox[] {
  const origin = container.getBoundingClientRect();
  return Array.from(frame.querySelectorAll<HTMLElement>(".maplibregl-ctrl, [data-map-control]"), (control) => {
    const box = control.getBoundingClientRect();
    return {
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top,
    };
  });
}

/**
 * Show every mark at the closest zoom where no marker sits under a control. If
 * no such view exists (the map is too small to read), fall back to a plain fit.
 */
function fitToControls(map: any, frame: HTMLElement | null, container: HTMLElement | null, marks: FitMark[]) {
  if (!map || !frame || !container || !marks.length) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  const view = controlAwareView({
    marks,
    width,
    height,
    keepouts: controlBoxes(frame, container),
    edge: EDGE_GAP,
    gap: CONTROL_GAP,
    maxZoom: FIT_MAX_ZOOM,
    project,
    unproject,
  });
  if (view) {
    map.jumpTo({ center: [view.center.lng, view.center.lat], zoom: view.zoom });
    return;
  }
  const lngs = marks.map((mark) => mark.lng);
  const lats = marks.map((mark) => mark.lat);
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 36, maxZoom: FIT_MAX_ZOOM, animate: false },
  );
}

const emptyCollection = { type: "FeatureCollection", features: [] as any[] };
const pointCollection = (points: Array<{ lat: number; lng: number; name?: string | null }>) => ({
  type: "FeatureCollection",
  features: points.map((point) => ({
    type: "Feature",
    properties: { name: String(point.name || "").trim() },
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
  })),
});

export default function RouteMap({
  hasPrimaryRoute,
  routeStops,
  primaryRoute,
  areas,
  routeContextSuggestions,
  showContext,
  sketch,
  mapExpanded,
  onToggleExpanded,
  heightClass,
  t,
}: {
  hasPrimaryRoute: boolean;
  routeStops: any[];
  primaryRoute: any;
  areas: DistrictArea[] | undefined;
  routeContextSuggestions: RouteContextSuggestion[];
  /** Draw the optional detour ideas (the detour list is open). */
  showContext: boolean;
  /** The route line joins the stops' own coordinates — draw it dotted. */
  sketch: boolean;
  mapExpanded?: boolean;
  /** Offer the expand control only where the map can grow in place. */
  onToggleExpanded?: () => void;
  heightClass: string;
  t: Translate;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<{ ml: MapLibre; map: any; ready: Promise<void>; markers: any[] } | null>(null);
  // What the view has to show, kept for the re-fit after expand/shrink.
  const marksRef = useRef<FitMark[]>([]);
  const [mapDrawn, setMapDrawn] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [layoutCrowded, setLayoutCrowded] = useState(false);
  const [tip, setTip] = useState<Tip>(null);
  // A tooltip opened by hover or focus can be dismissed without moving the
  // pointer or focus (WCAG 1.4.13).
  useEffect(() => {
    if (!tip) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTip(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [tip]);
  const badgesRef = useRef<Array<{ lat: number; lng: number; name: string; move: (x: number, y: number, direction: "left" | "right") => void; showOrigin: (visible: boolean) => void }>>([]);
  const layoutRef = useRef<() => void>(() => {});
  const refitRef = useRef<() => void>(() => {});
  layoutRef.current = () => {
    const instance = instanceRef.current;
    if (!badgesRef.current.length) { setLayoutCrowded(false); return; }
    if (!instance || !frameRef.current || !mapRef.current) return;
    const { map } = instance;
    const width = mapRef.current.clientWidth;
    const height = mapRef.current.clientHeight;
    const points = badgesRef.current.map((b) => map.project([b.lng, b.lat]));
    const offsets = screenMarkerPresentation(points, { width, height, keepouts: controlBoxes(frameRef.current, mapRef.current) });
    setLayoutCrowded(offsets === null);
    offsets?.forEach((offset, i) => badgesRef.current[i].move(offset.shift_x_px, offset.shift_y_px,
      points[i].x + offset.shift_x_px < width / 2 ? "right" : "left"));
    // Origin dots are optional coordinate hints, never relocated coordinates.
    // Suppress a hint when it would paint over any station (including its own).
    if (offsets) badgesRef.current.forEach((badge, i) => badge.showOrigin(
      (Math.abs(offsets[i].shift_x_px) > 0.5 || Math.abs(offsets[i].shift_y_px) > 0.5)
      && points.every((point, j) => Math.hypot(
        points[i].x - point.x - offsets[j].shift_x_px,
        points[i].y - point.y - offsets[j].shift_y_px,
      ) >= 26),
    ));
    else badgesRef.current.forEach((badge) => badge.showOrigin(false));
  };
  // The open name follows its marker while the map moves.
  const tipAnchorRef = useRef<{ index: number } | null>(null);

  // Theme: recolour the basemap and the route in place.
  const applyTheme = (map: any) => {
    const theme = currentTheme();
    for (const [layer, property, colour] of basemapPaint(theme)) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, property, colour);
    }
    const ember = roleColour("--p-color-ember", "#e8431d");
    const paper = roleColour("--p-color-paper", "#eeece7");
    const ink = roleColour("--p-color-ink", "#161411");
    if (map.getLayer("route-line")) map.setPaintProperty("route-line", "line-color", ember);
    if (map.getLayer("context-dots")) {
      map.setPaintProperty("context-dots", "circle-stroke-color", ember);
      map.setPaintProperty("context-dots", "circle-color", paper);
    }
    if (map.getLayer("candidate-dots")) {
      map.setPaintProperty("candidate-dots", "circle-stroke-color", ink);
      map.setPaintProperty("candidate-dots", "circle-color", paper);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const drawableAreas = (areas ?? []).filter(
        (a) => a?.center && Number.isFinite(a.center!.lat) && Number.isFinite(a.center!.lng),
      );
      const drawableRouteStops = routeStops.filter(
        (stop: any) => stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng),
      );
      const clearDrawn = () => {
        instanceRef.current?.markers.forEach((marker) => marker.remove());
        if (instanceRef.current) instanceRef.current.markers = [];
        badgesRef.current = [];
        tipAnchorRef.current = null;
        setTip(null);
      };
      if (!mapRef.current || (hasPrimaryRoute ? !drawableRouteStops.length : !drawableAreas.length)) {
        clearDrawn();
        marksRef.current = [];
        const map = instanceRef.current?.map;
        for (const source of [ROUTE_SOURCE, CONTEXT_SOURCE, CANDIDATE_SOURCE]) map?.getSource(source)?.setData(emptyCollection);
        setLayoutCrowded(false);
        setMapDrawn(true); // nothing to draw — clear the placeholder
        return;
      }
      let ml: MapLibre;
      try {
        ml = await loadMapLibre();
      } catch {
        if (!cancelled) { setMapFailed(true); setMapDrawn(true); }
        return;
      }
      if (cancelled || !mapRef.current) return;

      if (!instanceRef.current) {
        let map: any;
        try {
          map = new ml.Map({
            container: mapRef.current,
            style: basemapStyle(currentTheme()),
            center: [10, 30],
            zoom: 1,
            attributionControl: false,
            scrollZoom: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            maxPitch: 0,
            renderWorldCopies: false,
            fadeDuration: 0,
            // The canvas region's accessible name; MapLibre's default is "Map".
            locale: { "Map.Title": t("Karta över dagen", "Map of the day") },
          });
        } catch {
          // No WebGL2, or the GPU refused: the day stays, the map does not.
          setMapFailed(true);
          setMapDrawn(true);
          return;
        }
        map.touchZoomRotate?.disableRotation?.();
        map.addControl(new ml.NavigationControl({ showCompass: false }), "top-left");
        // The attribution is set from the start (not when the tiles answer), so
        // its size is known to the first fit and it stays even when they fail.
        map.addControl(new ml.AttributionControl({ compact: false, customAttribution: BASEMAP_PROVIDER.attribution }), "bottom-right");
        // A control that changes size (the attribution's font arriving, say)
        // asks for a new fit, so no stop is left under it.
        const controlObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => refitRef.current()) : null;
        mapRef.current.querySelectorAll(".maplibregl-ctrl").forEach((control) => controlObserver?.observe(control));
        map.once("remove", () => controlObserver?.disconnect());
        // Tile or glyph failures are the provider's: the route still draws
        // over paper, and one line says the background is missing. Logged
        // nowhere else, retried by nobody.
        map.on("error", (event: any) => {
          if (event?.sourceId === "openmaptiles" || /tile|glyph|font|pbf|openfreemap/i.test(String(event?.error?.message || ""))) {
            setTilesFailed(true);
          }
        });
        map.getCanvas?.()?.addEventListener?.("webglcontextlost", () => setMapFailed(true));
        const ready = new Promise<void>((resolve) => {
          if (map.isStyleLoaded?.()) resolve();
          else map.once("style.load", () => resolve());
        }).then(() => {
          map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyCollection });
          map.addSource(CONTEXT_SOURCE, { type: "geojson", data: emptyCollection });
          map.addSource(CANDIDATE_SOURCE, { type: "geojson", data: emptyCollection });
          map.addLayer({ id: "route-line", type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 5, "line-opacity": 0.95 } });
          map.addLayer({ id: "context-dots", type: "circle", source: CONTEXT_SOURCE, paint: { "circle-radius": 5, "circle-stroke-width": 1.5, "circle-opacity": 0.6, "circle-stroke-opacity": 0.75 } });
          map.addLayer({ id: "candidate-dots", type: "circle", source: CANDIDATE_SOURCE, paint: { "circle-radius": 5, "circle-stroke-width": 2 } });
          applyTheme(map);
        });
        for (const layer of ["context-dots", "candidate-dots"]) {
          map.on("mousemove", layer, (event: any) => {
            const feature = event.features?.[0];
            const name = String(feature?.properties?.name || "");
            if (!name) return;
            const point = map.project(feature.geometry.coordinates);
            tipAnchorRef.current = null;
            setTip({ name, x: point.x, y: point.y, direction: point.x < map.getContainer().clientWidth / 2 ? "right" : "left" });
          });
          map.on("mouseleave", layer, () => setTip(null));
        }
        // Numbers stay on the map while it moves (a drag, its inertia, a zoom):
        // laid out again once per frame, and once more when it settles.
        let layoutFrame = 0;
        const layoutSoon = () => {
          if (!layoutFrame) layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; layoutRef.current(); });
        };
        map.on("move", layoutSoon);
        map.on("moveend", () => layoutRef.current());
        map.on("zoomend", () => layoutRef.current());
        map.on("resize", () => layoutRef.current());
        map.once("remove", () => { if (layoutFrame) cancelAnimationFrame(layoutFrame); });
        map.on("move", () => {
          const anchor = tipAnchorRef.current;
          const badge = anchor ? badgesRef.current[anchor.index] : null;
          if (!badge) return;
          const point = map.project([badge.lng, badge.lat]);
          setTip((current) => (current ? { ...current, x: point.x, y: point.y } : current));
        });
        instanceRef.current = { ml, map, ready, markers: [] };
      }
      const { map, ready } = instanceRef.current;
      await ready;
      if (cancelled) return;
      clearDrawn();
      setLayoutCrowded(false);

      // Everything the view must show. The route line's own points only have
      // to stay on the map; stops and dots must also stay clear of the controls.
      const marks: FitMark[] = [];
      let routeLine: any = emptyCollection;
      let contextDots: any = emptyCollection;
      let candidateDots: any = emptyCollection;
      if (hasPrimaryRoute) {
        const enginePath: Array<[number, number]> = (Array.isArray(primaryRoute?.map_path_points) ? primaryRoute.map_path_points : [])
          .filter((point: any) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
          .map((point: any) => [point.lat, point.lng] as [number, number]);
        const routePath = enginePath.length > 1
          ? enginePath
          : drawableRouteStops.map((stop: any) => [stop.lat, stop.lng] as [number, number]);
        if (routePath.length > 1) {
          routeLine = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePath.map(([lat, lng]) => [lng, lat]) } };
          routePath.forEach(([lat, lng]: [number, number]) => marks.push({ lat, lng, avoidControls: false }));
        }

        const markerPresentation = routeMarkerPresentation(routeStops);
        routeStops.forEach((stop: any, index: number) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          const presentation = markerPresentation[index];
          const eventClass = stop.is_live_event === true ? " route-map-marker--event" : "";
          const shiftX = Number(presentation?.shift_x_px) || 0;
          const shiftY = Number(presentation?.shift_y_px) || 0;
          // Fitted where it is drawn: a clustered marker sits beside its coordinate.
          marks.push({ lat: stop.lat, lng: stop.lng, radius: MARKER_RADIUS, offsetX: shiftX, offsetY: shiftY });
          const markerName = String(stop.label || stop.name || "").trim();
          const badgeIndex = badgesRef.current.length;
          const open = () => {
            if (!markerName) return;
            const badge = badgesRef.current[badgeIndex];
            const point = map.project([stop.lng, stop.lat]);
            tipAnchorRef.current = { index: badgeIndex };
            setTip({ name: markerName, x: point.x + (badge as any).x, y: point.y + (badge as any).y, direction: (badge as any).direction });
          };
          const close = () => {
            if (tipAnchorRef.current?.index === badgeIndex) tipAnchorRef.current = null;
            setTip((current) => (current?.name === markerName ? null : current));
          };
          // Two 44px elements where the disc is drawn: the touch target beneath
          // every disc, and the disc with its number above all targets. Only
          // the disc's visible pin takes a tap on the disc's side.
          const target = document.createElement("div");
          target.className = "route-map-target";
          target.addEventListener("mouseenter", open);
          target.addEventListener("mouseleave", close);
          target.addEventListener("click", open);
          const shell = document.createElement("div");
          shell.className = "route-map-marker-shell";
          shell.style.zIndex = String(1200 + index);
          shell.tabIndex = 0;
          shell.setAttribute("role", "button");
          if (markerName) shell.setAttribute("aria-label", `${index + 1}. ${markerName}`);
          const disc = document.createElement("span");
          disc.className = `route-map-marker${eventClass}`;
          disc.textContent = String(index + 1);
          const origin = document.createElement("span");
          origin.className = "route-map-marker-origin";
          origin.hidden = !presentation?.clustered;
          origin.style.setProperty("--route-marker-x", `${shiftX}px`);
          origin.style.setProperty("--route-marker-y", `${shiftY}px`);
          shell.append(disc, origin);
          disc.addEventListener("mouseenter", open);
          disc.addEventListener("mouseleave", close);
          disc.addEventListener("click", open);
          shell.addEventListener("focus", open);
          shell.addEventListener("blur", close);
          const targetMarker = new ml.Marker({ element: target, anchor: "center", offset: [shiftX, shiftY] }).setLngLat([stop.lng, stop.lat]).addTo(map);
          const discMarker = new ml.Marker({ element: shell, anchor: "center", offset: [shiftX, shiftY] }).setLngLat([stop.lng, stop.lat]).addTo(map);
          // MapLibre sets its own stacking; targets stay beneath every disc.
          target.style.zIndex = "1";
          shell.style.zIndex = String(1200 + index);
          instanceRef.current!.markers.push(targetMarker, discMarker);
          let last = "";
          const badge: any = {
            lat: stop.lat,
            lng: stop.lng,
            name: markerName,
            x: shiftX,
            y: shiftY,
            direction: "right",
            showOrigin: (visible: boolean) => { origin.hidden = !visible; },
            move: (x: number, y: number, direction: "left" | "right") => {
              const key = `${x}:${y}:${direction}`;
              if (key === last) return;
              last = key;
              badge.x = x; badge.y = y; badge.direction = direction;
              const shifted = Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
              origin.hidden = !shifted;
              origin.style.setProperty("--route-marker-x", `${x}px`);
              origin.style.setProperty("--route-marker-y", `${y}px`);
              targetMarker.setOffset([x, y]);
              discMarker.setOffset([x, y]);
              if (tipAnchorRef.current?.index === badgeIndex) {
                const point = map.project([stop.lng, stop.lat]);
                setTip((current) => (current ? { ...current, x: point.x + x, y: point.y + y, direction } : current));
              }
            },
          };
          badgesRef.current.push(badge);
        });

        if (showContext) {
          const shown = routeContextSuggestions.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
          shown.forEach((stop) => marks.push({ lat: stop.lat!, lng: stop.lng!, radius: DOT_RADIUS }));
          contextDots = pointCollection(shown.map((stop) => ({ lat: stop.lat!, lng: stop.lng!, name: stop.name })));
        }
      } else {
        // No route exists: these are CANDIDATES, not an itinerary. No connecting
        // line, no sequence numbers — plain dots only, so nothing on the map can
        // be mistaken for a walking order Parranda never claimed.
        const dots: Array<{ lat: number; lng: number; name?: string | null }> = [];
        drawableAreas.forEach((area) => {
          marks.push({ lat: area.center!.lat, lng: area.center!.lng, avoidControls: false });
          (area.stops ?? []).forEach((stop) => {
            if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
            marks.push({ lat: stop.lat, lng: stop.lng, radius: DOT_RADIUS });
            dots.push({ lat: stop.lat, lng: stop.lng, name: stop.name });
          });
        });
        candidateDots = pointCollection(dots);
      }
      map.getSource(ROUTE_SOURCE)?.setData(routeLine);
      map.getSource(CONTEXT_SOURCE)?.setData(contextDots);
      map.getSource(CANDIDATE_SOURCE)?.setData(candidateDots);
      // Dotted when the line only joins the stops' own coordinates.
      map.setPaintProperty("route-line", "line-dasharray", sketch ? [0.2, 2.2] : null);
      marksRef.current = marks;
      map.resize();
      fitToControls(map, frameRef.current, mapRef.current, marks);
      layoutRef.current();
      setMapDrawn(true);
    }
    draw().catch(() => {
      if (!cancelled) { setMapFailed(true); setMapDrawn(true); }
    });
    return () => {
      cancelled = true;
    };
  }, [areas, primaryRoute, hasPrimaryRoute, routeStops, routeContextSuggestions, showContext, sketch]);

  // Follow the page's theme without redrawing the day.
  useEffect(() => {
    const root = document.documentElement;
    const observer = typeof MutationObserver === "function"
      ? new MutationObserver(() => { const map = instanceRef.current?.map; if (map?.getLayer?.("route-line")) applyTheme(map); })
      : null;
    observer?.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer?.disconnect();
  }, []);

  // Observe the actual container size. A fixed timer can fire before a delayed
  // CSS transition has finished; treating it as the final fit then leaves the
  // collapsed map with the expanded map's coordinates. ResizeObserver follows
  // every rendered size, and transitionend also requests the final fit.
  useEffect(() => {
    const frame = frameRef.current;
    const container = mapRef.current;
    let animationFrame = 0;
    const refit = () => {
      animationFrame = 0;
      const map = instanceRef.current?.map;
      if (!map) return;
      map.resize();
      fitToControls(map, frameRef.current, mapRef.current, marksRef.current);
      layoutRef.current();
    };
    const schedule = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(refit);
    };
    refitRef.current = schedule;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (container) observer?.observe(container);
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === frame && event.propertyName === "height") schedule();
    };
    frame?.addEventListener("transitionend", onTransitionEnd);
    window.addEventListener("resize", schedule);
    schedule(); // also covers an instant expansion without a transition
    return () => {
      observer?.disconnect();
      frame?.removeEventListener("transitionend", onTransitionEnd);
      window.removeEventListener("resize", schedule);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [mapExpanded]);

  // The instance belongs to this element: release it with the element.
  useEffect(
    () => () => {
      instanceRef.current?.markers.forEach((marker) => marker.remove());
      instanceRef.current?.map.remove();
      instanceRef.current = null;
    },
    [],
  );

  if (mapFailed) {
    return (
      <p role="status" className="rounded-parranda border border-parranda-ink/10 px-4 py-3 text-sm text-parranda-ink/72">
        {t(
          "Kartan kan inte visas i den här webbläsaren. Stoppen och Maps-rutten fungerar som vanligt.",
          "The map can't be shown in this browser. The stops and the Maps route work as usual.",
        )}
      </p>
    );
  }

  return (
    <>
    <div ref={frameRef} data-route-map="" className={`route-map-frame relative w-full overflow-hidden rounded-parranda border border-parranda-ink/10 transition-all ${heightClass}`}>
      {/* Screen layout keeps each numbered touch footprint independently visible. */}
      <div ref={mapRef} className="h-full w-full" />
      {tip && (
        <div
          role="tooltip"
          className={`route-map-tooltip route-map-tooltip--${tip.direction}`}
          style={{ left: `${tip.x}px`, top: `${tip.y}px` }}
        >
          {tip.name}
        </div>
      )}
      {!mapDrawn && (
        <div className="absolute inset-0 flex items-center justify-center bg-parranda-ink/10 text-sm text-parranda-ink/68">
          {t("Ritar kartan …", "Drawing the map …")}
        </div>
      )}
      {/* An icon, so it covers no more of the map than a thumb needs. It is a
          map control (data-map-control): the fit keeps every stop clear of it. */}
      {onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={mapExpanded}
          aria-label={mapExpanded ? t("Förminska kartan", "Shrink map") : t("Förstora kartan", "Expand map")}
          data-map-control=""
          className="absolute right-2.5 top-2.5 z-1001 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-parranda-ink/20 bg-parranda-paper/90 text-parranda-ink/85 shadow-xs backdrop-blur-xs transition hover:border-parranda-ember"
        >
          {mapExpanded ? <CollapseIcon className="h-5 w-5" /> : <ExpandIcon className="h-5 w-5" />}
        </button>
      )}
    </div>
    {tilesFailed && (
      <p role="status" className="mt-1 text-xs text-parranda-ink/68">
        {t("Kartbakgrunden kunde inte hämtas — rutten och stoppen visas ändå.", "The map background couldn't be loaded — the route and stops are still shown.")}
      </p>
    )}
    {layoutCrowded && <p role="status" className="mt-1 text-xs text-parranda-ink/68">{t("Kartan är trång — förstora eller zooma för att skilja alla stoppnummer åt.", "The map is crowded — expand or zoom to separate all stop numbers.")}</p>}
    </>
  );
}
