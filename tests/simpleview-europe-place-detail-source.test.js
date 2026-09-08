"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
  collectSimpleviewEuropePlaceFeed,
  createPinnedLookup,
  extractSimpleviewEuropeListItems,
  inspectSimpleviewEuropePlaceList,
} = require("../server/place-candidates/simpleview-europe-place-detail-source");
const {
  probeReviewedPlaceFeed,
} = require("../server/place-candidates/schema-org-place-source");

const LIST_URL = "https://guide.example/things-to-do/attractions";

function feed(overrides = {}) {
  return {
    id: "reviewed-guide",
    label: "Official guide",
    endpoint: LIST_URL,
    adapter: SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
    adapter_contract_revision: "simpleview-europe-product-detail-html-v2",
    bbox: [-4.3, 50.2, -3.9, 50.5],
    evidence_family: "official",
    source_tier: "official",
    source_identity: "guide.example",
    terms_status: "open_license",
    source_health: "healthy",
    runtime_policy: "bounded_refresh",
    max_items: 20,
    max_links: 20,
    max_details: 20,
    max_list_bytes: 64_000,
    max_detail_bytes: 32_000,
    max_total_bytes: 256_000,
    request_timeout_ms: 1_000,
    max_total_ms: 5_000,
    ...overrides,
  };
}

function listItem({ id, name, category, href = `/things-to-do/${id}-p${id.replace(/\D/g, "")}` }) {
  return `<li class="Item prodTypeATTR p${id.replace(/\D/g, "")}">
    <h2 class="ProductName"><a class="ProductDetail" href="${href}">${name}</a></h2>
    <div class="type"><h3>Type:</h3><p>${category}</p></div>
    <div class="loc"><p>Northport</p></div>
  </li>`;
}

function listHtml(items) {
  return `<ol class="productList">${items.join("\n")}</ol>`;
}

function detailHtml({
  id = "126153",
  name = "Harbour Aquarium",
  category = "Aquarium",
  url = `https://guide.example/things-to-do/harbour-aquarium-p${id}`,
  lat = "50.3668518066406",
  lng = "-4.13050985336304",
  address = true,
  secondObject = "",
} = {}) {
  return `<html itemscope itemtype="http://schema.org/LocalBusiness">
    <head><meta property="og:latitude" content="${lat}"><meta property="og:longitude" content="${lng}"></head>
    <body><main>
      <h1 itemprop="name">${name}</h1>
      <meta itemprop="url" content="${url}">
      <span class="category">${category}</span>
      ${address ? `<div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <meta itemprop="streetAddress" content="Rope Walk">
        <meta itemprop="addressLocality" content="Northport">
        <meta itemprop="addressRegion" content="Coastshire">
        <meta itemprop="postalCode" content="NP1 2AB">
      </div>` : ""}
      <script>NewMind.registerNameSpace("NewMind.ETWP.ProductDetails.Location")["${id}"] = { Latitude: ${Number(lat).toFixed(5)}, Longitude: ${Number(lng).toFixed(5)} };</script>
    </main>${secondObject}</body>
  </html>`;
}

function response(url, body, { status = 200, location = null, contentType = "text/html; charset=utf-8" } = {}) {
  const bytes = new TextEncoder().encode(String(body || ""));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    redirected: false,
    headers: { get: (name) => {
      const key = String(name).toLowerCase();
      if (key === "location") return location;
      if (key === "content-type") return contentType;
      return null;
    } },
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => sent
            ? { done: true }
            : (sent = true, { done: false, value: bytes }),
          cancel: async () => {},
        };
      },
    },
    text: async () => body,
  };
}

const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];

test("list records require the closed Simpleview structure and are canonicalized deduplicated and capped", () => {
  const html = listHtml([
    listItem({ id: "one126153", name: "One", category: "Aquarium", href: "/things-to-do/one-p126153?src=tracking#map" }),
    listItem({ id: "copy126153", name: "Duplicate", category: "Aquarium", href: "https://guide.example:443/things-to-do/one-p126153" }),
    listItem({ id: "two258003", name: "Two", category: "Tower" }),
    listItem({ id: "three432253", name: "Three", category: "Museum" }),
    listItem({ id: "escape999", name: "Escape", category: "Museum", href: "https://other.example/things-to-do/escape-p999" }),
    '<li><a class="ProductDetail" href="/things-to-do/unscoped-p444">Unscoped</a></li>',
  ]);
  const rows = extractSimpleviewEuropeListItems(html, feed({ max_links: 2 }));
  assert.deepEqual(rows.map((row) => row.detail_url), [
    "https://guide.example/things-to-do/one-p126153",
    "https://guide.example/things-to-do/two258003-p258003",
  ]);
  assert.deepEqual(rows.map((row) => row.product_id), ["126153", "258003"]);
});

