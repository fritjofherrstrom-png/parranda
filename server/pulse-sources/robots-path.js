"use strict";

// Bounded glob matching without a backtracking regular expression. Robots
// wildcard/end rules must also protect followed and redirected detail paths.
function matchesRobotsPath(rule, path) {
  const end = rule.endsWith("$");
  const parts = (end ? rule.slice(0, -1) : rule).split("*");
  if (!path.startsWith(parts[0])) return false;
  let cursor = parts[0].length;
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    if (end && index === parts.length - 1) return path.endsWith(part) && path.length - part.length >= cursor;
    const found = path.indexOf(part, cursor);
    if (found < 0) return false;
    cursor = found + part.length;
  }
  return !end || cursor === path.length;
}


module.exports = { matchesRobotsPath };
