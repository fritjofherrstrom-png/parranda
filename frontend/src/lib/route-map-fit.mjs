/**
 * Where the planner's map puts the day, so that no route marker sits under the
 * map's own controls: Leaflet's zoom buttons and attribution, and the expand
 * button Parranda lays over the map.
 *
 * Leaflet's fitBounds pads the bounds by one rectangle and centres them. It
 * knows nothing about what sits in the map's corners, nor about the display
 * offset a clustered marker is drawn with (route-map-presentation.mjs), so on a
 * phone a day's outermost stop could land under a control. This chooses the
 * view itself:
 *
 *   - every control is a keep-out rectangle, measured by the caller;
 *   - each keep-out is cleared along one side — from beside it, or from below
 *     or above it — which turns the controls into an asymmetric padding (a
 *     paddingTopLeft and a paddingBottomRight). Every combination is tried and
 *     the one that allows the closest zoom wins, so a wide day clears a
 *     top-right button from below and a tall day from beside it;
 *   - a mark fits with its whole footprint at the position it is DRAWN at (its
 *     coordinate plus any display offset), not just at its coordinate;
 *   - marks that need not avoid the controls (the route line's own points) only
 *     have to stay on the map: a line may pass under a control, a stop may not.
 *
 * Presentation only: which marks exist, their order and their coordinates are
 * the caller's. Pure: the caller measures the container and the controls and
 * passes the map's own projection, so nothing here touches Leaflet or the DOM.
 */

const SIDES = ["left", "top", "right", "bottom"];

function finite(...values) {
  return values.every(Number.isFinite);
}

function isBox(box, width, height) {
  return (
    box &&
    finite(box.left, box.top, box.right, box.bottom) &&
    box.right > box.left &&
    box.bottom > box.top &&
    // Only a control over the map can hide a mark.
    box.right > 0 &&
    box.bottom > 0 &&
    box.left < width &&
    box.top < height
  );
}

/**
 * Every padding that clears each keep-out along one of its sides. A padding is
 * the distance from each map edge that a mark's footprint must stay within.
 */
export function paddingOptions({ width, height, keepouts = [], edge = 0, gap = 0 }) {
  let options = [{ top: edge, right: edge, bottom: edge, left: edge }];
  for (const box of keepouts.filter((candidate) => isBox(candidate, width, height))) {
    const next = new Map();
    for (const padding of options) {
      for (const side of SIDES) {
        const cleared = { ...padding };
        if (side === "left") cleared.left = Math.max(cleared.left, box.right + gap);
        else if (side === "top") cleared.top = Math.max(cleared.top, box.bottom + gap);
        else if (side === "right") cleared.right = Math.max(cleared.right, width - box.left + gap);
        else cleared.bottom = Math.max(cleared.bottom, height - box.top + gap);
        if (cleared.left + cleared.right >= width || cleared.top + cleared.bottom >= height) continue;
        next.set(`${cleared.top},${cleared.right},${cleared.bottom},${cleared.left}`, cleared);
      }
    }
    // A padding at least as deep on every side as another can never fit better.
    const candidates = [...next.values()];
    options = candidates.filter(
      (padding) =>
        !candidates.some(
          (other) =>
            other !== padding &&
            SIDES.every((side) => other[side] <= padding[side]) &&
            SIDES.some((side) => other[side] < padding[side]),
        ),
    );
  }
  return options;
}

