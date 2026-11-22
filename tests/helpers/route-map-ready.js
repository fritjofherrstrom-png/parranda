'use strict';

// A drawn marker is not yet a settled layout: ResizeObserver queues a refit on
// the next frame, including when the attribution removes the provisional legend.
// Scroll FIRST, then wait for fonts, finite CSS transitions and three identical
// rendered layouts. This is a pre-interaction barrier, never a post-tap rebaseline.
async function waitForRouteMapLayout(route) {
  await route.evaluate(async root => {
    const frame = root.matches('[data-route-map]') ? root : root.querySelector('[data-route-map]');
    if (!frame) throw new Error('No route map frame');
    const container = frame.querySelector('.maplibregl-map');
    if (!container) throw new Error('No drawn route map');
    container.scrollIntoView({block:'center',behavior:'instant'});
    await document.fonts.ready;
    const deadline=performance.now()+5000;
    let previous, stable=0;
    while(performance.now()<deadline) {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const pending=frame.getAnimations({subtree:true}).some(animation=>
        ['running','pending'].includes(animation.playState) && animation.effect?.getComputedTiming().iterations!==Infinity);
      const rect=element=>{const r=element.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
      const snapshot=JSON.stringify([rect(frame),...Array.from(frame.querySelectorAll('.maplibregl-map, .maplibregl-ctrl, [data-map-control], .route-map-marker'),rect)]);
      stable=!pending&&snapshot===previous?stable+1:0;
      previous=snapshot;
      if(stable>=3) return;
    }
    throw new Error('Route map layout did not settle before interaction');
  });
}
module.exports={waitForRouteMapLayout};
