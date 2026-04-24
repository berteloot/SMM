import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client;
export function s3() {
  if (_client) return _client;
  _client = new S3Client({
    region: process.env.SMM_AWS_REGION || process.env.AWS_REGION || "us-east-2",
    credentials: {
      accessKeyId: process.env.SMM_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.SMM_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export function bucket() {
  const b = process.env.SMM_CEO_S3_BUCKET;
  if (!b) throw new Error("SMM_CEO_S3_BUCKET is not set");
  return b;
}

export async function putJson(key, obj) {
  await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: JSON.stringify(obj, null, 2),
    ContentType: "application/json",
    ServerSideEncryption: "AES256",
  }));
}

export async function getJson(key) {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const body = await res.Body.transformToString();
    return JSON.parse(body);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function objectExists(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") return false;
    throw err;
  }
}

export async function presignPut(key, contentType, expiresSeconds = 3600) {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  });
  return getSignedUrl(s3(), cmd, { expiresIn: expiresSeconds });
}
