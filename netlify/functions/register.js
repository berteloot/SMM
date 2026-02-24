const sgMail = require('@sendgrid/mail');
const { OpenAI } = require('openai');

exports.handler = async (event) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // Handle OPTIONS requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ ok: true })
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        let data;
        if (typeof event.body === 'string') {
            data = JSON.parse(event.body);
        } else {
            data = event.body;
        }

        const { firstName, lastName, email, phone, message, timestamp } = data;

        // Validate required fields
        if (!firstName || !lastName || !email) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid email format' })
            };
        }

        // Initialize SendGrid and OpenAI
        const sendgridApiKey = process.env.SENDGRID_API_KEY;
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const senderEmail = process.env.SENDER_EMAIL || process.env.FROM_EMAIL;
        const recipientEmail = process.env.RECIPIENT_EMAIL || senderEmail;

        if (!sendgridApiKey) {
            console.error('SendGrid API key not configured');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Email service not configured' })
            };
        }

        if (!openaiApiKey) {
            console.error('OpenAI API key not configured');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'AI service not configured' })
            };
        }

        sgMail.setApiKey(sendgridApiKey);
        const openai = new OpenAI({ apiKey: openaiApiKey });

        // Generate lively confirmation email using OpenAI
        const userInfo = `
Name: ${firstName} ${lastName}
Email: ${email}
${phone ? `Phone: ${phone}` : 'No phone provided'}
${message ? `User Comment: ${message}` : 'No additional comments'}
        `;

        const prompt = `You are Stan Berteloot from Share My Meals. Generate a warm, lively, and personalized confirmation email for someone who just registered for the Share My Meals Fundraiser event on Thursday, April 2 from 6:30 PM to 8:30 PM at 24 Broadripple Dr, Princeton, NJ 08540. The email should feel authentic and genuine, not overly corporate.

Here's the registrant's information:
${userInfo}

Please create an engaging confirmation email that:
1. Greets them warmly by first name and thanks them for registering
2. ${message ? 'Acknowledges their comment: "' + message + '"' : 'Thanks them for signing up'}
3. Mentions we look forward to seeing them on Thursday April 2
4. Do NOT repeat the event details (date, time, address) as they are already shown above
5. Has a friendly, conversational tone
6. Do NOT include a sign-off or signature at the end (it will be added automatically)

Return ONLY the email body text (no subject line, no HTML tags, no signature).`;

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

        // Email signature
        const signatureHtml = `
            <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #fa642b;">
                <p style="margin: 0; font-weight: bold; color: #545454;">Stan Berteloot</p>
                <p style="margin: 4px 0; color: #fa642b; font-weight: 600;">Share My Meals</p>
                <p style="margin: 4px 0; color: #545454; font-size: 14px;"><a href="tel:609-933-4363" style="color: #545454; text-decoration: none;">609-933-4363</a></p>
                <a href="https://sharemymeals.org/" style="color: #fa642b; text-decoration: none; font-size: 14px;">sharemymeals.org</a>
            </div>
        `;

        const signatureText = `\n\n--\nStan Berteloot\nShare My Meals\n609-933-4363\nhttps://sharemymeals.org/`;

        // ===== EMAIL 1: Confirmation email to the registrant =====
        const confirmationHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #fa642b 0%, #fb7c45 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
                    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                    .email-body { background: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
                    .event-info { background: #fff5f0; padding: 15px; border-left: 4px solid #fa642b; margin-bottom: 20px; border-radius: 5px; }
                    .event-info p { margin: 8px 0; color: #545454; }
                    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0;">You're Registered! 🎉</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9;">Share My Meals Fundraiser</p>
                    </div>
                    <div class="content">
                        <div class="event-info">
                            <p><strong>📅 Thursday, April 2</strong></p>
                            <p><strong>🕖 6:30 PM - 8:30 PM</strong></p>
                            <p><strong>📍 24 Broadripple Dr, Princeton, NJ 08540</strong></p>
                            <p style="margin-top: 8px; font-size: 13px;">Questions? Contact Stan at <a href="tel:609-933-4363" style="color: #fa642b;">609-933-4363</a></p>
                        </div>

                        <div class="email-body">
                            ${emailBodyText.split('\n').map(line => `<p>${line}</p>`).join('')}
                            ${signatureHtml}
                        </div>
                    </div>
                    <div class="footer">
                        <p><a href="https://sharemymeals.org/" style="color: #fa642b; text-decoration: none;">Share My Meals</a> - Fighting food insecurity, one meal at a time</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const confirmationText = `You're Registered for the Share My Meals Fundraiser!\n\nEvent: Thursday, April 2 | 6:30 PM - 8:30 PM\nAddress: 24 Broadripple Dr, Princeton, NJ 08540\nQuestions? Contact Stan at 609-933-4363\n\n${emailBodyText}${signatureText}`;

        // ===== EMAIL 2: Notification email to Stan (admin) =====
        const notificationHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #fa642b 0%, #fb7c45 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
                    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                    .field { margin-bottom: 15px; }
                    .label { font-weight: bold; color: #fa642b; margin-bottom: 5px; font-size: 12px; }
                    .value { background: white; padding: 8px; border-radius: 3px; font-size: 14px; }
                    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0;">New Registration 📋</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9;">Someone just registered for the fundraiser</p>
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
                        <p>SMM Fundraiser Registration System</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const notificationText = `New Registration!\n\nName: ${firstName} ${lastName}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ''}${message ? `Message: ${message}\n` : ''}Registration Time: ${new Date(timestamp).toLocaleString()}`;

        // Send both emails
        const fromField = { email: senderEmail, name: 'Stan Berteloot, Share My Meals' };

        // Email 1: Confirmation to registrant
        await sgMail.send({
            to: email,
            from: fromField,
            subject: `You're registered! Share My Meals Fundraiser - April 2`,
            text: confirmationText,
            html: confirmationHtml,
        });

        // Email 2: Notification to admin
        await sgMail.send({
            to: recipientEmail,
            from: fromField,
            subject: `New Registration: ${firstName} ${lastName}`,
            text: notificationText,
            html: notificationHtml,
        });

        // Return success
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Registration successful'
            })
        };

    } catch (error) {
        console.error('Error processing registration:', error);

        if (error.response) {
            console.error('SendGrid Error:', error.response.body);
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to process registration',
                details: error.message
            })
        };
    }
};
