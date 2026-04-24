#!/usr/bin/env node
/**
 * One-shot setup: creates the S3 bucket for CEO application videos + candidate records.
 * - Blocks all public access
 * - Enables AES256 default encryption
 * - Sets versioning (so accidental overwrites are recoverable)
 * - Applies CORS allowing browser PUT from the configured site URLs
 *
 * Usage: node scripts/create-bucket.js
 */
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutBucketCorsCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || "us-east-2";
const bucket = process.env.SMM_CEO_S3_BUCKET;

if (!bucket) {
  console.error("Set SMM_CEO_S3_BUCKET in .env (e.g. smm-ceo-applications).");
  process.exit(1);
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("AWS credentials missing from .env.");
  process.exit(1);
}

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function bucketExists() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") return false;
    if (err.$metadata?.httpStatusCode === 403) {
      console.error(`Bucket "${bucket}" exists but your IAM user can't access it. Pick a different name or fix permissions.`);
      process.exit(1);
    }
    throw err;
  }
}

async function main() {
  if (await bucketExists()) {
    console.log(`Bucket "${bucket}" already exists. Updating config anyway...`);
  } else {
    console.log(`Creating bucket "${bucket}" in ${region}...`);
    const createParams = { Bucket: bucket };
    if (region !== "us-east-1") {
      createParams.CreateBucketConfiguration = { LocationConstraint: region };
    }
    await s3.send(new CreateBucketCommand(createParams));
  }

  console.log("Blocking public access...");
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  }));

  console.log("Enabling AES256 encryption...");
  await s3.send(new PutBucketEncryptionCommand({
    Bucket: bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
    },
  }));

  console.log("Enabling versioning...");
  await s3.send(new PutBucketVersioningCommand({
    Bucket: bucket,
    VersioningConfiguration: { Status: "Enabled" },
  }));

  const origins = [
    "http://localhost:8888",
    "http://localhost:3000",
  ];
  if (process.env.SMM_SITE_URL) origins.push(process.env.SMM_SITE_URL.replace(/\/$/, ""));

  console.log(`Setting CORS (origins: ${origins.join(", ")})...`);
  await s3.send(new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [{
        AllowedMethods: ["PUT", "GET", "HEAD"],
        AllowedOrigins: origins,
        AllowedHeaders: ["*"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3000,
      }],
    },
  }));

  console.log("\nDone. Bucket ready:");
  console.log(`  s3://${bucket}`);
  console.log(`  region: ${region}`);
  console.log("\nIf you add a custom domain later, re-run this script after updating SMM_SITE_URL.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
