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
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { routeMarkerPresentation } from "../../lib/route-map-presentation.mjs";
import type { RouteContextSuggestion } from "../../lib/route-context-view.mjs";
import { CollapseIcon, ExpandIcon } from "../shared/icons";
import type { DistrictArea } from "./types";
import type { Translate } from "./copy";

const ROUTE_COLOR = "#b6582f";

function safeTooltip(name: string): string {
  const safe = document.createElement("div");
  safe.textContent = name;
  return safe.innerHTML;
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
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{ map: any; layer: any } | null>(null);
  const [mapDrawn, setMapDrawn] = useState(false);

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
        leafletRef.current = { map, layer: L.layerGroup().addTo(map) };
      }
      const { map, layer } = leafletRef.current;
      layer.clearLayers();

      const bounds: Array<[number, number]> = [];
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
                ? { color: ROUTE_COLOR, weight: 3.5, opacity: 0.9, dashArray: "1 9", lineCap: "round" }
                : { color: ROUTE_COLOR, weight: 4, opacity: 0.92 },
            ),
          );
          routePath.forEach((point: [number, number]) => bounds.push(point));
        }

        const markerPresentation = routeMarkerPresentation(routeStops);
        routeStops.forEach((stop: any, index: number) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          bounds.push([stop.lat, stop.lng]);
          const presentation = markerPresentation[index];
          const eventClass = stop.is_live_event === true ? " route-map-marker--event" : "";
          const clusteredClass = presentation?.clustered ? " route-map-marker-shell--clustered" : "";
          const shiftX = Number(presentation?.shift_x_px) || 0;
          const shiftY = Number(presentation?.shift_y_px) || 0;
          const icon = L.divIcon({
            className: `route-map-marker-shell${clusteredClass}`,
            html: `<span class="route-map-marker${eventClass}" style="--route-marker-x:${shiftX}px;--route-marker-y:${shiftY}px">${index + 1}</span>`,
            iconSize: [72, 72],
            iconAnchor: [36, 36],
          });
          const marker = L.marker([stop.lat, stop.lng], { icon, zIndexOffset: 1200 + index });
          const markerName = String(stop.label || stop.name || "").trim();
          if (markerName) marker.bindTooltip(safeTooltip(markerName));
          layer.addLayer(marker);
        });

        if (showContext) {
          routeContextSuggestions.forEach((stop) => {
            if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
            bounds.push([stop.lat!, stop.lng!]);
            const dot = L.circleMarker([stop.lat!, stop.lng!], {
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
          bounds.push([area.center!.lat, area.center!.lng]);
          (area.stops ?? []).forEach((stop) => {
            if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
            bounds.push([stop.lat, stop.lng]);
            const dot = L.circleMarker([stop.lat, stop.lng], { radius: 5, color: ROUTE_COLOR, weight: 2, fillColor: "#fffaf3", fillOpacity: 0.95 });
            if (stop.name) dot.bindTooltip(safeTooltip(stop.name));
            layer.addLayer(dot);
          });
        });
      }
      map.invalidateSize();
      if (bounds.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      setMapDrawn(true);
    }
    draw();
    return () => {
      cancelled = true;
    };
  }, [areas, primaryRoute, hasPrimaryRoute, routeStops, routeContextSuggestions, showContext, sketch]);

  // Leaflet does not observe container resizes — after the expand/collapse
  // transition settles, tell it the viewport changed.
  useEffect(() => {
    const timer = setTimeout(() => leafletRef.current?.map.invalidateSize(), 250);
    return () => clearTimeout(timer);
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
    <div className={`relative w-full overflow-hidden rounded-parranda border border-parranda-ink/10 transition-all ${heightClass}`}>
      <div ref={mapRef} className="h-full w-full" />
      {!mapDrawn && (
        <div className="absolute inset-0 flex items-center justify-center bg-parranda-ink/10 text-sm text-parranda-ink/60">
          {t("Ritar kartan …", "Drawing the map …")}
        </div>
      )}
      {onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={mapExpanded}
          className="absolute right-2.5 top-2.5 z-[1001] inline-flex min-h-11 items-center gap-1.5 rounded-full border border-parranda-ink/20 bg-parranda-paper/90 px-3.5 text-xs font-bold text-parranda-ink/85 shadow-sm backdrop-blur-sm transition hover:border-parranda-ember"
        >
          {mapExpanded ? t("Förminska kartan", "Shrink map") : t("Förstora kartan", "Expand map")}
          {mapExpanded ? <CollapseIcon className="h-3.5 w-3.5" /> : <ExpandIcon className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
