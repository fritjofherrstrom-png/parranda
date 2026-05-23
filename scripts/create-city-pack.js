#!/usr/bin/env node

const { createCityPackSkeleton } = require("../server/city-pack-generator/create-city-pack");

function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  let result;
  try {
    result = createCityPackSkeleton(parseArgs(argv));
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    errorOutput.write(`${usage()}\n`);
    return 1;
  }

  output.write(formatResult(result));
  return 0;
}

function parseArgs(argv = []) {
  const options = {};
  const args = [...argv];

  if (args[0] && !args[0].startsWith("--")) {
    options.key = args.shift();
  }

  while (args.length) {
    const flag = args.shift();
    switch (flag) {
      case "--label":
        options.label = readValue(args, flag);
        break;
      case "--timezone":
        options.timezone = readValue(args, flag);
        break;
      case "--locale":
        options.locale = readValue(args, flag);
        break;
      case "--currency":
        options.currency = readValue(args, flag);
        break;
      case "--lat":
        options.lat = readValue(args, flag);
        break;
      case "--lng":
        options.lng = readValue(args, flag);
        break;
      case "--visibility":
        options.visibility = readValue(args, flag);
        break;
      case "--output-root":
        options.outputRoot = readValue(args, flag);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

function readValue(args, flag) {
  const value = args.shift();
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function formatResult(result) {
  const lines = [];
  lines.push(result.written ? "City pack skeleton created" : "City pack skeleton dry run");
  lines.push("");
  lines.push("City:");
  lines.push(`- key: ${result.city.key}`);
  lines.push(`- label: ${result.city.label}`);
  lines.push(`- visibility: ${result.city.visibility}`);
  lines.push(`- timezone: ${result.city.timezone}`);
  lines.push(`- locale: ${result.city.locale}`);
  lines.push(`- currency: ${result.city.currency}`);
  lines.push(`- center: ${result.city.lat}, ${result.city.lng}`);
  lines.push("");
  lines.push(`Target directory: ${result.targetDir}`);
  lines.push("");
  lines.push(result.written ? "Generated files:" : "Files that would be generated:");
  result.files.forEach((file) => {
    lines.push(`- ${file}`);
  });
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "Usage: node scripts/create-city-pack.js <city-key>",
    "  --label <label>",
    "  --timezone <iana-timezone>",
    "  --locale <locale>",
    "  --currency <currency>",
    "  --lat <latitude>",
    "  --lng <longitude>",
    "  [--visibility preview|internal]",
    "  [--output-root <server/cities path>]",
    "  [--dry-run]",
    "  [--force]",
  ].join("\n");
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  formatResult,
  main,
  parseArgs,
  usage,
};
