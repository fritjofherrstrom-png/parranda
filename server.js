const os = require("node:os");

const { buildApp } = require("./server/app");

const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
const app = buildApp();

function getLocalNetworkUrls(portNumber) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((networkInterface) =>
      networkInterface &&
      networkInterface.family === "IPv4" &&
      !networkInterface.internal,
    )
    .map((networkInterface) => `http://${networkInterface.address}:${portNumber}`);
}

app.listen(port, host, () => {
  console.log(`Parranda listening on http://localhost:${port}`);

  if (host === "0.0.0.0" || host === "::") {
    const networkUrls = getLocalNetworkUrls(port);

    if (networkUrls.length) {
      console.log("Open on a phone on the same Wi-Fi:");
      networkUrls.forEach((url) => console.log(`  ${url}`));
    } else {
      console.log("No LAN address found. Make sure Wi-Fi is on if you want mobile preview.");
    }
  } else {
    console.log(`Bound to host ${host}`);
  }
});
