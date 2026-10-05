"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPublicEventDocument, recognizeImage } = require("../server/pulse-sources/public-event-document");
const { fetchScoutPage } = require("../server/pulse-sources/local-event-source-scout");

function pdf(text) {
  const stream = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let bytes = "%PDF-1.4\n", offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(bytes)); bytes += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(bytes);
  bytes += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(bytes);
}

test("bounded scout preserves PDF bytes for independent text extraction", async () => {
  const bytes = pdf("Local concert 5 October 2026 19:30 at Civic Hall");
  const page = await fetchScoutPage({ url: "https://association.example/poster.pdf", requiredOrigin: "https://association.example",
    fetcher: async () => new Response(bytes, { headers: { "content-type": "application/pdf" } }) });
  assert.equal(page.status, "ok"); assert.equal(page.bytes, bytes.length);
  const document = await extractPublicEventDocument(page);
  assert.equal(document.kind, "pdf_text"); assert.equal(document.text, "Local concert 5 October 2026 19:30 at Civic Hall");
});

test("image documents use independent OCR before event reading; OCR failure propagates", async () => {
  const page = { binary_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=", content_type: "image/png" };
  let language;
  const document = await extractPublicEventDocument(page, { language: "sv", ocr: async (_, options) => {
    language = options.language; return "Konsert 5 oktober 2026 kl 19.30 Föreningshuset";
  } });
  assert.equal(language, "sv"); assert.equal(document.kind, "ocr"); assert.match(document.text, /Föreningshuset/);
  await assert.rejects(extractPublicEventDocument(page, { ocr: async () => { throw new Error("uncertain OCR"); } }), /uncertain/);
  const huge = Buffer.from(page.binary_base64, "base64"); huge.writeUInt32BE(100_000, 16);
  await assert.rejects(extractPublicEventDocument({ ...page, binary_base64: huge.toString("base64") }), /pixel_limit/);
});

test("binary fetch and document decoding reject oversize and invalid payloads", async () => {
  const page = await fetchScoutPage({ url: "https://association.example/poster.png", maxBytes: 1024,
    fetcher: async () => new Response(Buffer.alloc(1025), { headers: { "content-type": "image/png" } }) });
  assert.equal(page.status, "blocked");
  await assert.rejects(extractPublicEventDocument({ binary_base64: Buffer.from("invalid").toString("base64"), content_type: "application/pdf" }));
});

test("OCR initialization is isolated and terminates when language data are unavailable", async () => {
  const started = Date.now();
  await assert.rejects(recognizeImage(Buffer.from("invalid test-only image"), {
    timeoutMs: 100, langPath: "/nonexistent-parranda-test-language-data", cachePath: "/nonexistent-parranda-test-cache",
  }), /document_ocr_/);
  assert.ok(Date.now() - started < 2000, "failed OCR cannot keep the reader alive indefinitely");
});
