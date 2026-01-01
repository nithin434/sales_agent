# LinkedIn Auto-Reply Bot, Lead Generation & Web Scraper

This comprehensive tool automatically responds to LinkedIn messages, generates qualified software development leads, and scrapes web content.

## Quick Setup

Install the required packages first:
```bash
npm install puppeteer
pip install -r requirements.txt
```

## FastAPI Bot Control Server

The main server manages WhatsApp bots, LinkedIn bots, and intelligent lead generation through API endpoints.

### Start the Server
```bash
python main.py
```

The server runs on port 8000 and provides REST API endpoints for bot management and lead generation.

### Available Endpoints

#### Session Management
- `POST /verify-session` - Verify or create user session
- `POST /remove-session` - Delete user session and stop all bots
- `GET /health` - Server health check

#### Bot Control
- `POST /start-whatsapp` - Start WhatsApp bot with personality
- `POST /start-linkedin` - Start LinkedIn auto-reply bot
- `POST /stop-bot` - Stop any running bot
- `GET /bot-status/{user_id}/{bot_type}` - Check bot status and logs

#### Lead Generation
- `POST /generate-leads` - Start intelligent lead generation
- `GET /leads/{user_id}` - Get all generated leads with filtering
- `GET /lead-jobs/{user_id}` - View lead generation job history
- `PUT /leads/{lead_id}/status` - Update lead status (contacted, qualified, etc.)
- `POST /stop-lead-generation` - Stop ongoing lead generation

## 🎯 Intelligent Lead Generation System

The lead generation system uses AI to find and qualify potential software development clients across multiple platforms.

### ⚠️ IMPORTANT: First Time Setup

Before using lead generation, you MUST login to LinkedIn:

```bash
# Step 1: Install dependencies
npm install playwright

# Step 2: Run session creator and login manually
node manual_session_creator.js
```

The browser will open - login to your LinkedIn account manually. Once logged in, keep the browser window open. The session will auto-save every 30 minutes. Press Ctrl+C when done.

### Start Lead Generation

#### Via API
```json
POST /generate-leads
{
  "uniqueId": "user123",
  "keywords": ["web development", "mobile app", "custom software"],
  "location": "San Francisco",
  "maxLeads": 50,
  "includeApproachStrategy": true
}
```

#### Via Command Line
```bash
node lead_generator.js --keywords="web development,mobile app" --location="New York" --max=50

node lead_generator.js --keywords="saas,startup,mvp" --location="San Francisco" --max=50
```

### Features
- **Multi-Platform Search**: Searches LinkedIn, Google, and Twitter for potential leads
- **AI-Powered Scoring**: Automatically scores leads (0-100) based on:
  - Decision-maker titles (CTO, CEO, Founder)
  - Urgency indicators (hiring, ASAP, looking for)
  - Budget signals (funded, investment)
  - Recency of posts
- **Personalized Approach Strategies**: AI generates custom outreach strategies for each lead
- **Source Tracking**: Tracks where each lead was found
- **Deduplication**: Automatically removes duplicate leads

### Lead Scoring System
- **High Priority (70-100)**: Decision-makers with urgent needs and budget signals
- **Medium Priority (40-69)**: Managers or leads with moderate urgency
- **Low Priority (0-39)**: General contacts or older posts

### Approach Strategy Generation
For each high-value lead, the system generates:
1. Why they're a good fit for your services
2. Their key pain point
3. Personalized opening message suggestion
4. Best contact method (LinkedIn, Email, Twitter)

### Lead Management
Track your leads through their lifecycle:
- `new` - Freshly discovered lead
- `contacted` - Initial outreach sent
- `qualified` - Lead shows interest
- `closed` - Deal won
- `rejected` - Not interested or unqualified

## LinkedIn Auto-Reply Bot

The bot reads your LinkedIn conversations and automatically replies to serious queries using AI responses.

### First Time Setup
Run this command to save your LinkedIn login session:
```bash
node manual_session_creator.js
```

### Start the Bot Directly
```bash
node scraper.js --linkedin-bot --headful
```

Or use the API server to start it remotely with custom configuration.

### Bot Features
- Only replies to serious questions and requests
- Ignores casual greetings like "hi" and "thanks"
- Processes messages from the last 24 hours
- Generates personalized responses using AI
- Saves conversation history and tracks replies
- Runs in test mode by default for safety

## Web Scraping

You can also use this tool to scrape any website or search Google results.

### Basic Web Scraping
```bash
node scraper.js "your search query" --count=5
```

### LinkedIn Profile Scraping
```bash
node scraper.js "linkedin profiles" --count=3
```

## Example Lead Generation Workflow

1. **Start lead generation** with your target keywords and location
2. **Review generated leads** sorted by priority score
3. **Read AI-generated approach strategies** for top leads
4. **Update lead status** as you contact them
5. **Track success** through the lead management system

```bash
# Generate leads
curl -X POST http://localhost:8000/generate-leads \
  -H "Content-Type: application/json" \
  -d '{
    "uniqueId": "user123",
    "keywords": ["saas development", "mvp", "startup"],
    "location": "Silicon Valley",
    "maxLeads": 30
  }'

# Get high-priority leads
curl http://localhost:8000/leads/user123?min_score=70

# Mark lead as contacted
curl -X PUT http://localhost:8000/leads/42/status?status=contacted&notes="Sent initial email"
```

## Configuration

The bot automatically saves your LinkedIn session and reuses it for future runs. All scraped data gets saved to `scraped_data.json` by default.

The API server stores:
- User sessions in SQLite database
- LinkedIn sessions with user-specific data
- All generated leads with scores and strategies
- Lead generation job history

## Important Notes

The LinkedIn bot requires an active LinkedIn session and runs in test mode initially. Review the generated responses before enabling live mode.

Lead generation respects platform rate limits and includes delays between searches to avoid detection.