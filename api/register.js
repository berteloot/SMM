// Serverless function for Render.com
const sgMail = require('@sendgrid/mail');

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { firstName, lastName, email, phone, company, interests, message, timestamp } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !email || !interests) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Initialize SendGrid
        const apiKey = process.env.SENDGRID_API_KEY;
        const recipientEmail = process.env.RECIPIENT_EMAIL || 'your-email@example.com';

        if (!apiKey) {
            console.error('SendGrid API key not configured');
            return res.status(500).json({ error: 'Email service not configured' });
        }

        sgMail.setApiKey(apiKey);

        // Format the email content
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
                    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                    .field { margin-bottom: 20px; }
                    .label { font-weight: bold; color: #6366f1; margin-bottom: 5px; }
                    .value { background: white; padding: 10px; border-radius: 5px; border-left: 3px solid #6366f1; }
                    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0;">New Registration Received!</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9;">Someone just registered on your website</p>
                    </div>
                    <div class="content">
                        <div class="field">
                            <div class="label">Name</div>
                            <div class="value">${firstName} ${lastName}</div>
                        </div>

                        <div class="field">
                            <div class="label">Email</div>
                            <div class="value"><a href="mailto:${email}">${email}</a></div>
                        </div>

                        ${phone ? `
                        <div class="field">
                            <div class="label">Phone</div>
                            <div class="value"><a href="tel:${phone}">${phone}</a></div>
                        </div>
                        ` : ''}

                        ${company ? `
                        <div class="field">
                            <div class="label">Company</div>
                            <div class="value">${company}</div>
                        </div>
                        ` : ''}

                        <div class="field">
                            <div class="label">Area of Interest</div>
                            <div class="value">${interests}</div>
                        </div>

                        ${message ? `
                        <div class="field">
                            <div class="label">Message</div>
                            <div class="value">${message}</div>
                        </div>
                        ` : ''}

                        <div class="field">
                            <div class="label">Registration Time</div>
                            <div class="value">${new Date(timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                    <div class="footer">
                        <p>This email was sent from your registration form</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        // Plain text version
        const emailText = `
New Registration Received!

Name: ${firstName} ${lastName}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}
${company ? `Company: ${company}` : ''}
Area of Interest: ${interests}
${message ? `Message: ${message}` : ''}
Registration Time: ${new Date(timestamp).toLocaleString()}
        `;

        // Send email via SendGrid
        const msg = {
            to: recipientEmail,
            from: process.env.SENDER_EMAIL || 'noreply@yourdomain.com', // Must be verified in SendGrid
            subject: `New Registration: ${firstName} ${lastName}`,
            text: emailText,
            html: emailHtml,
        };

        await sgMail.send(msg);

        // Return success
        return res.status(200).json({
            success: true,
            message: 'Registration successful'
        });

    } catch (error) {
        console.error('Error processing registration:', error);

        if (error.response) {
            console.error('SendGrid Error:', error.response.body);
        }

        return res.status(500).json({
            error: 'Failed to process registration',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