test("the exact type block is found inside unrelated list-item wrappers", () => {
  const html = listHtml([`<li class="Item prodTypeATTR p126153">
    <div class="imageWrapper"><img alt=""></div>
    <div class="contentWrapper">
      <h2 class="ProductName"><a class="ProductDetail" href="/things-to-do/one-p126153">One</a></h2>
      <div class="type"><h3>Type:</h3><p>Aquarium</p></div>
    </div>
  </li>`]);
  assert.deepEqual(extractSimpleviewEuropeListItems(html, feed()).map((row) => row.category), ["Aquarium"]);
});

test("cross-origin detail links and redirect escapes are rejected before escape fetch", async () => {
  const requested = [];
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => {
      requested.push(url);
      if (url === LIST_URL) return response(url, listHtml([
        listItem({ id: "one126153", name: "One", category: "Aquarium" }),
        listItem({ id: "escape999", name: "Escape", category: "Museum", href: "https://other.example/things-to-do/escape-p999" }),
      ]));
      return response(url, "", { status: 302, location: "https://other.example/stolen" });
    },
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(requested, [LIST_URL, "https://guide.example/things-to-do/one126153-p126153"]);
});

test("a same-origin redirect cannot substitute a different detail identity", async () => {
  const requestedDetail = "https://guide.example/things-to-do/one126153-p126153";
  const substitutedDetail = "https://guide.example/things-to-do/two258003-p258003";
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => {
      if (url === LIST_URL) return response(url, listHtml([
        listItem({ id: "one126153", name: "One", category: "Aquarium" }),
      ]));
      if (url === requestedDetail) return response(url, "", { status: 302, location: substitutedDetail });
      return response(url, detailHtml({ name: "One", url: requestedDetail }));
    },
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.records, []);
});

test("the exact reviewed list endpoint cannot redirect into pagination", async () => {
  const requested = [];
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => {
      requested.push(url);
      if (url === LIST_URL) return response(url, "", { status: 302, location: `${LIST_URL}?page=2` });
      return response(url, listHtml([listItem({ id: "one126153", name: "One", category: "Aquarium" })]));
    },
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(requested, [LIST_URL]);
});

test("detail links stay under the reviewed list path", () => {
  const html = listHtml([
    listItem({ id: "one126153", name: "One", category: "Aquarium" }),
    listItem({ id: "escape999", name: "Escape", category: "Museum", href: "/other/escape-p999" }),
  ]);
  assert.deepEqual(extractSimpleviewEuropeListItems(html, feed()).map((item) => item.name), ["One"]);
});

test("invalid endpoint policy and source identity fail before network access", async () => {
  for (const invalidFeed of [
    feed({ endpoint: `${LIST_URL}?p=2` }),
    feed({ source_identity: "other.example" }),
    feed({ terms_status: "permission_required" }),
  ]) {
    let fetched = false;
    const outcome = await collectSimpleviewEuropePlaceFeed(invalidFeed, {
      resolveHost: publicDns,
      fetcher: async () => {
        fetched = true;
        return response(LIST_URL, "should not be fetched");
      },
    });
    assert.equal(outcome.status, "failed");
    assert.equal(fetched, false);
  }
});

test("private DNS fails before network access", async () => {
  let fetched = false;
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
    fetcher: async () => {
      fetched = true;
      return response(LIST_URL, "should not be fetched");
    },
  });
  assert.equal(outcome.status, "failed");
  assert.equal(fetched, false);
});

test("the aggregate deadline bounds stalled DNS resolution", async () => {
  const result = await Promise.race([
    collectSimpleviewEuropePlaceFeed(feed({ request_timeout_ms: 50, max_total_ms: 100 }), {
      resolveHost: async () => new Promise(() => {}),
      fetcher: async () => { throw new Error("stalled DNS must not fetch"); },
    }),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 200)),
  ]);
  assert.deepEqual(result, { status: "failed", records: [] });
});

test("the HTTPS lookup stays pinned to the already-validated public address", async () => {
  const lookup = createPinnedLookup([{ address: "8.8.8.8", family: 4 }]);
  const result = await new Promise((resolve, reject) => {
    lookup("attacker-controlled.example", {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(result, { address: "8.8.8.8", family: 4 });
  assert.equal(createPinnedLookup([{ address: "127.0.0.1", family: 4 }]), null);
});

test("non-HTML responses fail closed before parsing", async () => {
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => response(url, listHtml([
      listItem({ id: "one126153", name: "One", category: "Aquarium" }),
    ]), { contentType: "application/json" }),
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.records, []);
});

test("responses without a bounded readable body fail without calling text", async () => {
  let textCalled = false;
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/html" : null },
      text: async () => {
        textCalled = true;
        return listHtml([listItem({ id: "one126153", name: "One", category: "Aquarium" })]);
      },
    }),
  });
  assert.equal(outcome.status, "failed");
  assert.equal(textCalled, false);
});

