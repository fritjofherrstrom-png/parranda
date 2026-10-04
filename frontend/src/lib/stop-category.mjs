/**
 * Which FAMILY a stop's kind belongs to, so its category reads at a glance.
 *
 * The family only chooses the small symbol beside the category text; the text
 * itself stays the stop's own localized kind ("Restaurant", "Gallery", "Park").
 * Unknown kinds have no family and get no symbol — never a guessed one.
 */
const FAMILY_BY_TYPE = {
  restaurant: "food", cafe: "food", bakery: "food", "street-food": "food", pizza: "food", taverna: "food",
  bar: "drink", "wine-bar": "drink", "cocktail-bar": "drink", "rooftop-bar": "drink", "cafe-bar": "drink",
  museum: "culture", gallery: "culture", theatre: "culture", cinema: "culture", library: "culture",
  music: "culture", "cultural-venue": "culture",
  park: "nature", garden: "nature", beach: "nature", promenade: "nature",
  viewpoint: "sight", landmark: "sight", monument: "sight", castle: "sight", "historic-site": "sight",
  church: "sight", lighthouse: "sight", bridge: "sight", square: "sight", street: "sight", cemetery: "sight",
  shop: "shop", bookshop: "shop", "vintage-shop": "shop", market: "shop", event_market: "shop",
};

export const STOP_CATEGORY_FAMILIES = ["food", "drink", "culture", "nature", "sight", "shop"];

export function stopCategoryFamily(type) {
  return FAMILY_BY_TYPE[String(type || "")] || null;
}
