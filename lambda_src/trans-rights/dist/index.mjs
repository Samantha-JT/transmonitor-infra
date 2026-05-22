// trans-rights/index.mjs
var TRANS_RIGHTS_DATA = {};
var handler = async (event) => {
  const country = event.pathParameters?.country?.toUpperCase();
  if (!country) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TRANS_RIGHTS_DATA)
    };
  }
  const entry = TRANS_RIGHTS_DATA[country];
  if (!entry) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `No data for country code: ${country}` })
    };
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry)
  };
};
export {
  handler
};
