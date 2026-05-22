import { TRANS_RIGHTS_DATA, TRANS_RIGHTS_METADATA } from "./trans-rights-data.js";

export const handler = async (event) => {
  const country = event.pathParameters?.country?.toUpperCase();

  if (!country) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: TRANS_RIGHTS_METADATA, data: TRANS_RIGHTS_DATA }),
    };
  }

  const entry = TRANS_RIGHTS_DATA[country];
  if (!entry) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `No data for country: ${country}` }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  };
};
