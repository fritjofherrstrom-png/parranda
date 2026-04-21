function slugifyText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const areaMacroByToken = {
  trastevere: "west",
  gianicolo: "west",
  prati: "west",
  borgo: "west",
  centro: "center",
  ghetto: "center",
  monti: "center",
  celio: "center",
  colosseum: "center",
  colosseo: "center",
  navona: "center",
  campo: "center",
  sallustiano: "center",
  "villa-borghese": "center",
  testaccio: "south",
  ostiense: "south",
  aventino: "south",
  garbatella: "south",
  portuense: "south",
  marconi: "south",
  piramide: "south",
  pigneto: "east",
  "san-lorenzo": "east",
  esquilino: "east",
  "san-giovanni": "east",
  laterano: "east",
  termini: "east",
};

function extractAreaTokens(...values) {
  const flattenedValues = values.flat().filter(Boolean);
  const tokens = new Set();

  flattenedValues.map(slugifyText).forEach((text) => {
    Object.keys(areaMacroByToken).forEach((token) => {
      if (text.includes(token)) {
        tokens.add(token);
      }
    });
  });

  return tokens;
}

function overlapRatio(setA, setB) {
  if (!setA.size || !setB.size) {
    return 0;
  }

  const intersection = [...setA].filter((value) => setB.has(value)).length;
  return intersection / Math.min(setA.size, setB.size);
}

function buildRouteProfile(route) {
  const stopIds = new Set((route.main_stops || []).map((stop) => stop.id).filter(Boolean));
  const areaTokens = extractAreaTokens(
    (route.main_stops || []).map((stop) => [stop.area, stop.cluster_token]).flat(),
    route.anchor_zone,
    route.start_label,
    route.end_label,
  );
  const macros = new Set([...areaTokens].map((token) => areaMacroByToken[token]).filter(Boolean));
  const mentionTokens = new Set(
    [...(route.hidden_mentions || []), ...(route.bar_mentions || [])]
      .map(slugifyText)
      .filter(Boolean),
  );

  return {
    stopIds,
    areaTokens,
    macros,
    mentionTokens,
    shape: route.route_shape || null,
    anchorZone: slugifyText(route.anchor_zone),
    startLabel: slugifyText(route.start_label),
    endLabel: slugifyText(route.end_label),
  };
}

function routeSimilarity(routeA, routeB) {
  if (!routeA || !routeB) {
    return 0;
  }

  const profileA = buildRouteProfile(routeA);
  const profileB = buildRouteProfile(routeB);
  const stopOverlap = overlapRatio(profileA.stopIds, profileB.stopIds);
  const areaOverlap = overlapRatio(profileA.areaTokens, profileB.areaTokens);
  const macroOverlap = overlapRatio(profileA.macros, profileB.macros);
  const mentionOverlap = overlapRatio(profileA.mentionTokens, profileB.mentionTokens);
  const sameShape = profileA.shape && profileA.shape === profileB.shape ? 1 : 0;
  const sameAnchor = profileA.anchorZone && profileA.anchorZone === profileB.anchorZone ? 1 : 0;
  const sameStart = profileA.startLabel && profileA.startLabel === profileB.startLabel ? 1 : 0;
  const sameEnd = profileA.endLabel && profileA.endLabel === profileB.endLabel ? 1 : 0;

  return (
    stopOverlap * 9.5 +
    areaOverlap * 7.5 +
    macroOverlap * 4 +
    mentionOverlap * 2.5 +
    sameShape * 1 +
    sameAnchor * 2.8 +
    sameStart * 1.2 +
    sameEnd * 1.2
  );
}

