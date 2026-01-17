// filepath: c:\Users\nithi\Downloads\GEt__-main\GEt\manual_session_creator.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Timeout configurations (in milliseconds)
const TIMEOUTS = {
    PAGE_LOAD: 120000,    // 2 minutes for page navigation
    ELEMENT_WAIT: 10000,  // 10 seconds for element selection
    LOGIN_CHECK: 5000     // 5 seconds between login checks
};

class LinkedInSessionCreator {
    constructor() {
        this.sessionFilePath = path.join(__dirname, 'linkedin_session.json');
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async saveSession() {
        try {
            const cookies = await this.context.cookies();
            const sessionData = {
                cookies: cookies,
                timestamp: Date.now(),
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
            
            fs.writeFileSync(this.sessionFilePath, JSON.stringify(sessionData, null, 2));
            console.log('✅ Session saved successfully!');
            return true;
        } catch (error) {
            console.error('❌ Error saving session:', error.message);
            return false;
        }
    }

    async loadSession() {
        try {
            if (!fs.existsSync(this.sessionFilePath)) {
                console.log('📝 No saved session found. Manual login required.');
                return null;
            }

            const sessionData = JSON.parse(fs.readFileSync(this.sessionFilePath, 'utf8'));
            
            // Check if session is not too old (7 days)
            const sessionAge = Date.now() - sessionData.timestamp;
            if (sessionAge > 7 * 24 * 60 * 60 * 1000) {
                console.log('⏰ Saved session is too old. Manual login required.');
                return null;
            }

            return sessionData;
        } catch (error) {
            console.error('❌ Error loading session:', error.message);
            return null;
        }
    }

    async isLoggedIn() {
        try {
            // Multiple selectors to check for login status
            const loginSelectors = [
                '[data-test-global-nav-me]',
                '.global-nav__me',
                '.global-nav__me-content',
                '[data-control-name="nav.settings_and_privacy"]',
                '.nav-item__profile-member-photo'
            ];

            for (const selector of loginSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: TIMEOUTS.ELEMENT_WAIT });
                    console.log('✅ Successfully verified login status!');
                    return true;
                } catch (e) {
                    // Continue to next selector
                }
            }

            // Check if we're on login page
            const currentUrl = this.page.url();
            if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
                console.log('🔐 Login required - currently on login page');
                return false;
            }

            // Check for profile link in navigation
            try {
                await this.page.waitForSelector('a[href*="/in/"]', { timeout: TIMEOUTS.ELEMENT_WAIT });
                console.log('✅ Login verified via profile link!');
                return true;
            } catch (e) {
                console.log('❌ Login verification failed');
                return false;
            }

        } catch (error) {
            console.log('❌ Login verification failed:', error.message);
            return false;
        }
    }

    async createSession() {
        this.browser = await chromium.launch({
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        
        // Try to load existing session
        const sessionData = await this.loadSession();
        
        this.context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        // Load saved cookies if available
        if (sessionData && sessionData.cookies) {
            await this.context.addCookies(sessionData.cookies);
            console.log(`🔄 Loaded ${sessionData.cookies.length} saved cookies`);
        }
        
        this.page = await this.context.newPage();
        
        console.log('🌐 Navigating to LinkedIn...');
        await this.page.goto('https://www.linkedin.com/feed/', { 
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUTS.PAGE_LOAD 
        });
        
        // Wait a bit for the page to load
        await this.page.waitForTimeout(3000);
        
        const isLoggedIn = await this.isLoggedIn();
        
        if (!isLoggedIn) {
            console.log('🔐 Manual login required. Please log in manually in the browser window...');
            console.log('⏳ Waiting for you to complete login...');
            
            // Wait for successful login
            let loginSuccessful = false;
            while (!loginSuccessful) {
                await this.page.waitForTimeout(TIMEOUTS.LOGIN_CHECK);
                loginSuccessful = await this.isLoggedIn();
                
                if (loginSuccessful) {
                    console.log('🎉 Login detected! Saving session...');
                    await this.saveSession();
                } else {
                    console.log('⏳ Still waiting for login completion...');
                }
            }
        } else {
            console.log('🎉 Already logged in! Session restored successfully.');
        }
        
        return this.page;
    }

    async keepSessionAlive() {
        console.log('🚀 Session is ready! Browser window will stay open.');
        console.log('💡 You can now use this session for scraping or manual browsing.');
        console.log('🛑 Press Ctrl+C to close and save the session...');
        
        process.on('SIGINT', async () => {
            console.log('\n💾 Saving session before closing...');
            await this.saveSession();
            console.log('🔒 Closing browser...');
            await this.browser.close();
            console.log('👋 Session closed successfully!');
            process.exit(0);
        });
        
        // Periodically save session (every 30 minutes)
        setInterval(async () => {
            console.log('💾 Auto-saving session...');
            await this.saveSession();
        }, 30 * 60 * 1000);
        
        // Keep process alive
        setInterval(() => {}, 1000);
    }

    // Method to get page instance for scraping
    getPage() {
        return this.page;
    }

    // Method to get context for advanced operations
    getContext() {
        return this.context;
    }
}

// Usage
async function main() {
    const sessionCreator = new LinkedInSessionCreator();
    
    try {
        await sessionCreator.createSession();
        await sessionCreator.keepSessionAlive();
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = LinkedInSessionCreator;
