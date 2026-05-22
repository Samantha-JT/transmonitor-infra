// health/index.mjs
var handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "ok",
    service: "transmonitor-api",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  })
});
export {
  handler
};
