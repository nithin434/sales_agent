// scraper_v2.js - LinkedIn Auto-Reply Bot with AI and Email
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Configuration
const CONFIG = {
    apiKey: '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',
    email: {
        from: 'nithinjambula89@gmail.com',
        password: 'qyum bzzh dmxn yivo',
        smtp: 'smtp.gmail.com',
        port: 587
    },
    portfolioLink: 'https://your-portfolio-link.com', // Update this with your actual portfolio link
    testMode: false // Set to false to actually send messages
};

// Email transporter
const emailTransporter = nodemailer.createTransport({
    host: CONFIG.email.smtp,
    port: CONFIG.email.port,
    secure: false,
    auth: {
        user: CONFIG.email.from,
        pass: CONFIG.email.password
    }
});

// Extract email from text
function extractEmail(text) {
    const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
}

// Check if message needs document/info
function needsDocument(text) {
    const keywords = ['send me', 'share', 'portfolio', 'resume', 'cv', 'details', 'information', 'proposal', 'quote', 'pricing'];
    return keywords.some(kw => text.toLowerCase().includes(kw));
}

// Check if message wants meeting
function needsMeeting(text) {
    const keywords = ['meeting', 'call', 'schedule', 'discuss', 'talk', 'available', 'appointment', 'zoom', 'meet'];
    return keywords.some(kw => text.toLowerCase().includes(kw));
}

// Generate meeting times (next 5 business days)
function generateMeetingTimes() {
    const times = [];
    const now = new Date();
    let added = 0;
    
    for (let i = 1; i <= 10 && added < 5; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() + i);
        
        // Skip weekends
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        
        const dateStr = date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
        times.push(`${dateStr} at 10:00 AM EST`);
        times.push(`${dateStr} at 2:00 PM EST`);
        added++;
    }
    
    return times.slice(0, 5);
}

