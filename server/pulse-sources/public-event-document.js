"use strict";

const { documentText } = require("./quoted-event-reader");
const { publicAddressesForUrl, pinnedHttpsFetch } = require("../place-candidates/simpleview-europe-place-detail-source");
const MAX_PAGES = 8;
const MAX_PIXELS = 8_000_000;

async function fetchPublicEventDocument(url, options = {}) {
  const dns = require("node:dns/promises");
  const validatedAddresses = await publicAddressesForUrl(url, url, dns.lookup, 3000);
  if (!validatedAddresses) throw new Error("source_public_address_required");
  return pinnedHttpsFetch(url, { ...options, validatedAddresses });
}

// OCR supplies independently read text, not event decisions. The inexpensive
// model remains the main event reader; its quotes are checked against this
// document text. Unreadable scans produce a failure, never fabricated facts.
async function extractPublicEventDocument({ body, binary_base64, content_type = "text/html" }, {
  language = "en", ocr = recognizeImage, timeoutMs = 20_000,
} = {}) {
  if (!binary_base64) return { text: documentText(body, content_type), kind: "text" };
  const bytes = Buffer.from(binary_base64, "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("document_too_large");
  if (/^image\/(png|jpeg|webp)/i.test(content_type)) {
    const size = imageDimensions(bytes, content_type);
    if (!size || size.width < 1 || size.height < 1 || size.width > 10_000 || size.height > 10_000 || size.width * size.height > MAX_PIXELS) throw new Error("document_pixel_limit");
    return { text: documentText(await ocr(bytes, { language, timeoutMs }), "text/plain"), kind: "ocr" };
  }
  if (!/^application\/pdf/i.test(content_type)) throw new Error("document_format_unsupported");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
    useSystemFonts: false, stopAtErrors: true });
  let document;
  const timer = setTimeout(() => loading.destroy(), Math.min(30_000, timeoutMs));
  try {
    document = await loading.promise;
    if (document.numPages > MAX_PAGES) throw new Error("document_page_limit");
    const text = [];
    let usedOcr = false;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let pageText = content.items.map((item) => item.str || "").join(" ");
      if (pageText.trim().length < 8) {
        const viewport = page.getViewport({ scale: 1.5 });
        if (viewport.width * viewport.height > MAX_PIXELS) throw new Error("document_pixel_limit");
        const canvas = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        try {
          await page.render({ canvasContext: canvas.context, viewport }).promise;
          pageText = await ocr(canvas.canvas.toBuffer("image/png"), { language, timeoutMs });
          usedOcr = true;
        } finally { document.canvasFactory.destroy(canvas); }
      }
      text.push(pageText);
      page.cleanup();
    }
    return { text: documentText(text.join("\n"), "text/plain"), kind: usedOcr ? "pdf_ocr" : "pdf_text" };
  } finally { clearTimeout(timer); await loading.destroy(); }
}

function imageDimensions(bytes, type) {
  if (/png/i.test(type) && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (/jpeg/i.test(type) && bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (/webp/i.test(type) && bytes.length >= 30 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") {
    const chunk = bytes.subarray(12, 16).toString();
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (chunk === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) return { width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383 };
    if (chunk === "VP8L" && bytes[20] === 47) return { width: ((bytes[22] & 63) << 8 | bytes[21]) + 1,
      height: ((bytes[24] & 15) << 10 | bytes[23] << 2 | bytes[22] >> 6) + 1 };
  }
  return null;
}

async function recognizeImage(bytes, { language = "en", timeoutMs = 20_000,
  langPath = process.env.PARRANDA_OCR_LANG_PATH, cachePath = process.env.PARRANDA_CACHE_DIR } = {}) {
  const { Worker } = require("node:worker_threads");
  // ISO language conversion is generic and does not affect place/provider
  // selection. Additional trained languages can be supplied by the operator.
  const languages = { en: "eng", sv: "swe", fr: "fra", es: "spa", pt: "por", de: "deu", it: "ita",
    nl: "nld", fi: "fin", da: "dan", nb: "nor", no: "nor", pl: "pol", el: "ell", cs: "ces", ro: "ron",
    hu: "hun", uk: "ukr", ru: "rus", tr: "tur", ar: "ara", ja: "jpn", ko: "kor", zh: "chi_sim" };
  const lang = languages[language] || "eng";
  const worker = new Worker(require.resolve("./public-event-ocr-worker"), {
    workerData: { bytes, language: lang, langPath, cachePath },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      worker.once("message", (result) => typeof result?.text === "string" ? resolve(result.text) : reject(new Error("document_ocr_uncertain")));
      worker.once("error", () => reject(new Error("document_ocr_failed")));
      worker.once("exit", () => reject(new Error("document_ocr_stopped")));
      timer = setTimeout(() => reject(new Error("document_ocr_timeout")), Math.min(30_000, Math.max(50, timeoutMs)));
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
}

module.exports = { extractPublicEventDocument, recognizeImage, fetchPublicEventDocument };
