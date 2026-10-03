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
 * Each mounted map owns exactly one Leaflet instance and releases it with the
 * element, so a new day always draws into a live container.
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
import "leaflet/dist/leaflet.css";
import { routeMarkerPresentation, screenMarkerPresentation } from "../../lib/route-map-presentation.mjs";
import { controlAwareView, type FitMark, type MapBox } from "../../lib/route-map-fit.mjs";
import type { RouteContextSuggestion } from "../../lib/route-context-view.mjs";
import { CollapseIcon, ExpandIcon } from "../shared/icons";
import type { DistrictArea } from "./types";
import type { Translate } from "./copy";

// The line's colour comes from the theme (tailwind.css: `.route-map-line` and
// the dot classes read the role tokens), so a day/night switch recolours a
// drawn map without redrawing it. This value is only the SVG fallback.
const ROUTE_COLOR = "#e8431d";

// Footprints the fit keeps clear of the controls, in px. A route marker's
// visible disc is 30px (tailwind.css: the 44px `.route-map-marker`, its
// `::before` inset 7px); a dot is a circleMarker of radius 5 plus its stroke.
const MARKER_RADIUS = 15;
const DOT_RADIUS = 7;
// Every footprint stays this far inside the map edge (so a marker's whole 44px
// icon and target stay on the map) and this far from any control.
const EDGE_GAP = 7;
const CONTROL_GAP = 4;
const FIT_MAX_ZOOM = 15;
// The route stops' touch targets: above the route line and the dots (overlay
// pane, 400), beneath every stop's disc (marker pane, 600).
const TARGET_PANE = "routeTargetPane";
const TARGET_PANE_Z_INDEX = "550";

function safeTooltip(name: string): string {
  const safe = document.createElement("div");
  safe.textContent = name;
  return safe.innerHTML;
}