// Generate AI response
async function generateAIResponse(message, contactName, needsDoc, needsMeet) {
    let prompt = `You are Nithin chatting casually on LinkedIn with ${contactName}. Write a short, friendly reply like you're texting a friend - keep it natural, conversational, and under 30 words. No formal business language. Be helpful but casual.`;
    
    if (needsDoc) {
        prompt += "\n\nThey want to see your work/portfolio. Tell them you'll email it over, and if they haven't shared their email, casually ask for it.";
    }
    if (needsMeet) {
        prompt += "\n\nThey want to hop on a call. Sound excited and say you'll send times via email. If no email yet, ask for it in a friendly way.";
    }
    
    try {
        console.log(`   🤖 Calling AI...`);
        
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/nithinjambula",
                "X-Title": "LinkedIn Auto-Reply Bot"
            },
            body: JSON.stringify({
                "model": "meta-llama/llama-3.2-3b-instruct:free",
                "messages": [
                    { "role": "system", "content": prompt },
                    { "role": "user", "content": message }
                ],
                "temperature": 0.9,
                "max_tokens": 100
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`   ❌ API error ${response.status}: ${errorText}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`   📊 API Response:`, JSON.stringify(data).substring(0, 300));
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error(`   ❌ Invalid API response structure`);
            return null;
        }
        
        let aiText = data.choices[0].message.content;
        
        // Handle potential null or undefined
        if (!aiText) {
            console.error(`   ❌ AI returned empty content`);
            return null;
        }
        
        // Clean up the response (remove thinking tokens, extra whitespace, etc.)
        aiText = aiText.trim();
        
        // Remove common AI artifacts
        aiText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '');
        aiText = aiText.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
        aiText = aiText.trim();
        
        if (aiText.length === 0) {
            console.error(`   ❌ AI content empty after cleanup`);
            return null;
        }
        
        console.log(`   ✅ AI generated ${aiText.length} chars`);
        return aiText;
        
    } catch (err) {
        console.error(`   ❌ AI error: ${err.message}`);
        return null;
    }
}

// Fallback message generator
function generateFallbackMessage(contactName, needsDoc, needsMeet) {
    if (needsMeet && needsDoc) {
        return `Hey ${contactName}! Love to chat and share some of my work with you. What's your email? I'll send everything over 👍`;
    } else if (needsMeet) {
        return `Hey ${contactName}! For sure, let's hop on a call. Drop me your email and I'll send you some times that work 📅`;
    } else if (needsDoc) {
        return `Hey ${contactName}! Yeah I can send you my portfolio. What's your email? Will shoot it right over 📧`;
    } else {
        return `Hey ${contactName}! Thanks for reaching out 😊 Tell me more about what you're working on. If you want my portfolio or to schedule a quick call, just send me your email!`;
    }
}

// Send email
async function sendEmail(toEmail, subject, htmlBody) {
    if (CONFIG.testMode) {
        console.log(`   📧 [TEST] Would send email to: ${toEmail}`);
        console.log(`   Subject: ${subject}`);
        return { success: true, test: true };
    }
    
    try {
        const info = await emailTransporter.sendMail({
            from: CONFIG.email.from,
            to: toEmail,
            subject: subject,
            html: htmlBody
        });
        console.log(`   ✅ Email sent: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error(`   ❌ Email error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function findConversations(browser, page) {
    
    // Load session cookies
    try {
        const sessionData = JSON.parse(fs.readFileSync(path.join(__dirname, 'linkedin_session.json'), 'utf8'));
        if (sessionData.cookies && sessionData.cookies.length > 0) {
            await page.setCookie(...sessionData.cookies);
            console.log('✅ Cookies loaded');
        }
    } catch (err) {
        console.log('⚠️ Could not load cookies:', err.message);
    }
    
    // Go to LinkedIn feed first to establish session
    console.log('🔐 Establishing LinkedIn session...');
    try {
        await page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        console.log('✅ Session established');
        await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
        console.log('⚠️ Feed navigation issue, continuing...');
    }
    
    // Now go to messaging
    console.log('📱 Navigating to messaging...');
    try {
        await page.goto('https://www.linkedin.com/messaging/', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
    } catch (err) {
        console.error('❌ Failed to navigate to messaging:', err.message);
        throw err;
    }
    
    console.log('⏳ Waiting for page to load...');
    await new Promise(r => setTimeout(r, 10000));
    
    // Scroll
    await page.evaluate(async () => {
        for (let i = 0; i < 8; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(r => setTimeout(r, 300));
            window.scrollTo(0, 0);
            await new Promise(r => setTimeout(r, 300));
        }
    });
    
    await new Promise(r => setTimeout(r, 2000));
    await new Promise(r => setTimeout(r, 2000));
    
    // Extract conversations
    const conversations = await page.evaluate(() => {
        const results = [];
        const allLinks = Array.from(document.querySelectorAll('a'));
        const threadLinks = allLinks.filter(a => a.href && a.href.includes('/messaging/thread/'));
        const seen = new Set();
        
        threadLinks.forEach((link, i) => {
            const url = link.href;
            if (seen.has(url)) return;
            seen.add(url);
            
            const match = url.match(/\/messaging\/thread\/([^\/\?]+)/);
            const convId = match ? match[1] : '';
            
            let name = link.getAttribute('aria-label') || '';
            if (!name && link.innerText) name = link.innerText.trim().split('\n')[0];
            
            if (!name) {
                let parent = link.parentElement;
                for (let j = 0; j < 8; j++) {
                    if (!parent) break;
                    const h3 = parent.querySelector('h3');
                    const h4 = parent.querySelector('h4');
                    if (h3?.innerText) { name = h3.innerText.trim(); break; }
                    if (h4?.innerText) { name = h4.innerText.trim(); break; }
                    parent = parent.parentElement;
                }
            }
            
            if (!name) name = `Person ${i + 1}`;
            name = name.replace(/\(You\)/gi, '').trim();
            
            let message = '';
            let parent = link.parentElement;
            for (let j = 0; j < 8; j++) {
                if (!parent) break;
                const p = parent.querySelector('p');
                if (p?.innerText && p.innerText.length > 5 && p.innerText.length < 200) {
                    message = p.innerText.trim();
                    break;
                }
                parent = parent.parentElement;
            }
            
            results.push({ name, url, id: convId, lastMessage: message });
        });
        
        return results;
    });
    
    console.log(`\n✅ Found ${conversations.length} conversations`);
    return conversations;
}

// Get full conversation history
async function getConversationHistory(browser, conversationUrl) {
    const page = await browser.newPage();
    
    try {
        await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        
        const messages = await page.evaluate(() => {
            const msgs = [];
            const msgItems = document.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event');
            
            msgItems.forEach(msg => {
                const textEl = msg.querySelector('.msg-s-event-listitem__body, .msg-s-message-group__text, p[dir="ltr"]');
                if (!textEl) return;
                
                const fromMe = msg.className.includes('--me') || msg.className.includes('from-self');
                const text = textEl.innerText.trim();
                
                msgs.push({ text, fromMe });
            });
            
            return msgs;
        });
        
        await page.close();
        return messages;
    } catch (err) {
        await page.close();
        throw err;
    }
}

// Send LinkedIn message
async function sendLinkedInMessage(browser, conversationUrl, messageText) {
    if (CONFIG.testMode) {
        console.log(`   🧪 [TEST] Would send: "${messageText.substring(0, 60)}..."`);
        return { success: true, test: true };
    }
    
    const page = await browser.newPage();
    
    try {
        await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));
        
        // Find input - try multiple selectors
        const inputSelectors = [
            '.msg-form__contenteditable',
            '[contenteditable="true"]',
            '.msg-form__msg-content-container [contenteditable]',
            '.msg-form__msg-content-container--scrollable [contenteditable]',
            'div[role="textbox"]',
            '.msg-form__contenteditable p'
        ];
        let found = false;
        
        for (const sel of inputSelectors) {
            try {
                console.log(`   🔍 Trying selector: ${sel}`);
                await page.waitForSelector(sel, { timeout: 3000 });
                const element = await page.$(sel);
                if (element) {
                    await element.click();
                    await new Promise(r => setTimeout(r, 500));
                    await element.type(messageText, { delay: 30 });
                    console.log(`   ✅ Message typed using: ${sel}`);
                    found = true;
                    break;
                }
            } catch (e) {
                console.log(`   ❌ Selector failed: ${sel}`);
                continue;
            }
        }
        
        if (!found) {
            // Try one more aggressive approach
            try {
                await page.evaluate((msg) => {
                    const editables = document.querySelectorAll('[contenteditable="true"]');
                    if (editables.length > 0) {
                        editables[editables.length - 1].focus();
                        editables[editables.length - 1].innerText = msg;
                        return true;
                    }
                    return false;
                }, messageText);
                console.log(`   ✅ Message typed using fallback method`);
                found = true;
            } catch (e) {
                throw new Error('Message input not found');
            }
        }
        
        await new Promise(r => setTimeout(r, 1000));
        
        // Click send - try multiple selectors
        const sendSelectors = [
            '.msg-form__send-button',
            'button[type="submit"]',
            '.msg-form__send-btn',
            'button.msg-form__send-button',
            '[data-control-name="send"]'
        ];
        
        let sendBtn = null;
        for (const sel of sendSelectors) {
            sendBtn = await page.$(sel);
            if (sendBtn) {
                console.log(`   📤 Found send button: ${sel}`);
                break;
            }
        }
        
        if (!sendBtn) throw new Error('Send button not found');
        
        await sendBtn.click();
        console.log(`   ✅ Send button clicked`);
        await new Promise(r => setTimeout(r, 3000));
        await page.close();
        
        return { success: true };
    } catch (err) {
        await page.close();
        throw err;
    }
}

// Main bot logic
async function runBot() {
    const sessionFilePath = path.join(__dirname, 'linkedin_session.json');
    const userDataDir = path.join(__dirname, 'linkedin_user_data');
    
    console.log('🚀 Starting LinkedIn Auto-Reply Bot...');
    console.log(`Mode: ${CONFIG.testMode ? '🧪 TEST' : '🔴 LIVE'}\n`);
    
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        userDataDir: userDataDir
    });
    
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    // Find conversations
    const conversations = await findConversations(browser, page);
    
    if (conversations.length === 0) {
        console.log('⚠️ No conversations found');
        await browser.close();
        return;
    }
    
    console.log('\n📬 Processing conversations...\n');
    
    let processed = 0;
    let replied = 0;
    
    for (const conv of conversations.slice(0, 5)) { // Process first 5
        console.log(`\n📌 ${conv.name}`);
        
        try {
            // Get conversation history
            const history = await getConversationHistory(browser, conv.url);
            
            if (!history || history.length === 0) {
                console.log('   ⏭️ No messages');
                continue;
            }
            
            // Find last message from them
            const lastFromThem = [...history].reverse().find(m => !m.fromMe);
            if (!lastFromThem) {
                console.log('   ⏭️ No messages from contact');
                continue;
            }
            
            // Check if already replied
            const lastIndex = history.lastIndexOf(lastFromThem);
            const alreadyReplied = history.slice(lastIndex + 1).some(m => m.fromMe);
            
            if (alreadyReplied) {
                console.log('   ⏭️ Already replied');
                continue;
            }
            
            console.log(`   📨 "${lastFromThem.text.substring(0, 60)}..."`);
            
            processed++;
            
            // Check what they need
            const wantsDoc = needsDocument(lastFromThem.text);
            const wantsMeet = needsMeeting(lastFromThem.text);
            const theirEmail = extractEmail(lastFromThem.text);
            
            console.log(`   📋 Document request: ${wantsDoc ? 'YES' : 'NO'}`);
            console.log(`   📅 Meeting request: ${wantsMeet ? 'YES' : 'NO'}`);
            console.log(`   📧 Email found: ${theirEmail || 'NO'}`);
            
            // Generate AI response
            let aiReply = await generateAIResponse(lastFromThem.text, conv.name, wantsDoc, wantsMeet);
            
            // Fallback to generic message if AI fails
            if (!aiReply) {
                console.log('   ⚠️ AI failed - using fallback message');
                aiReply = generateFallbackMessage(conv.name, wantsDoc, wantsMeet);
            }
            
            console.log(`   💬 Reply: "${aiReply}"`);
            
            // Send LinkedIn reply
            let linkedInSent = false;
            try {
                await sendLinkedInMessage(browser, conv.url, aiReply);
                console.log('   ✅ LinkedIn reply sent');
                linkedInSent = true;
                replied++;
            } catch (err) {
                console.log(`   ⚠️ LinkedIn reply failed: ${err.message}`);
                console.log('   📧 Continuing with email sending...');
            }
            
            await new Promise(r => setTimeout(r, 2000));
            
            // Send email if needed (independent of LinkedIn success)
            if (wantsDoc) {
                if (theirEmail) {
                    console.log(`   📧 Sending portfolio to ${theirEmail}`);
                    
                    const emailBody = `
                        <html>
                        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                            <h2>Hi ${conv.name},</h2>
                            <p>Thank you for your interest! As promised, here's my information:</p>
                            
                            <h3>Services I Offer:</h3>
                            <ul>
                                <li>Custom Software Development</li>
                                <li>Web & Mobile App Development</li>
                                <li>AI/ML Integration & Automation</li>
                                <li>Cloud Solutions & DevOps</li>
                                <li>MVP Development for Startups</li>
                            </ul>
                            
                            <h3>Portfolio & Case Studies:</h3>
                            <p>📁 <a href="${CONFIG.portfolioLink}">View My Portfolio</a></p>
                            
                            <h3>Technologies I Work With:</h3>
                            <p>React, Node.js, Python, AWS, Azure, MongoDB, PostgreSQL, Docker, Kubernetes, and more.</p>
                            
                            <h3>Next Steps:</h3>
                            <p>I'd love to discuss your project in detail. Feel free to reply to this email or let me know your availability for a quick call.</p>
                            
                            <p>Best regards,<br>
                            Nithin Jambula<br>
                            Software Developer<br>
                            ${CONFIG.email.from}</p>
                        </body>
                        </html>
                    `;
                    
                    await sendEmail(theirEmail, `Portfolio & Information - ${conv.name}`, emailBody);
                } else {
                    console.log(`   ℹ️ Document requested but no email - asked in LinkedIn reply`);
                }
            }
            
            // Send meeting email if needed
            if (wantsMeet) {
                if (theirEmail) {
                    console.log(`   📅 Sending meeting times to ${theirEmail}`);
                    
                    const meetingTimes = generateMeetingTimes();
                    const meetingBody = `
                        <html>
                        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                            <h2>Hi ${conv.name},</h2>
                            <p>Great to connect! I'd be happy to schedule a call to discuss your project and how I can help.</p>
                            
                            <h3>My Available Time Slots:</h3>
                            <ul>
                                ${meetingTimes.map(time => `<li>📅 ${time}</li>`).join('')}
                            </ul>
                            
                            <p>Please let me know which time works best for you, or feel free to suggest an alternative that suits your schedule.</p>
                            
                            <h3>Meeting Details:</h3>
                            <ul>
                                <li><strong>Duration:</strong> 30-45 minutes</li>
                                <li><strong>Platform:</strong> Zoom or Google Meet (I'll send the link)</li>
                                <li><strong>Agenda:</strong> Understand your project requirements, discuss solutions, and answer any questions</li>
                            </ul>
                            
                            <p>Looking forward to speaking with you!</p>
                            
                            <p>Best regards,<br>
                            Nithin Jambula<br>
                            Software Developer<br>
                            ${CONFIG.email.from}</p>
                        </body>
                        </html>
                    `;
                    
                    await sendEmail(theirEmail, `Meeting Request - ${conv.name}`, meetingBody);
                } else {
                    console.log(`   ℹ️ Meeting requested but no email - asked in LinkedIn reply`);
                }
            }
            
            await new Promise(r => setTimeout(r, 3000));
            
        } catch (err) {
            console.log(`   ❌ Error: ${err.message}`);
        }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Conversations found: ${conversations.length}`);
    console.log(`Processed: ${processed}`);
    console.log(`Replied: ${replied}`);
    
    console.log('\n✋ Closing in 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));
    
    await browser.close();
}

runBot().catch(console.error);
