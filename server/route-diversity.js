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
  const mentionTokens = new Set(
    [...(route.hidden_mentions || []), ...(route.bar_mentions || [])]
      .map(slugifyText)
      .filter(Boolean),
  );
  const macroCounts = new Map();

  areaTokens.forEach((token) => {
    const macro = areaMacroByToken[token];
    if (!macro) {
      return;
    }
    macroCounts.set(macro, (macroCounts.get(macro) || 0) + 1);
  });

  const macros = new Set([...macroCounts.keys()]);
  const dominantMacro =
    [...macroCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;

  return {
    stopIds,
    areaTokens,
    macros,
    dominantMacro,
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
  const sameDominantMacro =
    profileA.dominantMacro && profileA.dominantMacro === profileB.dominantMacro ? 1 : 0;

  return Number(
    (
      stopOverlap * 10 +
      areaOverlap * 8.2 +
      macroOverlap * 4.8 +
      mentionOverlap * 2.6 +
      sameShape * 1.1 +
      sameAnchor * 3.2 +
      sameStart * 1.5 +
      sameEnd * 1.5 +
      sameDominantMacro * 1.8
    ).toFixed(1),
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
    score += Math.min(5.5, newAreaTokens * 1.5);
  } else {
    score -= 3.2;
  }

  if (newMacros > 0) {
    score += Math.min(3.2, newMacros * 1.35);
  } else {
    score -= 1.8;
  }

  if (current.anchorZone && !usedAnchors.has(current.anchorZone)) {
    score += 2.4;
  } else {
    score -= 1.5;
  }

  if (current.startLabel && !usedStarts.has(current.startLabel)) {
    score += 1.1;
  }

  if (current.endLabel && !usedEnds.has(current.endLabel)) {
    score += 1.1;
  }

  return Number(score.toFixed(1));
}

function buildRepeatPressure(route, usedRoutes = []) {
  if (!route || !usedRoutes.length) {
    return {
      maxSimilarity: 0,
      averageSimilarity: 0,
      repeatedAnchorCount: 0,
      repeatedMacroCount: 0,
      repeatedStartCount: 0,
      repeatedEndCount: 0,
    };
  }

  const current = buildRouteProfile(route);
  const similarities = usedRoutes.map((usedRoute) => routeSimilarity(route, usedRoute));
  const anchorMatches = usedRoutes.filter(
    (usedRoute) => buildRouteProfile(usedRoute).anchorZone === current.anchorZone,
  ).length;
  const macroMatches = usedRoutes.filter(
    (usedRoute) => buildRouteProfile(usedRoute).dominantMacro === current.dominantMacro,
  ).length;
  const startMatches = usedRoutes.filter(
    (usedRoute) => buildRouteProfile(usedRoute).startLabel === current.startLabel,
  ).length;
  const endMatches = usedRoutes.filter(
    (usedRoute) => buildRouteProfile(usedRoute).endLabel === current.endLabel,
  ).length;

  return {
    maxSimilarity: Math.max(...similarities, 0),
    averageSimilarity: similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
    repeatedAnchorCount: anchorMatches,
    repeatedMacroCount: macroMatches,
    repeatedStartCount: startMatches,
    repeatedEndCount: endMatches,
  };
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

function scoreAlternativeForPosition(route, primaryRoute, alreadyOrdered = [], usedRoutes = []) {
  const usedPool = [primaryRoute, ...alreadyOrdered, ...usedRoutes].filter(Boolean);
  const novelty = routeNoveltyScore(route, usedPool);
  const similarityPenalty = usedPool.reduce((sum, usedRoute) => {
    return sum + routeSimilarity(route, usedRoute) * (usedRoute === primaryRoute ? 1.2 : 0.75);
  }, 0);

  return Number((novelty - similarityPenalty).toFixed(1));
}

function orderAlternatives(primaryRoute, alternatives = [], usedRoutes = []) {
  const remaining = [...alternatives];
  const ordered = [];

  while (remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((route, index) => {
      const score = scoreAlternativeForPosition(route, primaryRoute, ordered, usedRoutes);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
  }

  return ordered;
}

function chooseBestPrimaryRoute(day, usedRoutes = []) {
  if (!day?.primary_route || !Array.isArray(day.alternatives) || !day.alternatives.length) {
    return day;
  }

  const candidates = [day.primary_route, ...day.alternatives];
  const scoredCandidates = candidates.map((route, index) => {
    const repeatPressure = buildRepeatPressure(route, usedRoutes);
    const noveltyBoost = routeNoveltyScore(route, usedRoutes);
    const positionPenalty = index === 0 ? 0 : index * 0.55;
    const score =
      noveltyBoost -
      repeatPressure.maxSimilarity * 1.15 -
      repeatPressure.averageSimilarity * 0.45 -
      repeatPressure.repeatedAnchorCount * 2.4 -
      repeatPressure.repeatedMacroCount * 1.7 -
      repeatPressure.repeatedStartCount * 0.8 -
      repeatPressure.repeatedEndCount * 0.8 -
      positionPenalty;

    return {
      index,
      route,
      score: Number(score.toFixed(1)),
      ...repeatPressure,
      noveltyBoost,
    };
  });

  const currentPrimary = scoredCandidates[0];
  const best = [...scoredCandidates].sort((left, right) => right.score - left.score)[0];

  let orderedRoutes = candidates;

  if (best && best.index !== 0) {
    const clearlyBetter = best.score >= currentPrimary.score + 0.6;
    const currentTooSimilar = currentPrimary.maxSimilarity >= 11.5;
    const betterAnchorMix =
      currentPrimary.repeatedAnchorCount > 0 && best.repeatedAnchorCount < currentPrimary.repeatedAnchorCount;
    const betterMacroMix =
      currentPrimary.repeatedMacroCount > 0 && best.repeatedMacroCount < currentPrimary.repeatedMacroCount;

    if (
      clearlyBetter ||
      (currentTooSimilar && best.score >= currentPrimary.score - 1.5) ||
      ((betterAnchorMix || betterMacroMix) && best.score >= currentPrimary.score - 1)
    ) {
      orderedRoutes = [best.route, ...candidates.filter((_, index) => index !== best.index)];
    }
  }

  const primaryRoute = orderedRoutes[0];
  const alternatives = orderAlternatives(primaryRoute, orderedRoutes.slice(1), usedRoutes);
  const finalRoutes = [primaryRoute, ...alternatives];

  return {
    ...day,
    primary_route: finalRoutes[0],
    alternatives: finalRoutes.slice(1),
    live_events: relabelLiveEvents(day.live_events || [], finalRoutes),
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
