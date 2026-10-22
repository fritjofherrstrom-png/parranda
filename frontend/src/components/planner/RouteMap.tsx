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
import { pinGroupLabel, screenPinPresentation } from "../../lib/route-map-presentation.mjs";
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
function fitToControls(map: any, frame: HTMLElement | null, container: HTMLElement | null, marks: FitMark[], fitted?: { current: number }) {
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
    // Known before the move, so the layout during jumpTo already sees it.
    if (fitted) fitted.current = view.zoom;
    map.jumpTo({ center: [view.center.lng, view.center.lat], zoom: view.zoom });
    return;
  }
  if (fitted) fitted.current = -Infinity;
  const lngs = marks.map((mark) => mark.lng);
  const lats = marks.map((mark) => mark.lat);
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 36, maxZoom: FIT_MAX_ZOOM, animate: false },
  );
  if (fitted) fitted.current = map.getZoom();
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
  regionLabel,
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
  /**
   * The canvas region's accessible name. "Map of the day" unless the map sits
   * in a landmark that already carries that name (the wide-screen column):
   * two landmarks with one name read as a duplicate.
   */
  regionLabel?: string;
  t: Translate;
}) {
  const mapTitle = regionLabel || t("Karta över dagen", "Map of the day");
  const mapTitleRef = useRef(mapTitle);
  mapTitleRef.current = mapTitle;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<{ ml: MapLibre; map: any; ready: Promise<void>; markers: any[] } | null>(null);
  // One map instance moves between layouts; its name follows where it sits.
  useEffect(() => {
    instanceRef.current?.map?.getCanvas?.()?.setAttribute("aria-label", mapTitle);
  }, [mapTitle]);
  // What the view has to show, kept for the re-fit after expand/shrink.
  const marksRef = useRef<FitMark[]>([]);
  const [mapDrawn, setMapDrawn] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [layoutCrowded, setLayoutCrowded] = useState(false);
  const [tip, setTip] = useState<Tip>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const track = (event: MouseEvent) => { lastPointerRef.current = { x: event.clientX, y: event.clientY }; };
    document.addEventListener("mousemove", track, { capture: true, passive: true });
    return () => document.removeEventListener("mousemove", track, true);
  }, []);
  // A tooltip opened by hover or focus can be dismissed without moving the
  // pointer or focus (WCAG 1.4.13).
  useEffect(() => {
    if (!tip) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { tipAnchorRef.current = null; setTip(null); }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [tip]);
  const badgesRef = useRef<Array<{ lat: number; lng: number; name: string; move: (x: number, y: number, direction: "left" | "right") => void; showOrigin: (visible: boolean) => void; setGrouped: (grouped: boolean) => void; focus: () => void }>>([]);
  // Group pins by member key ("0,1,4"), the last shift of every pin (so a pin
  // stays put while the map moves), and the stop to focus once a group pin
  // opened from the keyboard has separated.
  const groupPinsRef = useRef<Map<string, { marker: any; element: HTMLElement }>>(new Map());
  const pinShiftsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  const focusAfterSplitRef = useRef<number | null>(null);
  // The zoom of the map's own fit: group pins appear only below it.
  const fittedZoomRef = useRef<number>(-Infinity);
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
    // Every pin covers its own stop at every zoom; stops that cannot be shown
    // apart share one group pin (route-map-presentation).
    // Plain JS on purpose: tests/route-map-origin-fallback.test.js runs it.
    const pins = screenPinPresentation(points, {
      width, height, keepouts: controlBoxes(frameRef.current, mapRef.current), previous: pinShiftsRef.current,
    });
    setLayoutCrowded(pins === null);
    const groups = new Map();
    if (!pins) badgesRef.current.forEach((badge) => badge.setGrouped(false));
    if (pins) {
      pinShiftsRef.current = new Map(pins.map((pin) => [pin.members.join(","), { dx: pin.shift_x_px, dy: pin.shift_y_px }]));
      for (const pin of pins) {
        if (pin.members.length > 1) { groups.set(pin.members.join(","), pin); continue; }
        const i = pin.members[0];
        badgesRef.current[i].setGrouped(false);
        badgesRef.current[i].move(pin.shift_x_px, pin.shift_y_px, pin.x < width / 2 ? "right" : "left");
      }
      for (const pin of pins) if (pin.members.length > 1) pin.members.forEach((i) => badgesRef.current[i].setGrouped(true));
    }
    syncGroupPins(map, groups);
    // Origin dots are optional coordinate hints, never relocated coordinates.
    // Suppress a hint when it would paint over any station (including its own)
    // or a group pin; a stop inside a group pin shows none.
    const pinOf = badgesRef.current.map((_, i) => (pins || []).find((pin) => pin.members.includes(i)));
    const stations = (pins || []).map((pin) => (pin.members.length > 1
      ? { x: pin.x, y: pin.y }
      : { x: points[pin.members[0]].x + pin.shift_x_px, y: points[pin.members[0]].y + pin.shift_y_px }));
    badgesRef.current.forEach((badge, i) => {
      const pin = pinOf[i];
      const moved = pin && pin.members.length === 1 && (Math.abs(pin.shift_x_px) > 0.5 || Math.abs(pin.shift_y_px) > 0.5);
      badge.showOrigin(Boolean(moved && stations.every((station) => Math.hypot(points[i].x - station.x, points[i].y - station.y) >= 26)));
    });
    // A group pin opened from the keyboard hands focus to its first stop once
    // the zoom has separated it.
    // The pin that replaced it may itself be a smaller group.
    const waiting = focusAfterSplitRef.current;
    const next = waiting !== null ? pinOf[waiting] : null;
    if (next && !next.offscreen) {
      focusAfterSplitRef.current = null;
      if (next.members.length === 1) badgesRef.current[next.members[0]].focus();
      else groupPinsRef.current.get(next.members.join(","))?.element.focus();
    }
  };

  // Group pins: created for a set of stops when they first share a pin, moved
  // with the map, removed once they separate.
  const syncGroupPins = (map: any, groups: Map<string, { members: number[]; x: number; y: number }>): void => {
    const ml = instanceRef.current?.ml;
    if (!ml) return;
    for (const [key, pin] of groupPinsRef.current) {
      if (groups.has(key)) continue;
      const hadFocus = pin.element.contains(document.activeElement);
      pin.marker.remove();
      groupPinsRef.current.delete(key);
      // Never leave keyboard focus on a removed element.
      if (hadFocus && focusAfterSplitRef.current === null) focusAfterSplitRef.current = Number(key.split(",")[0]);
    }
    for (const [key, group] of groups) {
      const badges = group.members.map((i) => badgesRef.current[i]);
      const lng = badges.reduce((sum, b) => sum + b.lng, 0) / badges.length;
      const lat = badges.reduce((sum, b) => sum + b.lat, 0) / badges.length;
      const at = map.project([lng, lat]);
      const offset: [number, number] = [group.x - at.x, group.y - at.y];
      let pin = groupPinsRef.current.get(key);
      if (!pin) {
        const label = pinGroupLabel(group.members);
        const names = group.members.map((i) => `${i + 1}. ${badgesRef.current[i].name}`).join(", ");
        const element = document.createElement("div");
        element.className = "route-map-marker-shell route-map-group";
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", t(
          `Stopp ${label}: ${names}. Zooma in för att skilja dem åt.`,
          `Stops ${label}: ${names}. Zoom in to separate them.`,
        ));
        element.title = names;
        const disc = document.createElement("span");
        disc.className = "route-map-marker route-map-marker--group";
        disc.textContent = label;
        element.append(disc);
        const open = () => {
          if (element.contains(document.activeElement)) focusAfterSplitRef.current = group.members[0];
          const bounds = new ml.LngLatBounds();
          group.members.forEach((i) => bounds.extend([badgesRef.current[i].lng, badgesRef.current[i].lat]));
          const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          // At least the map's own fitted zoom, where every number has its own pin.
          const camera = map.cameraForBounds(bounds, { padding: 48, maxZoom: Math.max(map.getZoom() + 1, 16) });
          const zoom = Math.max(camera?.zoom ?? map.getZoom() + 2, fittedZoomRef.current);
          map.easeTo({ center: bounds.getCenter(), zoom, duration: still ? 0 : 450 });
        };
        // The whole 44px pin takes the tap (route-map-group in tailwind.css).
        element.addEventListener("click", open);
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        });
        const marker = new ml.Marker({ element, anchor: "center", offset }).setLngLat([lng, lat]).addTo(map);
        element.style.zIndex = String(1200 + group.members[0]);
        groupPinsRef.current.set(key, { marker, element });
        continue;
      }
      pin.marker.setLngLat([lng, lat]);
      pin.marker.setOffset(offset);
    }
  };
  // Explicit selection survives pointer leave as layout/scroll moves a marker.
  // Hover remains transient; keyboard focus keeps its own blur boundary.
  const tipAnchorRef = useRef<{ index: number; interaction: "hover" | "focus" | "click" } | null>(null);

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
        groupPinsRef.current.forEach((pin) => pin.marker.remove());
        groupPinsRef.current = new Map();
        pinShiftsRef.current = new Map();
        focusAfterSplitRef.current = null;
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
            locale: { "Map.Title": mapTitleRef.current },
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
          map.on("mouseleave", layer, () => { if (!tipAnchorRef.current) setTip(null); });
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

        routeStops.forEach((stop: any, index: number) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          const eventClass = stop.is_live_event === true ? " route-map-marker--event" : "";
          // Every pin starts on its own stop; the layout may nudge it by less
          // than its radius or share it with neighbours, never move it away.
          const shiftX = 0;
          const shiftY = 0;
          marks.push({ lat: stop.lat, lng: stop.lng, radius: MARKER_RADIUS });
          const markerName = String(stop.label || stop.name || "").trim();
          const badgeIndex = badgesRef.current.length;
          const open = (interaction: "hover" | "focus" | "click", event?: MouseEvent) => {
            if (!markerName) return;
            if (interaction === "hover" && tipAnchorRef.current?.interaction === "click") {
              // Layout can move this OR another marker under a stationary
              // pointer. Only actual pointer movement starts a new inspection.
              const previous = lastPointerRef.current;
              if (tipAnchorRef.current.index === badgeIndex || (event && previous
                && event.clientX === previous.x && event.clientY === previous.y)) return;
            }
            if (interaction === "click" && event) lastPointerRef.current = { x: event.clientX, y: event.clientY };
            const badge = badgesRef.current[badgeIndex];
            const point = map.project([stop.lng, stop.lat]);
            tipAnchorRef.current = { index: badgeIndex, interaction };
            setTip({ name: markerName, x: point.x + (badge as any).x, y: point.y + (badge as any).y, direction: (badge as any).direction });
          };
          const close = (boundary: "leave" | "blur") => {
            const anchor = tipAnchorRef.current;
            if (anchor?.index !== badgeIndex || (boundary === "leave" && anchor.interaction !== "hover")) return;
            tipAnchorRef.current = null;
            setTip(null);
          };
          // Two 44px elements where the disc is drawn: the touch target beneath
          // every disc, and the disc with its number above all targets. Only
          // the disc's visible pin takes a tap on the disc's side.
          const target = document.createElement("div");
          target.className = "route-map-target";
          target.addEventListener("mouseenter", (event) => open("hover", event));
          target.addEventListener("mouseleave", () => close("leave"));
          target.addEventListener("click", (event) => open("click", event));
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
          origin.hidden = true;
          origin.style.setProperty("--route-marker-x", `${shiftX}px`);
          origin.style.setProperty("--route-marker-y", `${shiftY}px`);
          shell.append(disc, origin);
          disc.addEventListener("mouseenter", (event) => open("hover", event));
          disc.addEventListener("mouseleave", () => close("leave"));
          disc.addEventListener("click", (event) => open("click", event));
          shell.addEventListener("focus", () => open("focus"));
          shell.addEventListener("blur", () => close("blur"));
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
            // In a group pin: the stop's own pin steps aside, out of sight,
            // out of the tab order and out of the accessibility tree.
            setGrouped: (grouped: boolean) => {
              if (badge.grouped === grouped) return;
              badge.grouped = grouped;
              for (const element of [target, shell]) element.style.visibility = grouped ? "hidden" : "";
              shell.tabIndex = grouped ? -1 : 0;
              if (grouped) shell.setAttribute("aria-hidden", "true"); else shell.removeAttribute("aria-hidden");
              if (grouped && tipAnchorRef.current?.index === badgeIndex) close("blur");
            },
            focus: () => shell.focus(),
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
      fitToControls(map, frameRef.current, mapRef.current, marks, fittedZoomRef);
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
      fitToControls(map, frameRef.current, mapRef.current, marksRef.current, fittedZoomRef);
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
          className="absolute right-2.5 top-2.5 z-(--p-z-map-control) inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-parranda-ink/20 bg-parranda-paper/90 text-parranda-ink/85 shadow-control backdrop-blur-xs transition hover:border-parranda-ember"
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