/** The controls laid over the map — Leaflet's own and Parranda's — relative to the map container. */
function controlBoxes(frame: HTMLElement, container: HTMLElement): MapBox[] {
  const origin = container.getBoundingClientRect();
  return Array.from(frame.querySelectorAll<HTMLElement>(".leaflet-control, [data-map-control]"), (control) => {
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
function fitToControls(
  leaflet: { L: any; map: any } | null,
  frame: HTMLElement | null,
  container: HTMLElement | null,
  marks: FitMark[],
) {
  if (!leaflet || !frame || !container || !marks.length) return;
  const { L, map } = leaflet;
  const size = map.getSize();
  const view = controlAwareView({
    marks,
    width: size?.x,
    height: size?.y,
    keepouts: controlBoxes(frame, container),
    edge: EDGE_GAP,
    gap: CONTROL_GAP,
    maxZoom: FIT_MAX_ZOOM,
    project: (mark, zoom) => map.project(L.latLng(mark.lat, mark.lng), zoom),
    unproject: (point, zoom) => map.unproject(L.point(point.x, point.y), zoom),
  });
  // Not animated: Leaflet ignores a new view while a zoom animation runs, and
  // the fit after an expand or shrink must never be dropped.
  if (view) map.setView([view.center.lat, view.center.lng], view.zoom, { animate: false });
  else map.fitBounds(marks.map((mark) => [mark.lat, mark.lng]), { padding: [36, 36], maxZoom: FIT_MAX_ZOOM });
}

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
  const leafletRef = useRef<{ L: any; map: any; layer: any } | null>(null);
  // What the view has to show, kept for the re-fit after expand/shrink.
  const marksRef = useRef<FitMark[]>([]);
  const [mapDrawn, setMapDrawn] = useState(false);
  const [layoutCrowded, setLayoutCrowded] = useState(false);
  const badgesRef = useRef<Array<{ lat: number; lng: number; move: (x: number, y: number, direction: "left" | "right") => void }>>([]);
  const layoutRef = useRef<() => void>(() => {});
  layoutRef.current = () => {
    const leaflet = leafletRef.current;
    if (!badgesRef.current.length) { setLayoutCrowded(false); return; }
    if (!leaflet || !frameRef.current || !mapRef.current) return;
    const size = leaflet.map.getSize();
    const points = badgesRef.current.map(b => leaflet.map.latLngToContainerPoint([b.lat, b.lng]));
    const offsets = screenMarkerPresentation(points, { width: size.x, height: size.y, keepouts: controlBoxes(frameRef.current, mapRef.current) });
    setLayoutCrowded(offsets === null);
    offsets?.forEach((offset, i) => badgesRef.current[i].move(offset.shift_x_px, offset.shift_y_px,
      points[i].x + offset.shift_x_px < size.x / 2 ? "right" : "left"));
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
      if (!mapRef.current || (hasPrimaryRoute ? !drawableRouteStops.length : !drawableAreas.length)) {
        badgesRef.current = [];
        marksRef.current = [];
        leafletRef.current?.layer.clearLayers();
        setLayoutCrowded(false);
        setMapDrawn(true); // nothing to draw — clear the placeholder
        return;
      }
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      if (!leafletRef.current) {
        const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([30, 10], 2);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);
        map.createPane(TARGET_PANE).style.zIndex = TARGET_PANE_Z_INDEX;
        leafletRef.current = { L, map, layer: L.layerGroup().addTo(map) };
        map.on("zoomend moveend resize", () => layoutRef.current());
      }
      const { map, layer } = leafletRef.current;
      badgesRef.current = [];
      setLayoutCrowded(false);
      layer.clearLayers();

      // Everything the view must show. The route line's own points only have
      // to stay on the map; stops and dots must also stay clear of the controls.
      const marks: FitMark[] = [];
      if (hasPrimaryRoute) {
        const enginePath: Array<[number, number]> = (Array.isArray(primaryRoute?.map_path_points) ? primaryRoute.map_path_points : [])
          .filter((point: any) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
          .map((point: any) => [point.lat, point.lng] as [number, number]);
        const routePath = enginePath.length > 1
          ? enginePath
          : drawableRouteStops.map((stop: any) => [stop.lat, stop.lng] as [number, number]);
        if (routePath.length > 1) {
          layer.addLayer(
            L.polyline(
              routePath,
              sketch
                ? { className: "route-map-line", color: ROUTE_COLOR, weight: 5, opacity: 0.95, dashArray: "1 11", lineCap: "round" }
                : { className: "route-map-line", color: ROUTE_COLOR, weight: 5, opacity: 0.95 },
            ),
          );
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
          // The disc and its touch target are each a 44px icon drawn where the
          // disc is: the display offset lives in the anchor. Neither covers more
          // than that box, and Leaflet's pan on focus asks only for it, which
          // the fit already keeps on the map: a tap never moves the map.
          const iconAnchor: [number, number] = [22 - shiftX, 22 - shiftY];
          // A clustered stop is drawn beside its coordinate; a dot marks the coordinate.
          const origin = presentation?.clustered
            ? `<span class="route-map-marker-origin" style="--route-marker-x:${shiftX}px;--route-marker-y:${shiftY}px"></span>`
            : "";
          const disc = L.marker([stop.lat, stop.lng], {
            icon: L.divIcon({
              className: "route-map-marker-shell",
              html: `<span class="route-map-marker${eventClass}">${index + 1}</span>${origin}`,
              iconSize: [44, 44],
              iconAnchor,
            }),
            zIndexOffset: 1200 + index,
            autoPanOnFocus: false,
          });
          const target = L.marker([stop.lat, stop.lng], {
            icon: L.divIcon({ className: "route-map-target", iconSize: [44, 44], iconAnchor }),
            pane: TARGET_PANE,
            // The disc is the stop's one keyboard stop.
            keyboard: false,
            zIndexOffset: 1200 + index,
          });
          // One stop, one name, whichever of the two takes the tap or hover.
          const stopLayers = L.featureGroup([target, disc]);
          const markerName = String(stop.label || stop.name || "").trim();
          if (markerName) stopLayers.bindTooltip(safeTooltip(markerName));
          layer.addLayer(stopLayers);
          let lastX = NaN;
          let lastY = NaN;
          let lastDirection = "";
          badgesRef.current.push({ lat: stop.lat, lng: stop.lng, move: (x, y, direction) => {
            if (x === lastX && y === lastY && direction === lastDirection) return;
            lastX = x; lastY = y;
            lastDirection = direction;
            const shifted = Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
            const dot = shifted ? `<span class="route-map-marker-origin" style="--route-marker-x:${x}px;--route-marker-y:${y}px"></span>` : "";
            const anchor: [number, number] = [22 - x, 22 - y];
            disc.setIcon(L.divIcon({ className: "route-map-marker-shell", html: `<span class="route-map-marker${eventClass}">${index + 1}</span>${dot}`, iconSize: [44, 44], iconAnchor: anchor, tooltipAnchor: [x, y] }));
            target.setIcon(L.divIcon({ className: "route-map-target", iconSize: [44, 44], iconAnchor: anchor, tooltipAnchor: [x, y] }));
            const tooltip = stopLayers.getTooltip();
            if (tooltip) { tooltip.options.direction = direction; tooltip.update(); }
          } });
        });

        if (showContext) {
          routeContextSuggestions.forEach((stop) => {
            if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
            marks.push({ lat: stop.lat!, lng: stop.lng!, radius: DOT_RADIUS });
            const dot = L.circleMarker([stop.lat!, stop.lng!], {
              className: "route-map-dot",
              radius: 5,
              color: ROUTE_COLOR,
              weight: 1.5,
              fillColor: "#fffaf3",
              fillOpacity: 0.25,
              opacity: 0.7,
            });
            if (stop.name) dot.bindTooltip(safeTooltip(stop.name));
            layer.addLayer(dot);
          });
        }
      } else {
        // No route exists: these are CANDIDATES, not an itinerary. No connecting
        // arc, no sequence numbers — plain dots only, so nothing on the map can
        // be mistaken for a walking order Parranda never claimed.
        drawableAreas.forEach((area) => {
          marks.push({ lat: area.center!.lat, lng: area.center!.lng, avoidControls: false });
          (area.stops ?? []).forEach((stop) => {
            if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
            marks.push({ lat: stop.lat, lng: stop.lng, radius: DOT_RADIUS });
            const dot = L.circleMarker([stop.lat, stop.lng], { className: "route-map-candidate", radius: 5, color: ROUTE_COLOR, weight: 2, fillColor: "#fffaf3", fillOpacity: 0.95 });
            if (stop.name) dot.bindTooltip(safeTooltip(stop.name));
            layer.addLayer(dot);
          });
        });
      }
      marksRef.current = marks;
      map.invalidateSize();
      fitToControls(leafletRef.current, frameRef.current, mapRef.current, marks);
      layoutRef.current();
      setMapDrawn(true);
    }
    draw();
    return () => {
      cancelled = true;
    };
  }, [areas, primaryRoute, hasPrimaryRoute, routeStops, routeContextSuggestions, showContext, sketch]);

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
      leafletRef.current?.map.invalidateSize({ pan: false });
      fitToControls(leafletRef.current, frameRef.current, mapRef.current, marksRef.current);
      layoutRef.current();
    };
    const schedule = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(refit);
    };
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
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    },
    [],
  );

  return (
    <>
    <div ref={frameRef} className={`relative w-full overflow-hidden rounded-parranda border border-parranda-ink/10 transition-all ${heightClass}`}>
      {/* Screen layout keeps each numbered touch footprint independently visible. */}
      <div ref={mapRef} className="h-full w-full" />
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
    {layoutCrowded && <p role="status" className="mt-1 text-xs text-parranda-ink/68">{t("Kartan är trång — förstora eller zooma för att skilja alla stoppnummer åt.", "The map is crowded — expand or zoom to separate all stop numbers.")}</p>}
    </>
  );
}
