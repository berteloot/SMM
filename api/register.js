// Serverless function for Render.com
const sgMail = require('@sendgrid/mail');
const { OpenAI } = require('openai');

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
        const { firstName, lastName, email, phone, company, message, timestamp } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Initialize SendGrid and OpenAI
        const sendgridApiKey = process.env.SENDGRID_API_KEY;
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const recipientEmail = process.env.RECIPIENT_EMAIL || 'your-email@example.com';

        if (!sendgridApiKey) {
            console.error('SendGrid API key not configured');
            return res.status(500).json({ error: 'Email service not configured' });
        }

        if (!openaiApiKey) {
            console.error('OpenAI API key not configured');
            return res.status(500).json({ error: 'AI service not configured' });
        }

        sgMail.setApiKey(sendgridApiKey);
        const openai = new OpenAI({ apiKey: openaiApiKey });

        // Generate lively email content using OpenAI
        const userInfo = `
Name: ${firstName} ${lastName}
Email: ${email}
${phone ? `Phone: ${phone}` : 'No phone provided'}
${company ? `Company: ${company}` : 'No company provided'}
${message ? `User Comment: ${message}` : 'No additional comments'}
        `;

        const prompt = `You are a warm, enthusiastic, and professional assistant. Generate a nice, lively, and personalized welcome email for a new registration. The email should feel authentic and genuine, not overly corporate.

Here's the new registrant's information:
${userInfo}

Please create an engaging welcome email that:
1. Greets them warmly and makes them feel valued
2. ${message ? 'References their comment about ' + message : 'Thanks them for joining'}
3. Gives them a sense of what's coming next or what to expect
4. Has a friendly, conversational tone
5. Ends with a warm closing

Return ONLY the email body (no subject line, no HTML tags, just plain text that will be used in an email).`;

        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        const emailBodyText = aiResponse.choices[0].message.content;

        // Create HTML version with styling
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
                    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                    .email-body { background: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #6366f1; }
                    .field { margin-bottom: 15px; }
                    .label { font-weight: bold; color: #6366f1; margin-bottom: 5px; font-size: 12px; }
                    .value { background: white; padding: 8px; border-radius: 3px; font-size: 14px; }
                    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
                    .section-title { font-weight: bold; color: #6366f1; margin-top: 20px; margin-bottom: 10px; font-size: 13px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0;">Welcome, ${firstName}! 🎉</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9;">New Registration Received</p>
                    </div>
                    <div class="content">
                        <div class="email-body">
                            ${emailBodyText.split('\n').map(line => `<p>${line}</p>`).join('')}
                        </div>

                        <div class="section-title">Registration Details</div>

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

                        ${message ? `
                        <div class="field">
                            <div class="label">Their Message</div>
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

        const emailText = `Welcome, ${firstName}!\n\n${emailBodyText}\n\n---\nRegistration Details:\nName: ${firstName} ${lastName}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ''}${company ? `Company: ${company}\n` : ''}${message ? `Message: ${message}\n` : ''}Registration Time: ${new Date(timestamp).toLocaleString()}`;

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
