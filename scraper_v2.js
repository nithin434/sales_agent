// scraper_v2.js - LinkedIn Auto-Reply Bot with AI and Email
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Session management
const sessionId = process.env.SESSION_ID || 'default';
const sanitizedSessionId = process.env.SANITIZED_SESSION_ID || sessionId;
const HEADLESS = process.env.HEADLESS !== 'false';

// Logger function
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type}] ${message}`;
    console.log(logMessage);
}

// Load session configuration
function loadSessionConfig() {
    const config = {
        apiKey: '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',
        email: {
            from: 'nithinjambula89@gmail.com',
            password: 'qyum bzzh dmxn yivo',
            smtp: 'smtp.gmail.com',
            port: 587
        },
        portfolioLink: 'https://your-portfolio-link.com',
        testMode: false
    };
    
    try {
        // Load configuration from files
        const personalityFile = path.join(__dirname, 'personality.txt');
        if (fs.existsSync(personalityFile)) {
            config.personality = fs.readFileSync(personalityFile, 'utf8').trim();
        }
        
        const portfolioFile = path.join(__dirname, 'portfolio_link.txt');
        if (fs.existsSync(portfolioFile)) {
            config.portfolioLink = fs.readFileSync(portfolioFile, 'utf8').trim();
        }
        
        const testModeFile = path.join(__dirname, 'test_mode.txt');
        if (fs.existsSync(testModeFile)) {
            config.testMode = fs.readFileSync(testModeFile, 'utf8').trim() === 'true';
        }
        
        const businessContextFile = path.join(__dirname, 'business_context.txt');
        if (fs.existsSync(businessContextFile)) {
            config.businessContext = fs.readFileSync(businessContextFile, 'utf8').trim();
        }
        
        log(`Session ${sessionId} configuration loaded`);
        log(`Test Mode: ${config.testMode}`);
        log(`Portfolio: ${config.portfolioLink}`);
        
    } catch (error) {
        log(`Error loading session config: ${error.message}`, 'ERROR');
    }
    
    return config;
}

// Configuration
const CONFIG = loadSessionConfig();

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
    let prompt = CONFIG.personality || `You are Nithin chatting casually on LinkedIn with ${contactName}. Write a short, friendly reply like you're texting a friend - keep it natural, conversational, and under 30 words. No formal business language. Be helpful but casual.`;
    
    if (CONFIG.businessContext) {
        prompt += `\n\nBusiness Context:\n${CONFIG.businessContext}`;
    }
    
    if (needsDoc) {
        prompt += "\n\nThey want to see your work/portfolio. Tell them you'll email it over, and if they haven't shared their email, casually ask for it.";
    }
    if (needsMeet) {
        prompt += "\n\nThey want to hop on a call. Sound excited and say you'll send times via email. If no email yet, ask for it in a friendly way.";
    }
    
    try {
        log(`Calling AI for response to ${contactName}...`);
        
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
            log(`AI API error ${response.status}: ${errorText}`, 'ERROR');
            return null;
        }
        
        const data = await response.json();
        log(`AI Response received: ${JSON.stringify(data).substring(0, 200)}`);
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            log(`Invalid AI response structure`, 'ERROR');
            return null;
        }
        
        let aiText = data.choices[0].message.content;
        
        if (!aiText) {
            log(`AI returned empty content`, 'ERROR');
            return null;
        }
        
        // Clean up the response
        aiText = aiText.trim();
        aiText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '');
        aiText = aiText.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
        aiText = aiText.trim();
        
        if (aiText.length === 0) {
            log(`AI content empty after cleanup`, 'ERROR');
            return null;
        }
        
        log(`AI generated response: ${aiText.length} chars`);
        return aiText;
        
    } catch (err) {
        log(`AI error: ${err.message}`, 'ERROR');
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
        log(`[TEST] Would send email to: ${toEmail} - Subject: ${subject}`);
        return { success: true, test: true };
    }
    
    try {
        const info = await emailTransporter.sendMail({
            from: CONFIG.email.from,
            to: toEmail,
            subject: subject,
            html: htmlBody
        });
        log(`Email sent successfully: ${info.messageId}`, 'SUCCESS');
        return { success: true, messageId: info.messageId };
    } catch (err) {
        log(`Email error: ${err.message}`, 'ERROR');
        return { success: false, error: err.message };
    }
}

