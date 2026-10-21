'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
const {buildApp}=require('/app/server/app');
const {mapOsmElement}=require('/app/server/place-candidates/open-data-loader');
const {mapOvertureRow}=require('/app/server/place-candidates/overture-source');
const NOW='2026-10-21T08:00:00Z', DATE='2026-10-22', ANCHOR={lat:55.6,lng:13};
const unexpected=[];
function mockJsonResponse(payload) {
  return { ok: true, status: 200, statusText: "OK", async json() { return payload; } };
}

// Deterministic weather; throws on any non-weather URL so a stray live network
// call fails the test loudly.
function mockStableWeatherFetch() {
  return async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.open-meteo.com") {
      const start = new Date(`${parsed.searchParams.get("start_date")}T12:00:00`);
      const end = new Date(`${parsed.searchParams.get("end_date")}T12:00:00`);
      const time = [];
      const weathercode = [];
      const temperature_2m_max = [];
      const temperature_2m_min = [];
      for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        time.push(cursor.toISOString().slice(0, 10));
        weathercode.push(0);
        temperature_2m_max.push(24);
        temperature_2m_min.push(14);
      }
      return mockJsonResponse({
        daily: { time, weathercode, temperature_2m_max, temperature_2m_min },
        current: { temperature_2m: 19.2, weather_code: 1, is_day: 1 },
      });
    }
    throw new Error(`Unexpected live network during planner reservoir QA: ${url}`);
  };
}


const weatherFetch=mockStableWeatherFetch();global.fetch=async url=>{try{return await weatherFetch(url);}catch(e){unexpected.push(String(url));throw e;}};
function sourceRows() {
  return [0, .001, .002, .003, .020, .027].flatMap((delta, index) => {
    const name = `Source Closet ${index}`, lat = ANCHOR.lat + delta;
    return [mapOsmElement({ type: 'node', id: 99800 + index, lat, lon: ANCHOR.lng,
      tags: { name, shop: 'second_hand', 'addr:street': 'Source Street', 'addr:housenumber': String(10 + index) } }),
    mapOvertureRow({ id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, name,
      lat, lng: ANCHOR.lng, category: 'second_hand_clothing_store', category_hierarchy: ['second_hand_clothing_store'],
      confidence: .998, operating_status: 'open', licenses: ['CDLA-Permissive-2.0'] })];
  });
}


const records=sourceRows();const clock=Object.assign(()=>new Date(NOW),{now:()=>NOW});
  const app = buildApp({ openDataLoader: async () => records, eventSupply: null,
    placeSuggestions: null, sourceCatalog: null, reviewedPlaceSource: null, clock,
    placeResolver: async query => {
      assert.match(query, /Fixture Area/);
      return [{ ...ANCHOR, label: 'Fixture Area', confidence: 'high', provenance: { provider: 'controlled-resolver' } }];
    },
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 20,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  });

const server=http.createServer((req,res)=>{
 if(req.url==='/_qa/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({node:process.version,arch:process.arch,sha:process.env.PARRANDA_BUILD_SHA,unexpected,source_rows:records.length}));return;}
 app(req,res);
}).listen(8000,'0.0.0.0',()=>console.log(JSON.stringify({controlled_ready:true,sha:process.env.PARRANDA_BUILD_SHA,node:process.version,arch:process.arch})));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