test("request timeout covers a stalled response body, not only response headers", async () => {
  let aborted = false;
  const outcome = await collectSimpleviewEuropePlaceFeed(feed({ request_timeout_ms: 50 }), {
    resolveHost: publicDns,
    fetcher: async (_url, options) => ({
      ok: true,
      status: 200,
      url: LIST_URL,
      headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/html" : null },
      body: {
        getReader: () => ({
          read: () => new Promise((resolve) => options.signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ done: true });
          }, { once: true })),
          cancel: async () => {},
        }),
      },
    }),
  });
  assert.equal(outcome.status, "failed");
  assert.equal(aborted, true);
});

test("the aggregate work deadline includes response-body consumption", async () => {
  let clock = 0;
  const detailUrl = "https://guide.example/things-to-do/one126153-p126153";
  const outcome = await collectSimpleviewEuropePlaceFeed(feed({ max_total_ms: 100 }), {
    now: () => clock,
    resolveHost: publicDns,
    fetcher: async (url) => {
      if (url === LIST_URL) return response(url, listHtml([
        listItem({ id: "one126153", name: "One", category: "Aquarium" }),
      ]));
      const result = response(url, detailHtml({ name: "One", url: detailUrl }));
      const bytes = new TextEncoder().encode(detailHtml({ name: "One", url: detailUrl }));
      return {
        ...result,
        body: {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (sent) return { done: true };
                sent = true;
                clock = 101;
                return { done: false, value: bytes };
              },
              cancel: async () => {},
            };
          },
        },
      };
    },
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.records, []);
});

test("detail body and aggregate budgets stop fan-out with no partial persistence", async () => {
  const requested = [];
  const outcome = await collectSimpleviewEuropePlaceFeed(feed({ max_detail_bytes: 1024, max_total_bytes: 2_048 }), {
    resolveHost: publicDns,
    fetcher: async (url) => {
      requested.push(url);
      if (url === LIST_URL) return response(url, listHtml([
        listItem({ id: "one126153", name: "One", category: "Aquarium" }),
        listItem({ id: "two258003", name: "Two", category: "Tower" }),
      ]));
      return response(url, "x".repeat(1500));
    },
  });
  assert.equal(outcome.status, "failed");
  assert.deepEqual(outcome.records, []);
  assert.equal(requested.length, 2);
});

test("malformed incomplete mismatched and cross-object details fail closed", async () => {
  const rows = [
    { id: "one126153", name: "One", category: "Aquarium", body: detailHtml({ address: false }) },
    { id: "two258003", name: "Two", category: "Tower", body: detailHtml({ id: "258003", name: "Other", category: "Tower", url: "https://guide.example/things-to-do/two258003-p258003" }) },
    { id: "three432253", name: "Three", category: "Museum", body: detailHtml({ id: "432253", name: "Three", category: "Museum", url: "https://guide.example/things-to-do/three432253-p432253", secondObject: '<div itemscope itemtype="http://schema.org/LocalBusiness"><h1 itemprop="name">Unrelated</h1></div>' }) },
  ];
  const bodies = new Map(rows.map((row) => [`https://guide.example/things-to-do/${row.id}-p${row.id.replace(/\D/g, "")}`, row.body]));
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => response(url, url === LIST_URL
      ? listHtml(rows.map((row) => listItem(row)))
      : bodies.get(url)),
  });
  assert.equal(outcome.status, "empty");
  assert.deepEqual(outcome.records, []);
});

test("facts outside the one LocalBusiness scope cannot complete its record", async () => {
  const detailUrl = "https://guide.example/things-to-do/one126153-p126153";
  const malicious = `<html>
    <head><meta property="og:latitude" content="50.3668518066406"><meta property="og:longitude" content="-4.13050985336304"></head>
    <body>
      <main itemscope itemtype="http://schema.org/LocalBusiness"><h1 itemprop="name">One</h1></main>
      <meta itemprop="url" content="${detailUrl}">
      <span class="category">Aquarium</span>
      <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <meta itemprop="streetAddress" content="Rope Walk">
        <meta itemprop="addressLocality" content="Northport">
      </div>
    </body>
  </html>`;
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => response(url, url === LIST_URL
      ? listHtml([listItem({ id: "one126153", name: "One", category: "Aquarium" })])
      : malicious),
  });
  assert.equal(outcome.status, "empty");
  assert.deepEqual(outcome.records, []);
});

