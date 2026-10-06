"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { createWorker } = require("tesseract.js");

(async () => {
  let worker;
  try {
    worker = await createWorker(workerData.language, 1, { errorHandler: () => {},
      ...(workerData.langPath ? { langPath: workerData.langPath } : {}),
      ...(workerData.cachePath ? { cachePath: workerData.cachePath } : {}),
    });
    const result = await worker.recognize(Buffer.from(workerData.bytes));
    parentPort.postMessage(result.data.confidence >= 85
      ? { text: result.data.text } : { failed: true });
  } catch (_error) { parentPort.postMessage({ failed: true }); }
  finally { await worker?.terminate(); parentPort.close(); }
})();
