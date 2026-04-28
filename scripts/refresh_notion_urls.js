#!/usr/bin/env node
// One-off: regenerate presigned video + eval URLs for every Notion row.
// Needed when AWS access keys rotate (the old key is baked into the URL).
// Skips rows whose underlying S3 object has been deleted.
//
// Run with:
//   node --env-file=.env scripts/refresh_notion_urls.js
import { S3Client, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const NOTION_TOKEN = process.env.NOTION_API_KEY;
const NOTION_DB = process.env.NOTION_DATABASE_ID;
const BUCKET = process.env.SMM_CEO_S3_BUCKET || "smm-ceo-applications";

if (!NOTION_TOKEN || !NOTION_DB) {
  console.error("NOTION_API_KEY and NOTION_DATABASE_ID must be set");
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.SMM_AWS_REGION || process.env.AWS_REGION || "us-east-2",
  credentials: {
    accessKeyId: (process.env.SMM_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.SMM_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
  },
});

async function presignGet(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 7 * 24 * 3600 });
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") return false;
    throw err;
  }
}

async function getJson(key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await res.Body.transformToString());
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NoSuchKey") return null;
    throw err;
  }
}

async function listEvalTokens() {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "evaluations/" }));
  return (out.Contents || []).map((o) => o.Key.replace("evaluations/", "").replace(".json", ""));
}

async function notionQuery() {
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100, filter: { property: "Name", title: { is_not_empty: true } } }),
  });
  return (await res.json()).results;
}

async function notionPatch(pageId, props) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: props }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`notion ${res.status}: ${body.message || JSON.stringify(body)}`);
  return body;
}

const minutePrefix = (iso) => (iso || "").slice(0, 16); // YYYY-MM-DDTHH:MM

const tokens = await listEvalTokens();
const rows = await notionQuery();
console.log(`tokens in S3 evaluations/: ${tokens.length}`);
console.log(`rows in Notion: ${rows.length}\n`);

let updated = 0;
let cleared = 0;
let missing = 0;
for (const tokenBody of tokens) {
  const candidate = await getJson(`candidates/${tokenBody}.json`);
  if (!candidate || !candidate.email) continue;

  // Notion stores dates with minute precision; compare on the prefix.
  const matches = rows.filter((r) =>
    r.properties["✉️ Email"]?.email === candidate.email &&
    minutePrefix(r.properties["📅 Submitted"]?.date?.start) === minutePrefix(candidate.submitted_at),
  );

  const evalKey = `evaluations/${tokenBody}.json`;
  const videoKey = candidate.video_key;
  const videoStillThere = videoKey ? await objectExists(videoKey) : false;
  const evalStillThere = await objectExists(evalKey);

  if (matches.length === 0) {
    console.log(`MISSING in Notion: ${candidate.first_name} ${candidate.last_name} (${candidate.email}) @ ${candidate.submitted_at}`);
    missing++;
    continue;
  }

  const props = {
    "🎥 Video": videoStillThere ? { url: await presignGet(videoKey) } : { url: null },
    "📊 Eval JSON": evalStillThere ? { url: await presignGet(evalKey) } : { url: null },
  };
  for (const row of matches) {
    await notionPatch(row.id, props);
    if (videoStillThere) {
      console.log(`refreshed: ${candidate.first_name} ${candidate.last_name} (${candidate.email})`);
      updated++;
    } else {
      console.log(`cleared (video deleted): ${candidate.first_name} ${candidate.last_name} (${candidate.email})`);
      cleared++;
    }
  }
}
console.log(`\nDone. refreshed=${updated} cleared=${cleared} missing_in_notion=${missing}`);
