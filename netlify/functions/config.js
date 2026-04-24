const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  body: JSON.stringify(obj),
});

export async function handler() {
  return json(200, {
    turnstile_site_key: process.env.TURNSTILE_SITE_KEY || "1x00000000000000000000AA",
  });
}
