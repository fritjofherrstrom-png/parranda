const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeOpenDataAgendaRecord, shimFlatRecord } = require('../server/cities/barcelona/live');

test('Open Data BCN uses the provider detail-page URL format for nested and CSV records', () => {
  // Identifier/title/date taken from a real 2026-10-07 CKAN response.
  // The old /detall/ID returned 404; /detall/_ID.html returned this exact event.
  const row = {
    register_id: '99400787420',
    name: "Taula informativa de l'Asociación Vidas tras un ictus",
    start_date: '2026-10-08',
    end_date: '2026-10-08',
  };
  for (const record of [row, shimFlatRecord(row)]) {
    const event = normalizeOpenDataAgendaRecord(record);
    assert.equal(event.url, 'https://guia.barcelona.cat/ca/detall/_99400787420.html');
    assert.equal(event.id, 'barcelona-open-data-99400787420');
    assert.equal(event.title, row.name);
    assert.equal(event.start_date, row.start_date);
    assert.equal(event.end_date, row.end_date);
  }
});