async function findConversations(browser, page) {
    
    // Load session cookies
    try {
        // Try session directory first, then fallback to root directory
        const sessionFilePaths = [
            path.join(__dirname, 'linkedin_session.json'),
            path.join(path.dirname(__dirname), 'linkedin_session.json')
        ];
        
        let sessionLoaded = false;
        for (const sessionFilePath of sessionFilePaths) {
            if (fs.existsSync(sessionFilePath)) {
                const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
                if (sessionData.cookies && sessionData.cookies.length > 0) {
                    await page.setCookie(...sessionData.cookies);
                    log(`LinkedIn cookies loaded successfully from: ${sessionFilePath}`);
                    sessionLoaded = true;
                    break;
                }
            }
        }
        
        if (!sessionLoaded) {
            log('No LinkedIn session file found in any location', 'WARNING');
            log('Please create a LinkedIn session first using the session creator');
        }
    } catch (err) {
        log(`Could not load cookies: ${err.message}`, 'WARNING');
    }
    
    // Go to LinkedIn feed first to establish session
    log('Establishing LinkedIn session...');
    try {
        await page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        log('Session established successfully');
        await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
        log('Feed navigation issue, continuing...', 'WARNING');
    }
    
    // Now go to messaging
    log('Navigating to messaging...');
    try {
        await page.goto('https://www.linkedin.com/messaging/', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
    } catch (err) {
        log(`Failed to navigate to messaging: ${err.message}`, 'ERROR');
        throw err;
    }
    
    log('Waiting for page to load...');
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
    
    log(`Found ${conversations.length} conversations`);
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
        log(`[TEST] Would send: "${messageText.substring(0, 60)}..."`);
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
                log(`Trying selector: ${sel}`);
                await page.waitForSelector(sel, { timeout: 3000 });
                const element = await page.$(sel);
                if (element) {
                    await element.click();
                    await new Promise(r => setTimeout(r, 500));
                    await element.type(messageText, { delay: 30 });
                    log(`Message typed using: ${sel}`);
                    found = true;
                    break;
                }
            } catch (e) {
                log(`Selector failed: ${sel}`);
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
                log(`Message typed using fallback method`);
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
                log(`Found send button: ${sel}`);
                break;
            }
        }
        
        if (!sendBtn) throw new Error('Send button not found');
        
        await sendBtn.click();
        log(`Send button clicked`);
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
    
    log('='.repeat(50));
    log(`Starting LinkedIn Auto-Reply Bot for session: ${sessionId}`);
    log(`Mode: ${CONFIG.testMode ? 'TEST' : 'LIVE'}`);
    log(`Portfolio: ${CONFIG.portfolioLink}`);
    log(`Session file path: ${sessionFilePath}`);
    log(`User data directory: ${userDataDir}`);
    log('='.repeat(50));
    
    // Create user data directory if it doesn't exist
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
        log(`Created user data directory: ${userDataDir}`);
    }
    
    const browser = await puppeteer.launch({
        headless: HEADLESS,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor'
        ],
        userDataDir: userDataDir
    });
    
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    try {
        // Find conversations
        const conversations = await findConversations(browser, page);
        
        if (conversations.length === 0) {
            log('No conversations found', 'WARNING');
            await browser.close();
            return;
        }
        
        log(`Processing ${conversations.length} conversations...`);
        
        let processed = 0;
        let replied = 0;
        
        for (const conv of conversations.slice(0, 5)) { // Process first 5
            log(`Processing conversation with ${conv.name}`);
            
            try {
                // Get conversation history
                const history = await getConversationHistory(browser, conv.url);
                
                if (!history || history.length === 0) {
                    log(`No messages in conversation with ${conv.name}`);
                    continue;
                }
                
                // Find last message from them
                const lastFromThem = [...history].reverse().find(m => !m.fromMe);
                if (!lastFromThem) {
                    log(`No messages from ${conv.name}`);
                    continue;
                }
                
                // Check if already replied
                const lastIndex = history.lastIndexOf(lastFromThem);
                const alreadyReplied = history.slice(lastIndex + 1).some(m => m.fromMe);
                
                if (alreadyReplied) {
                    log(`Already replied to ${conv.name}`);
                    continue;
                }
                
                log(`New message from ${conv.name}: "${lastFromThem.text.substring(0, 60)}..."`);
                
                processed++;
                
                // Check what they need
                const wantsDoc = needsDocument(lastFromThem.text);
                const wantsMeet = needsMeeting(lastFromThem.text);
                const theirEmail = extractEmail(lastFromThem.text);
                
                log(`Document request: ${wantsDoc}, Meeting request: ${wantsMeet}, Email found: ${theirEmail || 'none'}`);
                
                // Generate AI response
                let aiReply = await generateAIResponse(lastFromThem.text, conv.name, wantsDoc, wantsMeet);
                
                // Fallback to generic message if AI fails
                if (!aiReply) {
                    log('AI failed - using fallback message', 'WARNING');
                    aiReply = generateFallbackMessage(conv.name, wantsDoc, wantsMeet);
                }
                
                log(`Generated reply: "${aiReply}"`);
                
                // Send LinkedIn reply
                let linkedInSent = false;
                try {
                    await sendLinkedInMessage(browser, conv.url, aiReply);
                    log(`LinkedIn reply sent to ${conv.name}`, 'SUCCESS');
                    linkedInSent = true;
                    replied++;
                } catch (err) {
                    log(`LinkedIn reply failed for ${conv.name}: ${err.message}`, 'ERROR');
                    log('Continuing with email sending...');
                }
                
                await new Promise(r => setTimeout(r, 2000));
                
                // Send email if needed (independent of LinkedIn success)
                if (wantsDoc && theirEmail) {
                    log(`Sending portfolio email to ${theirEmail}`);
                    
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
                }
                
                // Send meeting email if needed
                if (wantsMeet && theirEmail) {
                    log(`Sending meeting times to ${theirEmail}`);
                    
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
                }
                
                await new Promise(r => setTimeout(r, 3000));
                
            } catch (err) {
                log(`Error processing ${conv.name}: ${err.message}`, 'ERROR');
            }
        }
        
        log('='.repeat(50));
        log(`SUMMARY - Session: ${sessionId}`);
        log(`Conversations found: ${conversations.length}`);
        log(`Processed: ${processed}`);
        log(`Replied: ${replied}`);
        log('='.repeat(50));
        
    } catch (error) {
        log(`Bot error: ${error.message}`, 'ERROR');
    } finally {
        log('Bot session ending in 10 seconds...');
        await new Promise(r => setTimeout(r, 10000));
        await browser.close();
        log('LinkedIn bot session completed');
    }
}

runBot().catch(console.error);
