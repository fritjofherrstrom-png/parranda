"use strict";

// The runner's test timeout reports a failed test, but on Node 24 an active
// handle can still keep that file's child process alive. Bound the isolated
// file too. This timer never keeps a completed file alive and only exits FAIL.
if (process.env.NODE_TEST_CONTEXT) {
  const { setTimeout } = require("node:timers");
  const configured = Number(process.env.PARRANDA_TEST_FILE_DEADLINE_MS);
  const deadline = Number.isFinite(configured) && configured >= 100 && configured <= 600000
    ? configured : 600000;
  setTimeout(() => {
    console.error(`PARRANDA_TEST_FILE_TIMEOUT: ${process.argv[1]} exceeded ${deadline}ms; failing the file.`);
    process.exit(1);
  }, deadline).unref();
}