function routeNoveltyScore(route, usedRoutes = []) {
  if (!route || !usedRoutes.length) {
    return 0;
  }

  const current = buildRouteProfile(route);
  const usedAreaTokens = new Set();
  const usedMacros = new Set();
  const usedAnchors = new Set();
  const usedStarts = new Set();
  const usedEnds = new Set();

  usedRoutes.forEach((usedRoute) => {
    const profile = buildRouteProfile(usedRoute);
    profile.areaTokens.forEach((token) => usedAreaTokens.add(token));
    profile.macros.forEach((macro) => usedMacros.add(macro));
    if (profile.anchorZone) {
      usedAnchors.add(profile.anchorZone);
    }
    if (profile.startLabel) {
      usedStarts.add(profile.startLabel);
    }
    if (profile.endLabel) {
      usedEnds.add(profile.endLabel);
    }
  });

  let score = 0;
  const newAreaTokens = [...current.areaTokens].filter((token) => !usedAreaTokens.has(token)).length;
  const newMacros = [...current.macros].filter((macro) => !usedMacros.has(macro)).length;

  if (newAreaTokens > 0) {
    score += Math.min(4.5, newAreaTokens * 1.4);
  } else {
    score -= 2.6;
  }

  if (newMacros > 0) {
    score += Math.min(2.8, newMacros * 1.2);
  } else {
    score -= 1.4;
  }

  if (current.anchorZone && !usedAnchors.has(current.anchorZone)) {
    score += 2.2;
  } else {
    score -= 1.2;
  }

  if (current.startLabel && !usedStarts.has(current.startLabel)) {
    score += 1;
  }

  if (current.endLabel && !usedEnds.has(current.endLabel)) {
    score += 1;
  }

  return Number(score.toFixed(1));
}

function relabelLiveEvents(liveEvents = [], orderedRoutes = []) {
  const labelById = new Map();

  if (orderedRoutes[0]) {
    labelById.set(orderedRoutes[0].id, {
      label: "Huvudrutten",
      title: orderedRoutes[0].title,
    });
  }

  orderedRoutes.slice(1).forEach((route, index) => {
    labelById.set(route.id, {
      label: `Alternativ ${index + 1}`,
      title: route.title,
    });
  });

  return liveEvents.map((event) => {
    const replacement = labelById.get(event.best_route_id);

    if (!replacement) {
      return event;
    }

    return {
      ...event,
      best_route_label: replacement.label,
      best_route_title: replacement.title,
    };
  });
}

function chooseBestPrimaryRoute(day, usedRoutes = []) {
  if (!day?.primary_route || !Array.isArray(day.alternatives) || !day.alternatives.length) {
    return day;
  }

  const candidates = [day.primary_route, ...day.alternatives];
  const scoredCandidates = candidates.map((route, index) => {
    const crossDayPenalty = usedRoutes.reduce((sum, usedRoute, usedIndex) => {
      const recencyWeight = 1.3 - Math.min(usedIndex, 3) * 0.12;
      return sum + routeSimilarity(route, usedRoute) * recencyWeight;
    }, 0);
    const noveltyBoost = routeNoveltyScore(route, usedRoutes);
    const positionPenalty = index === 0 ? 0 : index * 1.1;

    return {
      index,
      route,
      score: Number((noveltyBoost - crossDayPenalty - positionPenalty).toFixed(1)),
    };
  });

  const currentPrimary = scoredCandidates[0];
  const best = [...scoredCandidates].sort((left, right) => right.score - left.score)[0];

  if (!best || best.index === 0) {
    return day;
  }

  if (best.score < currentPrimary.score + 2.2) {
    return day;
  }

  const orderedRoutes = [best.route, ...candidates.filter((_, index) => index !== best.index)];

  return {
    ...day,
    primary_route: orderedRoutes[0],
    alternatives: orderedRoutes.slice(1),
    live_events: relabelLiveEvents(day.live_events || [], orderedRoutes),
  };
}

function diversifyRecommendationDays(result) {
  if (!result || !Array.isArray(result.days) || result.days.length < 2) {
    return result;
  }

  const usedPrimaryRoutes = [];
  const days = result.days.map((day) => {
    const diversifiedDay = chooseBestPrimaryRoute(day, usedPrimaryRoutes);

    if (diversifiedDay?.primary_route) {
      usedPrimaryRoutes.push(diversifiedDay.primary_route);
    }

    return diversifiedDay;
  });

  return {
    ...result,
    days,
  };
}

module.exports = {
  diversifyRecommendationDays,
  routeSimilarity,
};
