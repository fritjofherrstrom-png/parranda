const routeTemplates = [];
const allItems = [];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function findItemByName(name) {
  const normalized = normalize(name);
  if (!normalized) return null;
  return (
    allItems.find((item) => normalize(item.name) === normalized) ||
    allItems.find((item) => (item.searchTerms || []).some((term) => normalize(term) === normalized)) ||
    null
  );
}

module.exports = {
  routeTemplates,
  allItems,
  findItemByName,
};
