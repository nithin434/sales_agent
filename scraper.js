// scraper.js - LinkedIn Auto-Reply Bot with Session Management
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
class LinkedInAutoReplyBot {
    constructor(options = {}) {
        this.sessionFilePath = options.sessionFilePath || path.join(__dirname, 'linkedin_session.json');
        this.userDataDir = options.userDataDir || path.join(__dirname, 'linkedin_user_data');
        this.apiKey = options.apiKey || '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';
        this.browser = null;
        this.page = null;
        this.testMode = options.testMode || false;
        this.headless = options.headless !== undefined ? options.headless : false;
        
        // Email configuration
        this.emailConfig = {
            from_email: options.emailFrom || "nithinjambula89@gmail.com",
            from_password: options.emailPassword || "qyum bzzh dmxn yivo",
            smtp_server: options.smtpServer || "smtp.gmail.com",
            smtp_port: options.smtpPort || 587
        };
        
        // Initialize email transporter
        this.emailTransporter = nodemailer.createTransport({
            host: this.emailConfig.smtp_server,
            port: this.emailConfig.smtp_port,
            secure: false,
            auth: {
                user: this.emailConfig.from_email,
                pass: this.emailConfig.from_password
            }
        });
    }
    async loadLinkedInSession() {
        try {
            if (!fs.existsSync(this.sessionFilePath)) {
                console.log('📝 No saved LinkedIn session found. Run: node manual_session_creator.js');
                return null;
            }
            const sessionData = JSON.parse(fs.readFileSync(this.sessionFilePath, 'utf8'));
            
            // Check if session is not too old (7 days)
            const sessionAge = Date.now() - sessionData.timestamp;
            if (sessionAge > 7 * 24 * 60 * 60 * 1000) {
                console.log('⏰ Saved session is too old (>7 days). Run: node manual_session_creator.js');
                return null;
            }
            console.log(`✅ Loaded LinkedIn session with ${sessionData.cookies ? sessionData.cookies.length : 0} cookies`);
            return sessionData;
        } catch (error) {
            console.error('❌ Error loading session:', error.message);
            return null;
        }
    }
    async init() {
        console.log('🚀 Initializing LinkedIn Auto-Reply Bot...');
        
        const launchOptions = {
            headless: this.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ],
            userDataDir: this.userDataDir
        };
        console.log('🔐 Launching with LinkedIn session support...');
        this.browser = await puppeteer.launch(launchOptions);
        // Load and apply LinkedIn cookies if available
        const sessionData = await this.loadLinkedInSession();
        if (sessionData && sessionData.cookies) {
            const pages = await this.browser.pages();
            this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
            
            // Set cookies
            await this.page.setCookie(...sessionData.cookies);
            console.log('🍪 LinkedIn cookies loaded successfully!');
        } else {
            this.page = await this.browser.newPage();
        }
        // Verify login
        console.log('🔐 Checking LinkedIn login status...');
        await this.page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded',
            timeout: 120000
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
        const isLoggedIn = await this.verifyLogin();
        if (!isLoggedIn) {
            console.error('❌ Not logged in to LinkedIn!');
            console.log('💡 Please run: node manual_session_creator.js');
            await this.page.screenshot({ path: 'debug_not_logged_in.png' });
            throw new Error('LinkedIn login required. Run manual_session_creator.js first.');
        }
        console.log('✅ LinkedIn login verified!');
    }
    async verifyLogin() {
        try {
            const currentUrl = this.page.url();
            
            if (currentUrl.includes('login') || currentUrl.includes('checkpoint') || currentUrl.includes('authwall')) {
                return false;
            }
            // Try multiple login verification selectors
            const loginSelectors = [
                '[data-test-global-nav-me]',
                '.global-nav__me',
                'a[href*="/in/"]',
                '.nav-item__profile-member-photo'
            ];
            for (const selector of loginSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 5000 });
                    return true;
                } catch (e) {
                    continue;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    }
    async getConversations() {
        console.log('\n🌐 Navigating to LinkedIn messaging...');
        await this.page.goto('https://www.linkedin.com/messaging/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        console.log('⏳ Waiting for conversations to load...');
        await new Promise(resolve => setTimeout(resolve, 8000));
        
        // Try to click on messaging to ensure it's active
        try {
            const msgButton = await this.page.$('a[href*="/messaging/"]');
            if (msgButton) await msgButton.click();
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (e) {
            // Continue anyway
        }
        
        // Scroll to load conversations
        await this.page.evaluate(() => {
            const scrollContainer = document.querySelector('.msg-conversations-container__conversations-list, .scaffold-layout__list-detail-inner, .msg-overlay-list-bubble__conversations-list');
            if (scrollContainer) {
                scrollContainer.scrollTop = 0;
                scrollContainer.scrollTop = scrollContainer.scrollHeight / 2;
            }
            window.scrollTo(0, document.body.scrollHeight / 2);
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Take screenshot for debugging
        await this.page.screenshot({ path: 'debug_conversations.png', fullPage: true });
        const conversations = await this.page.evaluate(() => {
            const convList = [];
            
            // Try multiple selector strategies
            const selectorStrategies = [
                // Strategy 1: Standard conversation list items
                () => document.querySelectorAll('ul.msg-conversations-container__conversations-list > li'),
                // Strategy 2: Any list item with conversation data
                () => document.querySelectorAll('li[data-control-name="view_conversation"]'),
                // Strategy 3: Conversation cards
                () => document.querySelectorAll('.msg-conversation-card__row'),
                // Strategy 4: Any element with msg-conversation-listitem class
                () => document.querySelectorAll('[class*="msg-conversation-listitem"]'),
                // Strategy 5: Direct children of conversation list
                () => {
                    const list = document.querySelector('.msg-conversations-container__conversations-list, .scaffold-layout__list, .msg-overlay-list-bubble__conversations-list');
                    return list ? list.children : [];
                },
                // Strategy 6: All links in messaging that lead to threads
                () => {
                    const links = document.querySelectorAll('a[href*="/messaging/thread/"]');
                    const parents = [];
                    links.forEach(link => {
                        let parent = link;
                        for (let i = 0; i < 5; i++) {
                            parent = parent.parentElement;
                            if (parent && parent.tagName === 'LI') {
                                parents.push(parent);
                                break;
                            }
                        }
                    });
                    return parents;
                }
            ];
            let convItems = [];
            for (let i = 0; i < selectorStrategies.length; i++) {
                try {
                    convItems = selectorStrategies[i]();
                    console.log(`Strategy ${i + 1}: found ${convItems.length} items`);
                    if (convItems.length > 0) {
                        console.log(`Using strategy ${i + 1}`);
                        break;
                    }
                } catch (e) {
                    console.error(`Strategy ${i + 1} error:`, e.message);
                }
            }
            if (convItems.length === 0) {
                console.log('DEBUG: Trying to find ANY conversation-related elements...');
                const allLinks = document.querySelectorAll('a');
                console.log(`Total links on page: ${allLinks.length}`);
                let msgLinks = 0;
                allLinks.forEach(link => {
                    if (link.href && link.href.includes('/messaging/')) {
                        msgLinks++;
                        console.log(`Message link found: ${link.href.substring(0, 100)}`);
                    }
                });
                console.log(`Links with /messaging/: ${msgLinks}`);
            }
            Array.from(convItems).forEach((conv, idx) => {
                try {
                    // Try multiple name selector patterns
                    let nameEl = conv.querySelector('.msg-conversation-listitem__participant-names') ||
                                conv.querySelector('.msg-conversation-card__participant-names') ||
                                conv.querySelector('h3') ||
                                conv.querySelector('[class*="participant-name"]') ||
                                conv.querySelector('span[dir="ltr"]');
                    
                    // Try multiple snippet selectors
                    let snippetEl = conv.querySelector('.msg-conversation-listitem__message-snippet') ||
                                   conv.querySelector('.msg-conversation-card__message-snippet') ||
                                   conv.querySelector('p[class*="snippet"]') ||
                                   conv.querySelector('[class*="message-snippet"]');
                    
                    let timeEl = conv.querySelector('time');
                    
                    // Get conversation link
                    let link = conv.querySelector('a[href*="/messaging/thread/"]') || 
                              conv.querySelector('a');
                    
                    let conversationId = conv.getAttribute('data-conversation-id') || '';
                    let conversationUrl = '';
                    
                    if (link && link.href) {
                        conversationUrl = link.href;
                        if (!conversationId && conversationUrl.includes('/messaging/thread/')) {
                            const match = conversationUrl.match(/\/messaging\/thread\/([^\/\?]+)/);
                            if (match) conversationId = match[1];
                        }
                    } else if (conversationId) {
                        conversationUrl = `https://www.linkedin.com/messaging/thread/${conversationId}/`;
                    }
                    if (conversationUrl) {
                        const contactName = nameEl ? nameEl.innerText.trim() : `Contact ${idx + 1}`;
                        convList.push({
                            contactName: contactName,
                            lastMessage: snippetEl ? snippetEl.innerText.trim() : '',
                            timestamp: timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString(),
                            conversationUrl: conversationUrl,
                            conversationId: conversationId
                        });
                        console.log(`✓ Added: ${contactName}`);
                    } else {
                        console.log(`✗ Skipped item ${idx + 1}: no URL`);
                    }
                } catch (e) {
                    console.error(`Error parsing conv ${idx}:`, e.message);
                }
            });
            return convList;
        });
        console.log(`✅ Found ${conversations.length} conversations`);
        
        if (conversations.length === 0) {
            console.log('⚠️ No conversations found - check debug_conversations.png');
            console.log('💡 Try these steps:');
            console.log('   1. Open LinkedIn messaging manually and verify conversations exist');
            console.log('   2. Check if LinkedIn updated their UI structure');
            console.log('   3. Review debug_conversations.png for actual page state');
        }
        
        return conversations;
    }
    async getConversationHistory(conversationUrl) {
        const page = await this.browser.newPage();
        
        try {
            await page.goto(conversationUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Scroll to load all messages
            await page.evaluate(() => {
                const msgContainer = document.querySelector('.msg-s-message-list-container, .msg-s-event-listitem__container');
                if (msgContainer) msgContainer.scrollTop = 0;
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
            const history = await page.evaluate(() => {
                const messages = [];
                const msgItems = document.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event');
                
                msgItems.forEach((msg) => {
                    const textEl = msg.querySelector('.msg-s-event-listitem__body, p, .msg-s-message-group__text');
                    const timeEl = msg.querySelector('time');
                    const fromMe = msg.className.includes('msg-s-event-listitem--me');
                    
                    if (textEl) {
                        messages.push({
                            text: textEl.innerText.trim(),
                            timestamp: timeEl ? timeEl.getAttribute('datetime') : '',
                            fromMe: fromMe
                        });
                    }
                });
                
                return messages;
            });
            await page.close();
            return history;
        } catch (err) {
            await page.close();
            throw err;
        }
    }
    
    extractEmailFromMessage(message) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = message.match(emailRegex);
        return emails ? emails[0] : null;
    }
    
    extractURLsFromMessage(message) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return message.match(urlRegex) || [];
    }
    
    needsDocumentOrInfo(message) {
        const keywords = [
            'send me', 'share', 'document', 'portfolio', 'resume', 
            'cv', 'profile', 'link', 'details', 'information',
            'proposal', 'quote', 'pricing', 'can you send'
        ];
        const lowerMsg = message.toLowerCase();
        return keywords.some(keyword => lowerMsg.includes(keyword));
    }
    
    needsMeeting(message) {
        const keywords = [
            'meeting', 'call', 'schedule', 'discuss', 'talk',
            'available', 'time', 'appointment', 'zoom', 'meet'
        ];
        const lowerMsg = message.toLowerCase();
        return keywords.some(keyword => lowerMsg.includes(keyword));
    }
    
    async sendEmail(toEmail, subject, body, attachments = []) {
        try {
            const mailOptions = {
                from: this.emailConfig.from_email,
                to: toEmail,
                subject: subject,
                html: body,
                attachments: attachments
            };
            if (this.testMode) {
                console.log(`   📧 [TEST] Would send email to: ${toEmail}`);
                console.log(`   Subject: ${subject}`);
                return { success: true, test: true };
            }
            const info = await this.emailTransporter.sendMail(mailOptions);
            console.log(`   ✅ Email sent to ${toEmail}: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (err) {
            console.error(`   ❌ Email error: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
    
    generateMeetingTimes() {
        const times = [];
        const now = new Date();
        
        // Generate next 5 business days, 10 AM and 2 PM slots
        for (let i = 1; i <= 5; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() + i);
            
            // Skip weekends
            if (date.getDay() === 0 || date.getDay() === 6) continue;
            
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            times.push(`${dateStr} at 10:00 AM`);
            times.push(`${dateStr} at 2:00 PM`);
        }
        
        return times.slice(0, 5); // Return 5 options
    }
    isSeriousQuery(message) {
        const lowerMsg = message.toLowerCase().trim();
        
        // Filter out simple greetings
        const casualPatterns = [
            /^hi$/i, /^hello$/i, /^hey$/i, /^hi there$/i,
            /^bye$/i, /^thanks$/i, /^thank you$/i,
            /^ok$/i, /^okay$/i, /^cool$/i, /^nice$/i
        ];
        
        for (const pattern of casualPatterns) {
            if (pattern.test(lowerMsg)) return false;
        }
        
        // Check for serious indicators
        const seriousIndicators = [
            '?', 'can you', 'could you', 'would you',
            'please', 'help', 'need', 'want', 'interested',
            'looking for', 'tell me', 'send me', 'share',
            'information', 'details', 'about',
            'when', 'where', 'how', 'why', 'what'
        ];
        
        for (const indicator of seriousIndicators) {
            if (lowerMsg.includes(indicator)) return true;
        }
        
        return message.trim().length > 20;
    }
    async generateAIResponse(message, contactName, relationshipLevel = 'professional', customPrompt = null) {
        const defaultPrompt = `You are responding as a personal assistant. The contact's name is ${contactName}. Relationship level: ${relationshipLevel}. Keep responses friendly, natural, and under 50 words.`;
        
        const systemPrompt = customPrompt || defaultPrompt;
        
        // Check if they need documents or meeting
        const needsDoc = this.needsDocumentOrInfo(message);
        const needsMeet = this.needsMeeting(message);
        
        let enhancedPrompt = systemPrompt;
        if (needsDoc) {
            enhancedPrompt += "\n\nThe person is requesting documents/information. Acknowledge this and mention you'll send details via email shortly. Ask for their email if not provided.";
        }
        if (needsMeet) {
            enhancedPrompt += "\n\nThe person wants to schedule a meeting. Express interest and suggest some time slots (mention you can do calls this week).";
        }
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "model": "deepseek/deepseek-r1:free",
                    "messages": [
                        {
                            "role": "system",
                            "content": enhancedPrompt
                        },
                        {
                            "role": "user",
                            "content": message
                        }
                    ]
                })
            });
            const data = await response.json();
            
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            } else {
                throw new Error('Invalid AI response');
            }
        } catch (err) {
            console.error('   ❌ AI generation error:', err.message);
            return null;
        }
    }
    async sendMessage(conversationUrl, messageText) {
        const page = await this.browser.newPage();
        
        try {
            await page.goto(conversationUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Find and click message input
            const inputSelectors = [
                '.msg-form__contenteditable',
                '.msg-form__msg-content-container--scrollable',
                '[contenteditable="true"]'
            ];
            let inputFound = false;
            for (const selector of inputSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    await page.click(selector);
                    await page.keyboard.type(messageText);
                    inputFound = true;
                    break;
                } catch (e) {
                    continue;
                }
            }
            if (!inputFound) {
                throw new Error('Could not find message input');
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            // Click send button
            const sendButton = await page.$('.msg-form__send-button, button[type="submit"]');
            if (sendButton) {
                await sendButton.click();
                await new Promise(resolve => setTimeout(resolve, 1500));
            } else {
                throw new Error('Could not find send button');
            }
            await page.close();
            return { success: true };
        } catch (err) {
            await page.close();
            throw err;
        }
    }
    async runBot(options = {}) {
        const {
            maxReplies = 5,
            hoursRecent = 24,
            relationshipLevel = 'professional',
            customPrompt = null
        } = options;
        console.log('\n=== LinkedIn Auto-Reply Bot ===');
        console.log(`⏰ Processing messages from last ${hoursRecent} hours`);
        if (this.testMode) {
            console.log('🧪 TEST MODE: Will not send actual messages\n');
        }
        const conversations = await this.getConversations();
        if (conversations.length === 0) {
            console.log('⚠️ No conversations found');
            return { totalConversations: 0, processedCount: 0, repliesSent: 0 };
        }
        let repliesCount = 0;
        let processedCount = 0;
        for (const conv of conversations) {
            if (repliesCount >= maxReplies) {
                console.log('\n⚠️ Reached maximum replies limit');
                break;
            }
            console.log(`\n📌 ${conv.contactName}`);
            if (!conv.conversationUrl) {
                console.log('   ❌ Invalid conversation URL');
                continue;
            }
            // Check message age
            if (conv.timestamp) {
                const messageTime = new Date(conv.timestamp);
                const hoursSince = (Date.now() - messageTime.getTime()) / (1000 * 60 * 60);
                
                if (hoursSince > hoursRecent) {
                    console.log(`   ⏭️ Too old (${hoursSince.toFixed(0)}h ago)`);
                    continue;
                }
            }
            // Get conversation history
            let history;
            try {
                history = await this.getConversationHistory(conv.conversationUrl);
            } catch (err) {
                console.log(`   ❌ Failed to load conversation: ${err.message}`);
                continue;
            }
            if (!history || history.length === 0) {
                console.log('   ⏭️ No message history');
                continue;
            }
            // Get last message from them
            const lastMessageFromThem = [...history].reverse().find(m => !m.fromMe);
            
            if (!lastMessageFromThem) {
                console.log('   ⏭️ No messages from contact');
                continue;
            }
            // Check if already replied
            const lastMessageIndex = history.lastIndexOf(lastMessageFromThem);
            const repliedAfter = history.slice(lastMessageIndex + 1).some(m => m.fromMe);
            
            if (repliedAfter) {
                console.log('   ⏭️ Already replied');
                continue;
            }
            const msgPreview = lastMessageFromThem.text.substring(0, 60);
            // console.log(`   📨 "${msgPreview}${lastMessageFromThem.text.length > 60 ? '...' : '"}"`);
            // Check if serious query
            if (!this.isSeriousQuery(lastMessageFromThem.text)) {
                console.log('   ⏭️ Casual message (not a query)');
                continue;
            }
            console.log('   ✅ Serious query detected');
            processedCount++;
            
            // Check if email or meeting requested
            const needsDoc = this.needsDocumentOrInfo(lastMessageFromThem.text);
            const needsMeet = this.needsMeeting(lastMessageFromThem.text);
            const extractedEmail = this.extractEmailFromMessage(lastMessageFromThem.text);
            const extractedURLs = this.extractURLsFromMessage(lastMessageFromThem.text);
            // Generate AI response
            const aiReply = await this.generateAIResponse(
                lastMessageFromThem.text,
                conv.contactName,
                relationshipLevel,
                customPrompt
            );
            if (aiReply) {
                const replyPreview = aiReply.substring(0, 60);
                console.log(`   🤖 Generated: "${replyPreview}${aiReply.length > 60 ? '...' : ''}"`);
                // Send reply
                if (this.testMode) {
                    console.log('   🧪 TEST MODE - Would send reply');
                    repliesCount++;
                } else {
                    try {
                        await this.sendMessage(conv.conversationUrl, aiReply);
                        console.log('   ✅ Reply sent successfully');
                        repliesCount++;
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    } catch (sendErr) {
                        console.log(`   ❌ Send failed: ${sendErr.message}`);
                    }
                }
                
                // Handle email follow-up if document/info requested
                if (needsDoc && extractedEmail) {
                    console.log(`   📧 Document requested - preparing email to ${extractedEmail}`);
                    
                    const emailSubject = `Information Request - ${conv.contactName}`;
                    const emailBody = `
                        <html>
                        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                            <h2>Hi ${conv.contactName},</h2>
                            <p>Thank you for your interest! As promised, here's the information you requested:</p>
                            
                            <h3>Our Services:</h3>
                            <ul>
                                <li>Custom Software Development</li>
                                <li>Web & Mobile App Development</li>
                                <li>AI/ML Integration</li>
                                <li>Cloud Solutions & DevOps</li>
                                <li>MVP Development for Startups</li>
                            </ul>
                            
                            <h3>Portfolio & Case Studies:</h3>
                            <p>Visit our portfolio: <a href="https://your-portfolio-link.com">View Projects</a></p>
                            
                            ${extractedURLs.length > 0 ? `
                            <h3>Referenced Links:</h3>
                            <ul>
                                ${extractedURLs.map(url => `<li><a href="${url}">${url}</a></li>`).join('')}
                            </ul>
                            ` : ''}
                            
                            <h3>Next Steps:</h3>
                            <p>I'd love to discuss your project in detail. Feel free to reply to this email or schedule a call at your convenience.</p>
                            
                            <p>Best regards,<br>
                            Nithin<br>
                            ${this.emailConfig.from_email}</p>
                        </body>
                        </html>
                    `;
                    
                    await this.sendEmail(extractedEmail, emailSubject, emailBody);
                }
                
                // Handle meeting request
                if (needsMeet) {
                    console.log('   📅 Meeting requested - suggesting times');
                    const meetingTimes = this.generateMeetingTimes();
                    
                    if (extractedEmail) {
                        const meetingSubject = `Meeting Request - ${conv.contactName}`;
                        const meetingBody = `
                            <html>
                            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                                <h2>Hi ${conv.contactName},</h2>
                                <p>Great to hear from you! I'd be happy to schedule a call to discuss your project.</p>
                                
                                <h3>Available Time Slots:</h3>
                                <ul>
                                    ${meetingTimes.map(time => `<li>${time}</li>`).join('')}
                                </ul>
                                
                                <p>Please let me know which time works best for you, or suggest an alternative time.</p>
                                
                                <p><strong>Meeting Details:</strong></p>
                                <ul>
                                    <li>Duration: 30-45 minutes</li>
                                    <li>Platform: Zoom/Google Meet (link will be shared)</li>
                                    <li>Agenda: Discuss your project requirements and how we can help</li>
                                </ul>
                                
                                <p>Looking forward to speaking with you!</p>
                                
                                <p>Best regards,<br>
                                Nithin<br>
                                ${this.emailConfig.from_email}</p>
                            </body>
                            </html>
                        `;
                        
                        await this.sendEmail(extractedEmail, meetingSubject, meetingBody);
                    }
                }
            } else {
                console.log('   ❌ AI generation failed');
            }
        }
        return {
            totalConversations: conversations.length,
            processedCount: processedCount,
            repliesSent: repliesCount
        };
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Browser closed');
        }
    }
}
// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    let testMode = true; // Default to test mode
    let maxReplies = 5;
    let hoursRecent = 24;
    for (const arg of args) {
        if (arg === '--live') {
            testMode = false;
        } else if (arg.startsWith('--max=')) {
            maxReplies = parseInt(arg.split('=')[1], 10) || 5;
        } else if (arg.startsWith('--hours=')) {
            hoursRecent = parseInt(arg.split('=')[1], 10) || 24;
        }
    }
    const bot = new LinkedInAutoReplyBot({ testMode });
    try {
        await bot.init();
        
        const results = await bot.runBot({
            maxReplies,
            hoursRecent,
            relationshipLevel: 'professional'
        });
        console.log('\n=== Bot Summary ===');
        console.log(`Total conversations: ${results.totalConversations}`);
        console.log(`Serious queries processed: ${results.processedCount}`);
        console.log(`Replies sent: ${results.repliesSent}`);
        await bot.close();
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        await bot.close();
        process.exit(1);
    }
}
if (require.main === module) {
    main().catch(console.error);
}
module.exports = LinkedInAutoReplyBot;