/**
 * The view (centre and zoom) that shows every mark, at the closest zoom where
 * each mark that avoids the controls clears all of them.
 *
 * @param {object} input
 * @param {Array<{lat: number, lng: number, radius?: number, offsetX?: number, offsetY?: number, avoidControls?: boolean}>} input.marks
 *   `radius` is the mark's footprint in px around the position it is drawn at,
 *   `offsetX`/`offsetY` its display offset from its coordinate in px.
 * @param {number} input.width  map container width in px
 * @param {number} input.height map container height in px
 * @param {Array<{left: number, top: number, right: number, bottom: number}>} [input.keepouts]
 *   the controls, in px relative to the map container
 * @param {number} [input.edge] minimum distance from a footprint to the map edge
 * @param {number} [input.gap] minimum distance from a footprint to a control
 * @param {number} [input.minZoom]
 * @param {number} [input.maxZoom]
 * @param {(mark: {lat: number, lng: number}, zoom: number) => {x: number, y: number}} input.project
 *   the map's projection to world pixels at a zoom
 * @param {(point: {x: number, y: number}, zoom: number) => {lat: number, lng: number}} input.unproject
 * @returns {{center: {lat: number, lng: number}, zoom: number, padding: {top: number, right: number, bottom: number, left: number}} | null}
 *   null when there is nothing to fit, the inputs cannot be read, or no zoom
 *   fits — the caller falls back to a plain fit.
 */
export function controlAwareView({
  marks,
  width,
  height,
  keepouts = [],
  edge = 0,
  gap = 0,
  minZoom = 0,
  maxZoom = 18,
  project,
  unproject,
}) {
  if (!finite(width, height, edge, gap, minZoom, maxZoom) || width <= 0 || height <= 0) return null;
  if (typeof project !== "function" || typeof unproject !== "function") return null;
  const drawable = (Array.isArray(marks) ? marks : []).filter((mark) => finite(mark?.lat, mark?.lng));
  if (!drawable.length) return null;

  const onMap = { top: edge, right: edge, bottom: edge, left: edge };
  const options = paddingOptions({ width, height, keepouts, edge, gap });

  for (let zoom = Math.floor(maxZoom); zoom >= Math.ceil(minZoom); zoom -= 1) {
    // Each mark's footprint in world pixels at this zoom, as the extremes of
    // the two kinds: marks that avoid the controls, and marks that only stay on
    // the map. The origin (the world pixel at the container's top-left) must
    // keep every footprint inside its kind's padding.
    const extent = {
      avoid: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      stay: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    };
    for (const mark of drawable) {
      const point = project(mark, zoom);
      if (!finite(point?.x, point?.y)) return null;
      const radius = Number.isFinite(mark.radius) ? Math.max(0, mark.radius) : 0;
      const x = point.x + (Number.isFinite(mark.offsetX) ? mark.offsetX : 0);
      const y = point.y + (Number.isFinite(mark.offsetY) ? mark.offsetY : 0);
      const kind = mark.avoidControls === false ? extent.stay : extent.avoid;
      kind.minX = Math.min(kind.minX, x - radius);
      kind.maxX = Math.max(kind.maxX, x + radius);
      kind.minY = Math.min(kind.minY, y - radius);
      kind.maxY = Math.max(kind.maxY, y + radius);
    }

    let best = null;
    for (const padding of options) {
      // origin.x ≤ footprint.left − padding.left, and
      // origin.x ≥ footprint.right − (width − padding.right); likewise in y.
      const low = { x: -Infinity, y: -Infinity };
      const high = { x: Infinity, y: Infinity };
      for (const [kind, box] of [[extent.avoid, padding], [extent.stay, onMap]]) {
        if (kind.minX > kind.maxX) continue; // no marks of this kind
        high.x = Math.min(high.x, kind.minX - box.left);
        low.x = Math.max(low.x, kind.maxX - (width - box.right));
        high.y = Math.min(high.y, kind.minY - box.top);
        low.y = Math.max(low.y, kind.maxY - (height - box.bottom));
      }
      if (low.x > high.x || low.y > high.y) continue;
      // Centre the day in the room it has; at equal zoom, most room wins.
      const slack = Math.min(high.x - low.x, high.y - low.y);
      if (!best || slack > best.slack) {
        best = { slack, padding, origin: { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2 } };
      }
    }
    if (!best) continue;

    const center = unproject({ x: best.origin.x + width / 2, y: best.origin.y + height / 2 }, zoom);
    if (!finite(center?.lat, center?.lng)) return null;
    return { center: { lat: center.lat, lng: center.lng }, zoom, padding: best.padding };
  }
  return null;
}
