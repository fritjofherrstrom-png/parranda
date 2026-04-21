function normalizeDayIntensity(value) {
  if (value === "light" || value === "dense") {
    return value;
  }

  return "normal";
}

function routeIntensityMetrics(route) {
  const stopCount = Array.isArray(route?.main_stops) ? route.main_stops.length : 0;
  const estimatedKm = Number(route?.estimated_km || 0);
  const longestLegKm = Number(route?.longest_leg_km || 0);
  const averageLegMinutes = Number(route?.average_leg_minutes || 0);
  const liveBonus = route?.live_event_fit_note ? 1 : 0;
  const pulseBonus = route?.pulse_note ? 1 : 0;
  const specialCount = Array.isArray(route?.venue_specials) ? route.venue_specials.length : 0;
  const stopDensity = estimatedKm > 0 ? stopCount / estimatedKm : 0;

  return {
    stopCount,
    estimatedKm,
    longestLegKm,
    averageLegMinutes,
    liveBonus,
    pulseBonus,
    specialCount,
    stopDensity,
    isLoop: route?.route_shape === "loop",
  };
}

function lightIntensityScore(route) {
  const metrics = routeIntensityMetrics(route);

  return Number(
    (
      22 -
      metrics.stopCount * 3.35 -
      metrics.estimatedKm * 0.45 -
      metrics.longestLegKm * 1.5 -
      metrics.averageLegMinutes * 0.03 -
      metrics.specialCount * 0.3 +
      (metrics.isLoop ? 1 : 0) * 1.2 +
      (metrics.estimatedKm <= 8 ? 1.4 : 0) +
      (metrics.stopCount <= 4 ? 1.6 : 0)
    ).toFixed(1),
  );
}

function denseIntensityScore(route) {
  const metrics = routeIntensityMetrics(route);
  const healthyKmBonus = metrics.estimatedKm >= 5.5 && metrics.estimatedKm <= 10.5 ? 1.4 : 0;

  return Number(
    (
      metrics.stopCount * 3.2 +
      metrics.stopDensity * 7.2 +
      metrics.liveBonus * 1.1 +
      metrics.pulseBonus * 0.7 +
      metrics.specialCount * 0.45 +
      healthyKmBonus -
      metrics.longestLegKm * 1.05 -
      Math.max(0, 5 - metrics.stopCount) * 1.9
    ).toFixed(1),
  );
}

function normalIntensityScore(route) {
  const metrics = routeIntensityMetrics(route);
  const targetDensityPenalty = Math.abs(metrics.stopDensity - 0.56) * 6;

  return Number(
    (
      16 -
      targetDensityPenalty -
      Math.abs(metrics.stopCount - 4.8) * 1.4 -
      metrics.longestLegKm * 0.95 +
      (metrics.liveBonus + metrics.pulseBonus) * 0.35
    ).toFixed(1),
  );
}

function scoreRouteForIntensity(route, intensity) {
  const normalized = normalizeDayIntensity(intensity);

  if (normalized === "light") {
    return lightIntensityScore(route);
  }

  if (normalized === "dense") {
    return denseIntensityScore(route);
  }

  return normalIntensityScore(route);
}

function buildIntensityNote(intensity, route) {
  const metrics = routeIntensityMetrics(route);

  if (intensity === "light") {
    return `Intensitet: lugn. Den här versionen håller dagen mjukare med ${metrics.stopCount} tydliga stopp och mindre packat tempo.`;
  }

  if (intensity === "dense") {
    return `Intensitet: tät. Den här versionen pressar upp innehållet till ${metrics.stopCount} stopp utan att låta benen dra iväg för mycket.`;
  }

  return `Intensitet: normal. Den här versionen håller en mer balanserad rytm mellan stopp, benlängd och kvällsenergi.`;
}

function annotatePrimaryRoute(route, intensity) {
  if (!route) {
    return route;
  }

  const note = buildIntensityNote(intensity, route);
  const currentWhy = String(route.why_recommended || "").trim();

  return {
    ...route,
    intensity_mode: normalizeDayIntensity(intensity),
    intensity_fit_note: note,
    why_recommended: currentWhy ? `${currentWhy} ${note}` : note,
  };
}

function orderRoutesByIntensity(candidates, intensity) {
  return [...candidates].sort((left, right) => {
    const leftScore = scoreRouteForIntensity(left, intensity);
    const rightScore = scoreRouteForIntensity(right, intensity);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return Number(right.estimated_km || 0) - Number(left.estimated_km || 0);
  });
}

function applyDayIntensity(result, intensity = "normal") {
  const normalized = normalizeDayIntensity(intensity);

  if (normalized === "normal" || !result || !Array.isArray(result.days) || !result.days.length) {
    return result;
  }

  return {
    ...result,
    days: result.days.map((day) => {
      if (!day?.primary_route) {
        return day;
      }

      const candidates = [day.primary_route, ...(Array.isArray(day.alternatives) ? day.alternatives : [])];
      const ordered = orderRoutesByIntensity(candidates, normalized);
      const currentPrimaryScore = scoreRouteForIntensity(day.primary_route, normalized);
      const bestScore = scoreRouteForIntensity(ordered[0], normalized);
      const shouldPromote = bestScore >= currentPrimaryScore + 0.75;
      const finalPrimary = shouldPromote ? ordered[0] : day.primary_route;
      const remaining = shouldPromote
        ? ordered.slice(1)
        : orderRoutesByIntensity(
            candidates.filter((route) => route.id !== day.primary_route.id),
            normalized,
          );

      return {
        ...day,
        primary_route: annotatePrimaryRoute(finalPrimary, normalized),
        alternatives: remaining,
      };
    }),
  };
}

module.exports = {
  applyDayIntensity,
  normalizeDayIntensity,
  scoreRouteForIntensity,
};
