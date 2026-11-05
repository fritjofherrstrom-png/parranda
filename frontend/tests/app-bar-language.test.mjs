/** First-pass AppBar preservation controls for H1's tested nullable link contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const props = { lang: 'en', homeLabel: 'Parranda — home', languageLabel: 'Language' };
const control = (h, code) => [...h.container.querySelectorAll('nav [role="group"] a')].find(a => a.textContent === code);

async function appBar(t, extra = {}) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en',
    entry: 'components/shared/AppBar.tsx', props: { ...props, ...extra } });
  t.after(() => h.unmount());
  return h;
}

test('default language links retain the page query when no exact-view override is supplied', async t => {
  const h = await appBar(t);
  const sv = control(h, 'SV');
  assert.ok(sv);
  const target = new URL(sv.href);
  assert.equal(target.pathname, '/anywhere');
  assert.equal(target.searchParams.get('place'), 'Testville');
  assert.equal(target.searchParams.get('lang'), 'sv');
  assert.equal(sv.hasAttribute('aria-disabled'), false);
});

test('an explicit exact-view destination is not replaced by the page input query', async t => {
  const h = await appBar(t, { languageHref: lang => `/anywhere?view=${'a'.repeat(32)}&lang=${lang}` });
  const target = new URL(control(h, 'SV').href);
  assert.equal(target.searchParams.get('view'), 'a'.repeat(32));
  assert.equal(target.searchParams.get('lang'), 'sv');
  assert.equal(target.searchParams.has('place'), false);
});

test('an explicit null destination is disabled without cancelling the day, while home remains usable', async t => {
  const navigations = [];
  const h = await appBar(t, { languageHref: () => null, onNavigate: target => navigations.push(target) });
  h.document.addEventListener('click', event => event.preventDefault());
  const sv = control(h, 'SV');
  assert.ok(sv);
  assert.equal(sv.getAttribute('href'), null);
  assert.equal(sv.getAttribute('role'), 'link');
  assert.equal(sv.getAttribute('aria-disabled'), 'true');
  assert.equal(sv.tabIndex, -1);
  await h.act(() => sv.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  assert.deepEqual(navigations, [], 'a disabled link must not cancel the current publication');
  const home = h.container.querySelector('a[aria-label="Parranda — home"]');
  assert.equal(home.getAttribute('href'), '/?lang=en');
  await h.act(() => home.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  assert.deepEqual(navigations, ['home']);
});
