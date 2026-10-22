/**
 * What a modal needs to keep keyboard and screen-reader focus inside it.
 *
 * A selector alone is not a tab order: it missed `<summary>` (the Live sheet's
 * last control) and counted links hidden inside a closed `<details>`, so the
 * wrap never fired and Tab walked out behind the sheet. `tabbableWithin` keeps
 * only what Tab can actually reach; `inertOutside` takes the rest of the page
 * out of reach while the modal is open, so nothing behind it can take focus or
 * be read even if the wrap is bypassed (a screen reader's own navigation).
 */

const CANDIDATES = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "iframe",
  "[tabindex]",
  '[contenteditable="true"]',
].join(", ");

// Hidden by the DOM itself: `hidden`, `inert`, or inside a closed <details>
// other than that details' own summary. Works without layout (jsdom).
function hiddenByDom(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden || node.hasAttribute("inert")) return true;
    const parent = node.parentElement;
    if (parent && parent.tagName === "DETAILS" && !parent.open) {
      const ownSummary = Array.from(parent.children).find((child) => child.tagName === "SUMMARY");
      if (node !== ownSummary) return true;
    }
  }
  return false;
}

/** Elements Tab can reach inside `root`, in document order. */
export function tabbableWithin(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(CANDIDATES)).filter((element) => {
    if (element.matches(":disabled")) return false;
    if (element.matches('input[type="hidden"]')) return false;
    const tabindex = element.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) < 0) return false;
    if (element.tagName === "SUMMARY" && element.parentElement?.tagName !== "DETAILS") return false;
    if (hiddenByDom(element)) return false;
    // Layout-aware check where the browser has one (display: none, skipped content).
    if (typeof element.checkVisibility === "function" && !element.checkVisibility({ visibilityProperty: true })) return false;
    return true;
  });
}

/**
 * Makes every element outside `container` inert, up to <body>, and returns the
 * undo. Pass the modal's outermost layer (dialog plus its backdrop), so the
 * backdrop still closes it. Elements that were already inert are left alone.
 */
export function inertOutside(container) {
  const changed = [];
  const body = container?.ownerDocument?.body;
  for (let node = container; node && node !== body && node.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute("inert")) continue;
      if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE") continue;
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
  }
  return () => {
    for (const element of changed) element.removeAttribute("inert");
  };
}
