// lead_generator.js - Intelligent Lead Generation System for Software Development Clients
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const fsSynch = require('fs');
const path = require('path');

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
        keywords: ['software development', 'web development', 'mobile app'],
        location: 'San Francisco',
        maxLeads: 50,
        outputFile: 'leads_report.json'
    };
    
    try {
        // Load configuration from files
        const keywordsFile = path.join(__dirname, 'keywords.txt');
        if (fsSynch.existsSync(keywordsFile)) {
            const keywordsText = fsSynch.readFileSync(keywordsFile, 'utf8').trim();
            config.keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k);
        }
        
        const locationFile = path.join(__dirname, 'location.txt');
        if (fsSynch.existsSync(locationFile)) {
            config.location = fsSynch.readFileSync(locationFile, 'utf8').trim();
        }
        
        const maxLeadsFile = path.join(__dirname, 'max_leads.txt');
        if (fsSynch.existsSync(maxLeadsFile)) {
            config.maxLeads = parseInt(fsSynch.readFileSync(maxLeadsFile, 'utf8').trim()) || 50;
        }
        
        log(`Session config loaded: Keywords: ${config.keywords.join(', ')}, Location: ${config.location}, Max: ${config.maxLeads}`);
        return config;
    } catch (err) {
        log(`Config loading error: ${err.message}`, 'WARNING');
        return config;
    }
}

class LeadGenerator {
  constructor(options = {}) {
    this.browser = null;
    this.headless = options.headless !== undefined ? options.headless : HEADLESS;
    this.apiKey = options.apiKey || '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';
    this.sessionFilePath = options.sessionFilePath || path.join(__dirname, 'linkedin_session.json');
    this.userDataDir = options.userDataDir || path.join(__dirname, 'linkedin_user_data');
    this.sessionId = sessionId;
    this.sanitizedSessionId = sanitizedSessionId;
    
    log(`Lead Generator initialized for session: ${this.sessionId}`);
  }

  async loadLinkedInSession() {
    try {
      if (!fsSynch.existsSync(this.sessionFilePath)) {
        log('No saved LinkedIn session found');
        return null;
      }

      const sessionData = JSON.parse(fsSynch.readFileSync(this.sessionFilePath, 'utf8'));
      
      // Check if session is not too old (7 days)
      const sessionAge = Date.now() - sessionData.timestamp;
      if (sessionAge > 7 * 24 * 60 * 60 * 1000) {
        log('Saved session is too old (>7 days)', 'WARNING');
        return null;
      }

      log(`Loaded LinkedIn session with ${sessionData.cookies ? sessionData.cookies.length : 0} cookies`);
      return sessionData;
    } catch (error) {
      log(`Error loading session: ${error.message}`, 'ERROR');
      return null;
    }
  }

  async init() {
    const launchOptions = {
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ],
      userDataDir: this.userDataDir
    };

    log('Launching browser with LinkedIn session support...');
    this.browser = await puppeteer.launch(launchOptions);

