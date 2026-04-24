# Share My Meals: CEO Application Intake

Browser-recorded video application with magic-link access, direct-to-S3 upload, and SendGrid email. Hosts on Netlify (free tier).

## Architecture

```
Candidate -> index.html (Turnstile)
          -> /api/request-link  (verifies captcha, issues HMAC token, emails link)
Candidate -> record.html?t=TOKEN
          -> /api/verify-token  (returns 3 questions + presigned S3 PUT URL)
          -> [direct PUT to S3]
          -> /api/complete-upload  (marks submission received, optional Telegram ping)
```

Everything in S3 at `s3://$SMM_CEO_S3_BUCKET/`:
- `candidates/{tokenBody}.json` - one file per candidate (name, email, status)
- `videos/{tokenBody}.webm` - the recording

Public access blocked, AES256 encryption, versioning on.

## Setup

### 1. Install

```bash
cd clients/sharemymeals/ceo-application
npm install
```

### 2. Configure `.env`

```bash
cp .env.example .env
```

Fill in:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (VoiceStream IAM user works)
- `SMM_CEO_S3_BUCKET` (default: `smm-ceo-applications`)
- `SENDGRID_API_KEY`
- `SMM_MAGIC_LINK_FROM_EMAIL` = `stan@sharemymeals.org` (must be a verified SendGrid sender)
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` (use Cloudflare test keys for dev, real keys for prod)
- `SMM_TOKEN_SECRET` - generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `SMM_SITE_URL` = `http://localhost:8888` for dev, Netlify URL for prod

### 3. Create the S3 bucket (one-time)

```bash
node --env-file=.env scripts/create-bucket.js
```

This creates the bucket, blocks public access, enables encryption, sets CORS for browser PUT.

### 4. Run locally

```bash
npx netlify dev
```

Visit http://localhost:8888. Fill the form, check your inbox for the magic link, record a video, submit.

## Deploy

```bash
npx netlify init    # first time: connects to a new or existing Netlify site
npx netlify env:import .env     # push env vars to Netlify
npx netlify deploy --prod
```

After deploy, update:
- `SMM_SITE_URL` in Netlify env to the live URL
- Turnstile: create production site key bound to that domain, swap `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
- Re-run `scripts/create-bucket.js` with the updated `SMM_SITE_URL` to add the live origin to S3 CORS

## Questions

The three questions shown to candidates live in `netlify/functions/_lib/questions.js`. Edit and redeploy to change.

## Next steps (not built yet)

- Gemini transcription of submitted videos
- Claude scoring against the job description
- Notion push with scores, themes, flags
- Admin dashboard or candidate list view
