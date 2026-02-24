# Registration Page with SendGrid Integration

A beautiful, modern registration page that sends email notifications via SendGrid when someone registers.

## Features

- 🎨 Modern, responsive design with gradient animations
- 📧 SendGrid email integration
- ✅ Form validation with visual feedback
- 📱 Mobile-friendly interface
- 🚀 Ready for deployment on Render.com
- ⚡ Fast and lightweight

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory (use `.env.example` as a template):

```env
SENDGRID_API_KEY=your_sendgrid_api_key_here
SENDER_EMAIL=noreply@yourdomain.com
RECIPIENT_EMAIL=your-email@example.com
PORT=3000
NODE_ENV=development
```

**Important SendGrid Notes:**
- Get your API key from [SendGrid Dashboard](https://app.sendgrid.com/settings/api_keys)
- The `SENDER_EMAIL` must be verified in your SendGrid account
- You can verify a single email or an entire domain in SendGrid settings

### 3. Run Locally

```bash
npm start
```

Visit `http://localhost:3000` to see your registration page.

## Deployment to Render.com

### Step 1: Prepare Your Repository

1. Initialize git (if not already done):
```bash
git init
git add .
git commit -m "Initial commit"
```

2. Push to GitHub, GitLab, or Bitbucket

### Step 2: Deploy on Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" and select "Web Service"
3. Connect your repository
4. Configure the service:
   - **Name**: Choose a name (e.g., "smm-registrations")
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or choose paid plan)

### Step 3: Add Environment Variables

In the Render dashboard, add these environment variables:

| Key | Value |
|-----|-------|
| `SENDGRID_API_KEY` | Your SendGrid API key |
| `SENDER_EMAIL` | Your verified sender email |
| `RECIPIENT_EMAIL` | Email where registrations will be sent |
| `NODE_ENV` | `production` |

### Step 4: Deploy

Click "Create Web Service" and Render will automatically deploy your app!

## SendGrid Setup

### 1. Create a SendGrid Account

1. Sign up at [SendGrid](https://signup.sendgrid.com/)
2. Choose the Free plan (100 emails/day)

### 2. Create an API Key

1. Go to Settings → API Keys
2. Click "Create API Key"
3. Choose "Restricted Access"
4. Enable "Mail Send" permission
5. Copy the API key (you won't see it again!)

### 3. Verify Sender Email

**Option A: Single Sender Verification** (Easiest for testing)
1. Go to Settings → Sender Authentication
2. Click "Verify a Single Sender"
3. Fill in your details
4. Check your email and click the verification link

**Option B: Domain Authentication** (Best for production)
1. Go to Settings → Sender Authentication
2. Click "Authenticate Your Domain"
3. Follow the DNS configuration steps

## Form Fields

The registration form includes:

- **First Name** (required)
- **Last Name** (required)
- **Email** (required, validated)
- **Phone** (optional, auto-formatted)
- **Company** (optional)
- **Area of Interest** (required, dropdown)
- **Message** (optional, textarea)

## Email Notification

When someone registers, you'll receive a beautifully formatted HTML email with:

- All submitted form data
- Timestamp
- Clickable email and phone links
- Professional gradient design

## Customization

### Change Colors

Edit `styles.css` and modify the CSS variables:

```css
:root {
    --primary: #6366f1;        /* Main color */
    --primary-dark: #4f46e5;   /* Darker shade */
    --primary-light: #818cf8;  /* Lighter shade */
    /* ... */
}
```

### Modify Form Fields

Edit `index.html` to add/remove fields. Don't forget to update:
- The form HTML
- `script.js` to collect the new data
- `api/register.js` to include it in the email

### Change Email Template

Edit `api/register.js` and modify the `emailHtml` variable to customize the email design.

## Troubleshooting

### Emails Not Sending

1. **Check API Key**: Make sure it's correct and has Mail Send permissions
2. **Verify Sender**: The sender email must be verified in SendGrid
3. **Check Logs**: On Render, check the logs for error messages
4. **Review Activity**: Check SendGrid Activity Feed for failed emails

### CORS Errors

The API includes CORS headers. If you still see errors, make sure your frontend is calling the correct API endpoint.

### Form Not Submitting

1. Check browser console for errors
2. Verify the API endpoint URL matches your deployment
3. Check network tab to see the request/response

## Security Notes

- Never commit `.env` file to git
- Keep your SendGrid API key secret
- Use environment variables on Render for all sensitive data
- The form includes basic validation, but add server-side validation for production

## Support

For issues with:
- **SendGrid**: [SendGrid Support](https://support.sendgrid.com/)
- **Render**: [Render Documentation](https://render.com/docs)

## License

ISC