    // Load and apply LinkedIn cookies if available
    const sessionData = await this.loadLinkedInSession();
    if (sessionData && sessionData.cookies) {
      const pages = await this.browser.pages();
      const page = pages.length > 0 ? pages[0] : await this.browser.newPage();
      
      // Set cookies
      await page.setCookie(...sessionData.cookies);
      log('LinkedIn cookies loaded successfully!');
    }
  }

  async searchLinkedInLeads(keywords = [], location = '', jobTitles = []) {
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    try {
      const leads = [];
      
      // First check if we're logged in with retry
      console.log('🔐 Checking LinkedIn login status...');
      
      let loginSuccess = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          
          await new Promise(resolve => setTimeout(resolve, 5000));
          loginSuccess = true;
          break;
        } catch (err) {
          console.log(`   Retry ${attempt}/2...`);
          if (attempt === 2) throw err;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      const currentUrl = page.url();
      
      if (currentUrl.includes('login') || currentUrl.includes('checkpoint') || currentUrl.includes('authwall')) {
        console.error('❌ Not logged in to LinkedIn! Please run: node manual_session_creator.js');
        await page.screenshot({ path: 'debug_linkedin_login_required.png' });
        await page.close();
        return [];
      }

      console.log('✅ LinkedIn login verified!');
      
      // Search each keyword separately for better results
      const searchQueries = [];
      
      // Create search queries for each keyword
      for (const keyword of keywords) {
        searchQueries.push(`${keyword} ${location}`);
        searchQueries.push(`looking for ${keyword}`);
        searchQueries.push(`hiring ${keyword} developer`);
      }

      for (const query of searchQueries.slice(0, 8)) {
        console.log(`🔍 Searching: "${query}"`);
        
        try {
          // Search in Posts instead of People
          await page.goto(`https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });

          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Scroll to load more content
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await new Promise(resolve => setTimeout(resolve, 3000));

          const searchResults = await page.evaluate(() => {
            const results = [];
            
            // Get all profile links
            const profileLinks = document.querySelectorAll('a[href*="/in/"]');
            console.log(`Found ${profileLinks.length} profile links`);
            
            profileLinks.forEach((link, idx) => {
              if (idx >= 30) return;
              
              try {
                const parent = link.closest('li, div[class*="result"], article, div[class*="entity"]');
                if (!parent) return;
                
                const text = parent.innerText || '';
                if (text.length < 30) return;
                
                // Get name from link
                const name = link.innerText.trim();
                if (!name || name.length < 2) return;
                
                // Extract contact info
                const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                const phoneMatch = text.match(/\+?\d[\d\s\-\.\(\)]{8,}/);
                
                results.push({
                  name: name,
                  title: '',
                  company: '',
                  profileUrl: link.href,
                  snippet: text.substring(0, 300),
                  location: '',
                  email: emailMatch ? emailMatch[0] : '',
                  phone: phoneMatch ? phoneMatch[0] : '',
                  source: 'LinkedIn'
                });
              } catch (e) {
                // Skip errors
              }
            });
            
            return results;
          });

          console.log(`   Found ${searchResults.length} results`);
          leads.push(...searchResults);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
          console.log(`   Query failed: ${err.message}`);
        }
      }

      await page.close();
      return this.deduplicateLeads(leads);
      
    } catch (err) {
      console.error('LinkedIn search error:', err.message);
      await page.screenshot({ path: 'debug_linkedin_error.png' }).catch(() => {});
      await page.close();
      return [];
    }
  }

  async searchGoogleLeads(keywords = [], location = '') {
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    try {
      const leads = [];
      
      const searchQueries = [];
      
      // Search each keyword separately with varied queries
      for (const keyword of keywords) {
        searchQueries.push(`${keyword} developer ${location}`);
        searchQueries.push(`${keyword} startup ${location}`);
        searchQueries.push(`site:reddit.com/r/forhire ${keyword}`);
        searchQueries.push(`site:linkedin.com "${keyword}" hiring`);
      }

      for (const query of searchQueries.slice(0, 10)) {
        console.log(`🌐 Google: "${query}"`);
        
        try {
          await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=30`, {
            waitUntil: 'domcontentloaded',
            timeout: 25000
          });

          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Scroll to load more results
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
          await new Promise(resolve => setTimeout(resolve, 1000));
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await new Promise(resolve => setTimeout(resolve, 2000));

          const results = await page.evaluate(() => {
            const items = [];
            
            // Get all h3 titles (main search results)
            const h3Elements = document.querySelectorAll('h3');
            
            h3Elements.forEach((h3, idx) => {
              if (items.length >= 20) return;
              
              try {
                const link = h3.closest('a');
                if (!link || !link.href) return;
                
                const href = link.href;
                
                // Skip Google internal links
                if (href.includes('google.com') || href.startsWith('#')) return;
                
                const container = h3.closest('div[data-hveid], div.g, div[jscontroller]');
                const title = h3.innerText.trim();
                
                if (!title || title.length < 5) return;
                
                let snippet = '';
                if (container) {
                  const allText = container.innerText;
                  snippet = allText.replace(title, '').trim().substring(0, 300);
                }
                
                // Extract contact info
                const fullText = snippet + ' ' + title;
                const emailMatch = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                const phoneMatch = fullText.match(/\+?\d[\d\s\-\.\(\)]{8,}/);
                
                items.push({
                  title: title.substring(0, 200),
                  url: href,
                  snippet: snippet,
                  email: emailMatch ? emailMatch[0] : '',
                  phone: phoneMatch ? phoneMatch[0] : '',
                  source: href.includes('reddit.com') ? 'Reddit' : 
                         href.includes('linkedin.com') ? 'LinkedIn' : 
                         href.includes('twitter.com') ? 'Twitter' :
                         'Web'
                });
              } catch (e) {
                // Skip
              }
            });
            
            return items;
          });

          console.log(`   Found ${results.length} results`);
          leads.push(...results);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (err) {
          console.log(`   Query failed: ${err.message}`);
        }
      }

      await page.close();
      return leads;
      
    } catch (err) {
      console.error('Google search error:', err.message);
      await page.close();
      return [];
    }
  }

  async searchTwitterLeads(keywords = []) {
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    try {
      const leads = [];
      
      const searchQuery = `looking for developer OR hiring developer OR need app development ${keywords.join(' OR ')}`;
      
      console.log(`🐦 Twitter Search: "${searchQuery}"`);
      
      await page.goto(`https://twitter.com/search?q=${encodeURIComponent(searchQuery)}&src=typed_query&f=live`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await new Promise(resolve => setTimeout(resolve, 5000));

      const tweets = await page.evaluate(() => {
        const results = [];
        const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
        
        tweetElements.forEach((tweet, idx) => {
          if (idx >= 15) return;
          
          const userEl = tweet.querySelector('[data-testid="User-Name"] a');
          const textEl = tweet.querySelector('[data-testid="tweetText"]');
          const timeEl = tweet.querySelector('time');
          
          if (userEl && textEl) {
            const tweetText = textEl.innerText.trim();
            
            // Extract contact info
            const emailMatch = tweetText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            const phoneMatch = tweetText.match(/\+?\d[\d\s\-\.\(\)]{8,}/);
            
            results.push({
              username: userEl.innerText.trim(),
              profileUrl: 'https://twitter.com' + userEl.getAttribute('href'),
              tweet: tweetText,
              snippet: tweetText,
              timestamp: timeEl ? timeEl.getAttribute('datetime') : '',
              email: emailMatch ? emailMatch[0] : '',
              phone: phoneMatch ? phoneMatch[0] : '',
              source: 'Twitter'
            });
          }
        });
        
        return results;
      });

      leads.push(...tweets);
      await page.close();
      return leads;
      
    } catch (err) {
      log(`LinkedIn search error: ${err.message}`, 'ERROR');
      await page.close();
      return [];
    }
  }

  async searchRedditLeads(keywords = []) {
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    try {
      const leads = [];
      
      // Search r/forhire and other job subreddits
      const subreddits = ['forhire', 'hiring', 'jobbit', 'freelance_forhire'];
      
      for (const subreddit of subreddits.slice(0, 2)) {
        console.log(`🔴 Reddit Search: r/${subreddit}`);
        
        await page.goto(`https://www.reddit.com/r/${subreddit}/search/?q=developer OR software OR app&restrict_sr=1&sort=new`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 4000));

        const posts = await page.evaluate(() => {
          const results = [];
          
          // Reddit post selectors
          const postElements = document.querySelectorAll('[data-testid="post-container"], .Post, article');
          
          postElements.forEach((post, idx) => {
            if (idx >= 20) return;
            
            try {
              const titleEl = post.querySelector('h3, [data-click-id="body"]');
              const linkEl = post.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
              const authorEl = post.querySelector('[data-testid="post_author_link"], .author');
              
              if (titleEl && linkEl) {
                const title = titleEl.innerText.trim();
                const url = linkEl.href.startsWith('http') ? linkEl.href : 'https://www.reddit.com' + linkEl.href;
                
                // Check if it's a hiring post (not offering services)
                const isHiring = title.toLowerCase().includes('[hiring]') ||
                               title.toLowerCase().includes('looking for') ||
                               title.toLowerCase().includes('need') ||
                               (!title.toLowerCase().includes('[for hire]') && 
                                !title.toLowerCase().includes('available'));
                
                if (isHiring) {
                  // Extract contact info from title
                  const emailMatch = title.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                  const phoneMatch = title.match(/\+?\d[\d\s\-\.\(\)]{8,}/);
                  
                  results.push({
                    title: title,
                    url: url,
                    snippet: title,
                    username: authorEl ? authorEl.innerText.trim() : '',
                    email: emailMatch ? emailMatch[0] : '',
                    phone: phoneMatch ? phoneMatch[0] : '',
                    source: 'Reddit r/' + window.location.pathname.split('/')[2]
                  });
                }
              }
            } catch (e) {
              console.error(`Error parsing Reddit post ${idx}:`, e.message);
            }
          });
          
          return results;
        });

        console.log(`   Found ${posts.length} Reddit posts`);
        leads.push(...posts);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      await page.close();
      return leads;
      
    } catch (err) {
      console.error('Reddit search error:', err.message);
      await page.close();
      return [];
    }
  }

  extractDomainInfo(url) {
    try {
      if (!url) return { domain: '', industry: 'Unknown', platform: 'Unknown' };
      
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      
      // Detect industry from domain
      let industry = 'General';
      if (domain.includes('tech') || domain.includes('software') || domain.includes('dev')) industry = 'Technology';
      else if (domain.includes('health') || domain.includes('med') || domain.includes('care')) industry = 'Healthcare';
      else if (domain.includes('finance') || domain.includes('bank') || domain.includes('invest')) industry = 'Finance';
      else if (domain.includes('edu') || domain.includes('school') || domain.includes('university')) industry = 'Education';
      else if (domain.includes('shop') || domain.includes('store') || domain.includes('commerce')) industry = 'E-commerce';
      else if (domain.includes('game') || domain.includes('gaming')) industry = 'Gaming';
      else if (domain.includes('food') || domain.includes('restaurant')) industry = 'Food & Beverage';
      
      // Detect platform
      let platform = 'Website';
      if (domain.includes('linkedin.com')) platform = 'LinkedIn';
      else if (domain.includes('twitter.com') || domain.includes('x.com')) platform = 'Twitter';
      else if (domain.includes('reddit.com')) platform = 'Reddit';
      else if (domain.includes('github.com')) platform = 'GitHub';
      
      return { domain, industry, platform };
    } catch (e) {
      return { domain: '', industry: 'Unknown', platform: 'Unknown' };
    }
  }

  analyzeContentContext(lead) {
    const content = `${lead.snippet || ''} ${lead.tweet || ''} ${lead.title || ''}`.toLowerCase();
    
    const analysis = {
      urgency: 'Medium',
      projectType: 'General Development',
      budget: 'Unknown',
      timeline: 'Unknown',
      techStack: [],
      painPoints: []
    };
    
    // Urgency detection
    if (content.includes('urgent') || content.includes('asap') || content.includes('immediately')) {
      analysis.urgency = 'High';
    } else if (content.includes('flexible') || content.includes('long-term')) {
      analysis.urgency = 'Low';
    }
    
    // Project type detection
    if (content.includes('mobile app') || content.includes('ios') || content.includes('android')) {
      analysis.projectType = 'Mobile App Development';
    } else if (content.includes('web app') || content.includes('website') || content.includes('saas')) {
      analysis.projectType = 'Web Application';
    } else if (content.includes('mvp') || content.includes('prototype')) {
      analysis.projectType = 'MVP Development';
    } else if (content.includes('ai') || content.includes('ml') || content.includes('machine learning')) {
      analysis.projectType = 'AI/ML Integration';
    } else if (content.includes('backend') || content.includes('api')) {
      analysis.projectType = 'Backend Development';
    } else if (content.includes('frontend') || content.includes('ui') || content.includes('ux')) {
      analysis.projectType = 'Frontend Development';
    }
    
    // Budget indicators
    if (content.includes('budget') || content.includes('$') || content.includes('funded')) {
      analysis.budget = 'Budget Available';
    }
    
    // Timeline detection
    if (content.includes('week') || content.includes('days')) {
      analysis.timeline = 'Short-term (Weeks)';
    } else if (content.includes('month')) {
      analysis.timeline = 'Medium-term (Months)';
    } else if (content.includes('year') || content.includes('long-term')) {
      analysis.timeline = 'Long-term (6+ months)';
    }
    
    // Tech stack detection
    const techKeywords = {
      'react': 'React', 'angular': 'Angular', 'vue': 'Vue.js',
      'node': 'Node.js', 'python': 'Python', 'java': 'Java',
      'django': 'Django', 'flask': 'Flask', 'express': 'Express',
      'mongodb': 'MongoDB', 'postgres': 'PostgreSQL', 'mysql': 'MySQL',
      'aws': 'AWS', 'azure': 'Azure', 'gcp': 'Google Cloud',
      'docker': 'Docker', 'kubernetes': 'Kubernetes',
      'react native': 'React Native', 'flutter': 'Flutter'
    };
    
    for (const [keyword, tech] of Object.entries(techKeywords)) {
      if (content.includes(keyword)) {
        analysis.techStack.push(tech);
      }
    }
    
    // Pain points detection
    if (content.includes('legacy') || content.includes('outdated')) {
      analysis.painPoints.push('Modernizing legacy systems');
    }
    if (content.includes('scale') || content.includes('performance')) {
      analysis.painPoints.push('Scalability and performance');
    }
    if (content.includes('security') || content.includes('secure')) {
      analysis.painPoints.push('Security concerns');
    }
    if (content.includes('deadline') || content.includes('behind schedule')) {
      analysis.painPoints.push('Tight deadlines');
    }
    if (content.includes('team') || content.includes('resource')) {
      analysis.painPoints.push('Team capacity issues');
    }
    
    return analysis;
  }

  async generateApproachStrategy(lead, userProfile = {}) {
    // Extract domain and industry info
    const domainInfo = this.extractDomainInfo(lead.url || lead.profileUrl || '');
    
    // Analyze content for context
    const contentAnalysis = this.analyzeContentContext(lead);
    
    const prompt = `You are a B2B sales expert specializing in software development services. Analyze this lead and provide a highly personalized approach strategy.

Lead Information:
- Name: ${lead.name || lead.username || 'Unknown'}
- Title: ${lead.title || 'Unknown'}
- Company: ${lead.company || 'Unknown'}
- Location: ${lead.location || 'Unknown'}
- Platform: ${domainInfo.platform}
- Industry: ${domainInfo.industry}
- Domain: ${domainInfo.domain || 'N/A'}

Content Context:
- Post/Message: "${(lead.snippet || lead.tweet || lead.title || '').substring(0, 400)}"
- Project Type: ${contentAnalysis.projectType}
- Urgency: ${contentAnalysis.urgency}
- Tech Stack Mentioned: ${contentAnalysis.techStack.length > 0 ? contentAnalysis.techStack.join(', ') : 'Not specified'}
- Timeline: ${contentAnalysis.timeline}
- Budget Status: ${contentAnalysis.budget}
- Pain Points: ${contentAnalysis.painPoints.length > 0 ? contentAnalysis.painPoints.join(', ') : 'To be discovered'}

Contact Information Available:
- Email: ${lead.email || 'Not found'}
- Phone: ${lead.phone || 'Not found'}
- Profile URL: ${lead.profileUrl || lead.url || 'Available'}

Our Services:
- Custom software development (Web, Mobile, Desktop)
- Mobile app development (iOS/Android, React Native, Flutter)
- Web application development (React, Vue, Angular, Node.js)
- Cloud solutions and DevOps (AWS, Azure, GCP)
- AI/ML integration and automation
- Legacy system modernization
- MVP development for startups
- Full-stack development teams

Generate a detailed approach strategy with:

1. **Industry Fit Analysis** (2 sentences)
   - Why their industry/domain is a perfect match for our services
   - Specific industry challenges we can solve

2. **Key Pain Points** (2-3 points)
   - Based on the content, what problems are they facing?
   - What specific solutions can we offer?

3. **Personalized Opening Message** (3-4 sentences)
   - Reference their specific post/request
   - Mention relevant tech stack or project type
   - Offer clear value proposition
   - Include a soft call-to-action

4. **Recommended Contact Method & Timing**
   - Best channel: ${lead.email ? 'Email (available)' : lead.phone ? 'Phone (available)' : domainInfo.platform + ' message'}
   - Optimal timing based on urgency: ${contentAnalysis.urgency}
   - Follow-up strategy

5. **Unique Value Proposition** (1 sentence)
   - What makes us different for THIS specific lead?

Keep professional, friendly, and action-oriented. Total: 200-250 words.`;

    try {
      console.log(`   🤖 Generating AI strategy for ${lead.name || 'lead'}...`);
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/nithinjambula",
          "X-Title": "Lead Generation AI Strategy"
        },
        body: JSON.stringify({
          "model": "meta-llama/llama-3.2-3b-instruct:free",
          "messages": [
            {
              "role": "system",
              "content": "You are a B2B sales strategist specializing in software development services. You analyze leads deeply and create highly personalized outreach strategies based on domain, industry, content context, and pain points."
            },
            {
              "role": "user",
              "content": prompt
            }
          ],
          "temperature": 0.7,
          "max_tokens": 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`   ❌ API error ${response.status}: ${errorText}`);
        return this.generateFallbackStrategy(lead, domainInfo, contentAnalysis);
      }

      const data = await response.json();
      console.log(`   📊 API Response:`, JSON.stringify(data).substring(0, 200));
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error(`   ❌ Invalid API response structure`);
        return this.generateFallbackStrategy(lead, domainInfo, contentAnalysis);
      }
      
      let strategyText = data.choices[0].message.content;
      
      // Handle potential null or undefined
      if (!strategyText) {
        console.error(`   ❌ AI returned empty content`);
        return this.generateFallbackStrategy(lead, domainInfo, contentAnalysis);
      }
      
      // Clean up the response (remove thinking tokens, extra whitespace, etc.)
      strategyText = strategyText.trim();
      
      // Remove common AI artifacts
      strategyText = strategyText.replace(/<think>[\s\S]*?<\/think>/gi, '');
      strategyText = strategyText.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
      strategyText = strategyText.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
      strategyText = strategyText.trim();
      
      if (strategyText.length === 0) {
        console.error(`   ❌ AI content empty after cleanup`);
        return this.generateFallbackStrategy(lead, domainInfo, contentAnalysis);
      }
      
      console.log(`   ✅ AI generated ${strategyText.length} chars strategy`);
      return strategyText;
      
    } catch (err) {
      console.error(`   ❌ AI strategy error: ${err.message}`);
      console.log(`   ⚠️ Using fallback strategy`);
      return this.generateFallbackStrategy(lead, domainInfo, contentAnalysis);
    }
  }

  generateFallbackStrategy(lead, domainInfo, contentAnalysis) {
    let strategy = `**1. Industry Fit Analysis**\n`;
    strategy += `${domainInfo.industry} sector is experiencing rapid digital transformation, making this an ideal match for our software development expertise. `;
    strategy += `We've successfully delivered ${contentAnalysis.projectType.toLowerCase()} solutions for similar companies, addressing challenges like scalability, modernization, and time-to-market.\n\n`;
    
    strategy += `**2. Key Pain Points**\n`;
    if (contentAnalysis.painPoints.length > 0) {
      contentAnalysis.painPoints.forEach((point, i) => {
        strategy += `- ${point}\n`;
      });
    } else {
      strategy += `- ${contentAnalysis.projectType} implementation and delivery\n`;
      strategy += `- Technical expertise and resource availability\n`;
      strategy += `- Meeting project deadlines with quality standards\n`;
    }
    strategy += `\nOur solution: End-to-end development services with proven track record in ${contentAnalysis.techStack.length > 0 ? contentAnalysis.techStack.join(', ') : 'modern tech stacks'}.\n\n`;
    
    strategy += `**3. Personalized Opening Message**\n`;
    strategy += `"Hi ${lead.name || 'there'}, I came across your ${domainInfo.platform} post regarding ${contentAnalysis.projectType.toLowerCase()}. `;
    strategy += `We specialize in delivering ${domainInfo.industry.toLowerCase()} solutions and have a proven track record with similar projects. `;
    if (contentAnalysis.techStack.length > 0) {
      strategy += `Our team has extensive experience with ${contentAnalysis.techStack.slice(0, 3).join(', ')}. `;
    }
    strategy += `I'd love to share some relevant case studies and discuss how we can help accelerate your project. Would you be available for a brief call this week?"\n\n`;
    
    strategy += `**4. Recommended Contact Method & Timing**\n`;
    strategy += `- **Best Channel:** ${lead.email ? 'Email (' + lead.email + ')' : lead.phone ? 'Phone (' + lead.phone + ')' : domainInfo.platform + ' direct message'}\n`;
    strategy += `- **Optimal Timing:** ${contentAnalysis.urgency} urgency detected - ${contentAnalysis.urgency === 'High' ? 'Contact within 24 hours' : contentAnalysis.urgency === 'Medium' ? 'Contact within 48 hours' : 'Contact within 3-5 days'}\n`;
    strategy += `- **Follow-up:** ${contentAnalysis.urgency === 'High' ? 'If no response in 24h, send follow-up' : 'Send gentle reminder after 3 days if no response'}\n\n`;
    
    strategy += `**5. Unique Value Proposition**\n`;
    strategy += `We deliver ${contentAnalysis.projectType.toLowerCase()} with ${contentAnalysis.urgency === 'High' ? 'rapid turnaround times' : 'thorough planning and execution'}, specialized ${domainInfo.industry.toLowerCase()} domain knowledge, and flexible engagement models tailored to ${contentAnalysis.timeline.toLowerCase() || 'your timeline'}.`;
    
    return strategy;
  }

  async scoreLead(lead) {
    let score = 0;
    
    // Title-based scoring
    const highValueTitles = ['cto', 'ceo', 'founder', 'director', 'vp', 'head of', 'chief', 'owner', 'president'];
    const mediumValueTitles = ['manager', 'lead', 'senior', 'principal', 'architect', 'engineer'];
    
    const title = (lead.title || '').toLowerCase();
    const company = (lead.company || '').toLowerCase();
    
    if (highValueTitles.some(t => title.includes(t))) score += 40;
    else if (mediumValueTitles.some(t => title.includes(t))) score += 25;
    else score += 10;
    
    // Company indicators
    if (company.includes('startup') || company.includes('inc') || company.includes('corp')) score += 10;
    
    // Urgency indicators
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'looking for', 'hiring', 'need', 'seeking', 'required'];
    const text = ((lead.snippet || '') + (lead.tweet || '') + (lead.title || '')).toLowerCase();
    
    if (urgentKeywords.some(k => text.includes(k))) score += 30;
    
    // Budget indicators
    const budgetKeywords = ['budget', 'funded', 'investment', 'series', 'funding', 'capital', 'raised'];
    if (budgetKeywords.some(k => text.includes(k))) score += 20;
    
    // Project indicators
    const projectKeywords = ['project', 'development', 'build', 'create', 'need', 'want'];
    if (projectKeywords.some(k => text.includes(k))) score += 15;
    
    // Recency (if available)
    if (lead.timestamp) {
      const days = (Date.now() - new Date(lead.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      if (days < 7) score += 10;
      else if (days < 30) score += 5;
    }
    
    return Math.min(score, 100);
  }

  deduplicateLeads(leads) {
    const seen = new Set();
    const unique = [];
    
    for (const lead of leads) {
      const identifier = (lead.profileUrl || lead.url || lead.name || '').toLowerCase();
      if (identifier && !seen.has(identifier)) {
        seen.add(identifier);
        unique.push(lead);
      }
    }
    
    return unique;
  }

  async generateFullLeadReport(options = {}) {
    // Load session configuration
    const sessionConfig = loadSessionConfig();
    
    const {
      keywords = sessionConfig.keywords,
      location = sessionConfig.location,
      maxLeads = sessionConfig.maxLeads,
      includeApproachStrategy = true
    } = options;

    log(`Starting Lead Generation for session: ${this.sessionId}`);
    log(`Location: ${location || 'Global'}`);
    log(`Keywords: ${keywords.join(', ')}`);
    log(`Max leads: ${maxLeads}`);

    const allLeads = [];

    // Search LinkedIn
    try {
      console.log('🔵 Searching LinkedIn...');
      const linkedInLeads = await this.searchLinkedInLeads(keywords, location);
      allLeads.push(...linkedInLeads);
      console.log(`✅ Found ${linkedInLeads.length} LinkedIn leads\n`);
    } catch (err) {
      console.log(`❌ LinkedIn search failed: ${err.message}\n`);
    }

    // Search Google
    try {
      console.log('🌐 Searching Google...');
      const googleLeads = await this.searchGoogleLeads(keywords, location);
      allLeads.push(...googleLeads);
      console.log(`✅ Found ${googleLeads.length} Google leads\n`);
    } catch (err) {
      console.log(`❌ Google search failed: ${err.message}\n`);
    }

    // Search Twitter
    try {
      console.log('🐦 Searching Twitter...');
      const twitterLeads = await this.searchTwitterLeads(keywords);
      allLeads.push(...twitterLeads);
      console.log(`✅ Found ${twitterLeads.length} Twitter leads\n`);
    } catch (err) {
      console.log(`❌ Twitter search failed: ${err.message}\n`);
    }

    // Search Reddit
    try {
      console.log('🔴 Searching Reddit...');
      const redditLeads = await this.searchRedditLeads(keywords);
      allLeads.push(...redditLeads);
      console.log(`✅ Found ${redditLeads.length} Reddit leads\n`);
    } catch (err) {
      console.log(`❌ Reddit search failed: ${err.message}\n`);
    }

    // Deduplicate
    const uniqueLeads = this.deduplicateLeads(allLeads).slice(0, maxLeads);
    console.log(`\n📊 Total unique leads: ${uniqueLeads.length}`);

    // Score leads
    console.log('📈 Scoring leads...');
    for (const lead of uniqueLeads) {
      lead.score = await this.scoreLead(lead);
    }

    // Sort by score
    uniqueLeads.sort((a, b) => b.score - a.score);

    // Generate approach strategies for top leads
    if (includeApproachStrategy) {
      console.log('🎯 Generating approach strategies for top leads...\n');
      
      for (let i = 0; i < Math.min(10, uniqueLeads.length); i++) {
        const lead = uniqueLeads[i];
        console.log(`Generating strategy for: ${lead.name || lead.title || 'Lead ' + (i + 1)}`);
        lead.approachStrategy = await this.generateApproachStrategy(lead);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit
      }
    }

    const report = {
      sessionId: this.sessionId,
      sanitizedSessionId: this.sanitizedSessionId,
      generatedAt: new Date().toISOString(),
      searchParams: {
        keywords,
        location,
        maxLeads
      },
      summary: {
        totalLeads: uniqueLeads.length,
        highPriorityLeads: uniqueLeads.filter(l => l.score >= 70).length,
        mediumPriorityLeads: uniqueLeads.filter(l => l.score >= 40 && l.score < 70).length,
        lowPriorityLeads: uniqueLeads.filter(l => l.score < 40).length
      },
      leads: uniqueLeads.map(lead => ({
        ...lead,
        foundAt: new Date().toISOString(),
        sessionId: this.sessionId
      }))
    };
    
    log(`Lead generation completed for session ${this.sessionId}`, 'SUCCESS');
    log(`High priority leads: ${report.summary.highPriorityLeads}`, 'SUCCESS');
    log(`Medium priority leads: ${report.summary.mediumPriorityLeads}`, 'SUCCESS');
    log(`Low priority leads: ${report.summary.lowPriorityLeads}`, 'SUCCESS');

    return report;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Main execution
async function runLeadGeneration() {
  log(`Starting Lead Generation Bot for session: ${sessionId}`);
  log(`Sanitized session ID: ${sanitizedSessionId}`);
  
  // Load session configuration
  const sessionConfig = loadSessionConfig();
  
  const args = process.argv.slice(2);
  
  let keywords = sessionConfig.keywords;
  let location = sessionConfig.location;
  let maxLeads = sessionConfig.maxLeads;
  let outputFile = sessionConfig.outputFile;
  let headless = HEADLESS;
  
  // Override with command line arguments if provided
  for (const arg of args) {
    if (arg.startsWith('--keywords=')) {
      keywords = arg.split('=')[1].split(',').map(k => k.trim());
    } else if (arg.startsWith('--location=')) {
      location = arg.split('=')[1];
    } else if (arg.startsWith('--max=')) {
      maxLeads = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--out=')) {
      outputFile = arg.split('=')[1];
    } else if (arg === '--headless') {
      headless = true;
    }
  }

  const generator = new LeadGenerator({ headless });
  
  try {
    await generator.init();
    log('Lead Generation System Initialized', 'SUCCESS');

    const report = await generator.generateFullLeadReport({
      keywords,
      location,
      maxLeads,
      includeApproachStrategy: true
    });

    // Save report with timestamp
    const timestampedFile = `leads_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
    await fs.writeFile(timestampedFile, JSON.stringify(report, null, 2));
    
    log('========================================');
    log('LEAD GENERATION REPORT');
    log('========================================');
    log(`Session ID: ${sessionId}`);
    log(`Total Leads Found: ${report.summary.totalLeads}`);
    log(`High Priority (70+): ${report.summary.highPriorityLeads}`);
    log(`Medium Priority (40-69): ${report.summary.mediumPriorityLeads}`);
    log(`Low Priority (<40): ${report.summary.lowPriorityLeads}`);
    
    if (report.leads.length > 0) {
      log('TOP 5 LEADS:');
      report.leads.slice(0, 5).forEach((lead, i) => {
        log(`${i + 1}. ${lead.name || lead.username || 'Unknown'} (Score: ${lead.score})`);
        log(`   ${lead.title || ''} at ${lead.company || 'Unknown Company'}`);
        log(`   Platform: ${lead.platform} | ${lead.url || lead.profileUrl || ''}`);
        if (lead.email) log(`   Email: ${lead.email}`);
        if (lead.phone) log(`   Phone: ${lead.phone}`);
      });
    }
    
    await generator.close();
    
  } catch (err) {
    log(`Lead generation error: ${err.message}`, 'ERROR');
    log(`Stack trace: ${err.stack}`, 'ERROR');
    await generator.close();
    process.exit(1);
  }
}

// Legacy main function for compatibility
async function main() {
  await runLeadGeneration();
}

module.exports = LeadGenerator;

if (require.main === module) {
  runLeadGeneration();
}