test("detail identity uses canonical itemprop URL atoms while category remains list-bound", async () => {
  const detailUrl = "https://guide.example/things-to-do/one126153-p126153";
  const detail = `<html itemscope itemtype="http://schema.org/LocalBusiness">
    <head><meta property="og:latitude" content="50.3668518066406"><meta property="og:longitude" content="-4.13050985336304"></head>
    <body>
      <nav><a itemprop="url" href="https://guide.example/things-to-do">Things to do</a></nav>
      <h1 itemprop="name">One</h1>
      <div itemscope itemtype="http://schema.org/Offer"><span itemprop="name">Day ticket</span></div>
      <meta itemprop="url" content="${detailUrl}"><meta itemprop="url" content="${detailUrl}">
      <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
        <meta itemprop="streetAddress" content="Rope Walk">
        <meta itemprop="addressLocality" content="Northport">
      </div>
    </body>
  </html>`;
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => response(url, url === LIST_URL
      ? listHtml([listItem({ id: "one126153", name: "One", category: "Aquarium" })])
      : detail),
  });
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.records[0].website, detailUrl);
  assert.equal(outcome.records[0].type, "landmark");
});

test("closed schema.org place subtypes can envelope matching list categories", async () => {
  const detailUrl = "https://guide.example/things-to-do/city-museum-p432253";
  const detail = detailHtml({
    id: "432253",
    name: "City Museum",
    category: "Museum",
    url: detailUrl,
  }).replace("schema.org/LocalBusiness", "schema.org/Museum");
  const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
    resolveHost: publicDns,
    fetcher: async (url) => response(url, url === LIST_URL
      ? listHtml([listItem({ id: "432253", name: "City Museum", category: "Museum", href: detailUrl })])
      : detail),
  });
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.records[0].type, "museum");
});

test("realistic fixtures from two official sites prove one generic useful-candidate shape", async () => {
  for (const sample of [
    { id: "126153", name: "Harbour Aquarium", category: "Aquarium", type: "landmark", lat: 50.3668518066406, lng: -4.13050985336304 },
    { id: "610621", name: "Island Animal Haven", category: "Animal Collection / Zoo", type: "landmark", lat: 50.405940246582, lng: -4.06286995410919 },
  ]) {
    const detailUrl = `https://guide.example/things-to-do/${sample.name.toLowerCase().replace(/\s+/g, "-")}-p${sample.id}`;
    const outcome = await collectSimpleviewEuropePlaceFeed(feed(), {
      resolveHost: publicDns,
      fetcher: async (url) => response(url, url === LIST_URL
        ? listHtml([listItem({ id: sample.id, name: sample.name, category: sample.category, href: detailUrl })])
        : detailHtml({ ...sample, url: detailUrl })),
    });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.records[0].type, sample.type);
    assert.equal(outcome.records[0].lat, sample.lat);
    assert.equal(outcome.records[0].lng, sample.lng);
    assert.deepEqual(outcome.records[0].source_provenance, {
      list_source_id: "reviewed-guide",
      list_url: LIST_URL,
      detail_url: detailUrl,
    });
    assert.doesNotMatch(JSON.stringify(outcome.records[0]), /NewMind|<html|registerNameSpace/);
  }
});

test("review-only qualification can probe a licensed Simpleview candidate", async () => {
  const detailUrl = "https://guide.example/things-to-do/one126153-p126153";
  const result = await probeReviewedPlaceFeed(feed({
    source_health: "candidate",
    runtime_policy: "review_required",
  }), {
    resolveHost: publicDns,
    fetcher: async (url) => response(url, url === LIST_URL
      ? listHtml([listItem({ id: "one126153", name: "One", category: "Aquarium" })])
      : detailHtml({ name: "One", url: detailUrl })),
  });
  assert.deepEqual(result, {
    status: "ok",
    accepted_place_count: 1,
    distinct_place_type_count: 1,
  });
});

test("discovery detects the closed shape but preserves permission-required terms", () => {
  const result = inspectSimpleviewEuropePlaceList(listHtml([
    listItem({ id: "126153", name: "One", category: "Aquarium" }),
    listItem({ id: "258003", name: "Two", category: "Tower" }),
  ]), { endpoint: LIST_URL, termsStatus: "permission_required" });
  assert.equal(result.status, "ok");
  assert.equal(result.adapter, SIMPLEVIEW_EUROPE_PLACE_ADAPTER);
  assert.equal(result.detail_link_count, 2);
  assert.equal(result.terms_status, "permission_required");
});

test("adapter implementation contains no host or city production branch", () => {
  const source = fs.readFileSync(require.resolve("../server/place-candidates/simpleview-europe-place-detail-source"), "utf8");
  assert.doesNotMatch(source, /plymouth|wight|kivik|malm[oö]|stockholm/i);
  assert.doesNotMatch(source, /visitplymouth|visitisleofwight/i);
});
