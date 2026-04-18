const { buildApp } = require("./server/app");

const port = Number(process.env.PORT || 8000);
const app = buildApp();

app.listen(port, () => {
  console.log(`Parranda listening on http://localhost:${port}`);
});
