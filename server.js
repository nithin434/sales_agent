const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
// Use environment variables so production can bind to external interfaces/ports
const HOST = process.env.HOST || '0.0.0.0';
let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Function to find available port
function findAvailablePort(startPort) {
    return new Promise((resolve) => {
        const server = require('net').createServer();
        server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            resolve(findAvailablePort(startPort + 1));
        });
    });
}

app.use((req, res, next) => {
    const origin = req.headers.origin;

    // Production-friendly: allow any origin by default so external dashboards can connect
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
    res.header('Access-Control-Allow-Credentials', 'false');
    res.header('Access-Control-Max-Age', '86400');

    // Log CORS requests for debugging
    console.log(`${req.method} ${req.url} - Origin: ${origin || 'none'}`);

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
        console.log('Handling OPTIONS preflight request from:', origin);
        res.status(200).end();
        return;
    }

    next();
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('.'));

// Storage configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uniqueId = req.body.uniqueId || 'default';
        const dir = path.join(__dirname, 'sessions', uniqueId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Initialize SQLite database
const db = new sqlite3.Database('sessions.db');

// Create sessions table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        secret_key TEXT NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Bot processes storage
const activeBots = new Map();
const sessionCreators = new Map();

// Import session creator
const LinkedInSessionCreator = require('./manual_session_creator.js');

// Function to sanitize session ID for file system
function sanitizeSessionId(sessionId) {
    return sessionId
        .replace(/[@]/g, '_at_')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\./g, '_dot_')
        .replace(/\s+/g, '_');
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot_interface.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    const origin = req.headers.origin;
    console.log('Health check requested from:', origin || 'direct access');
    
    // Explicitly set CORS headers again for health check
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
    
    res.json({ 
        status: 'ok', 
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        cors: 'enabled',
        origin: origin || 'none'
    });
});

// CORS test endpoint
app.get('/cors-test', (req, res) => {
    const origin = req.headers.origin;
    console.log('CORS test requested from:', origin || 'direct access');
    
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
    
    res.json({
        message: 'CORS is working correctly',
        origin: origin || 'none',
        userAgent: req.headers['user-agent'] || 'unknown',
        timestamp: new Date().toISOString(),
        headers: req.headers
    });
});

// Upload LinkedIn session
app.post('/upload-session', upload.single('sessionFile'), (req, res) => {
    const { uniqueId } = req.body;
    
    console.log(`Session upload request for: ${uniqueId}`);
    
    if (!uniqueId) {
        return res.status(400).json({ success: false, message: 'Session ID is required' });
    }
    
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Session file is required' });
    }
    
    try {
        // Parse uploaded JSON file
        const sessionData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
        
        // Validate session structure
        if (!sessionData.cookies || !Array.isArray(sessionData.cookies)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid session file format. Must contain cookies array.' 
            });
        }
        
        // Save to root directory for all bots to use
        const rootSessionFile = path.join(__dirname, 'linkedin_session.json');
        fs.writeFileSync(rootSessionFile, JSON.stringify(sessionData, null, 2));
        
                // Also save to session-specific directory
                const sanitizedId = sanitizeSessionId(uniqueId);
                const sessionLinkedinDir = path.join(__dirname, 'sessions', sanitizedId, 'linkedin');
                const sessionLeadsDir = path.join(__dirname, 'sessions', sanitizedId, 'leads');
        
                if (!fs.existsSync(sessionLinkedinDir)) {
                    fs.mkdirSync(sessionLinkedinDir, { recursive: true });
                }
                if (!fs.existsSync(sessionLeadsDir)) {
                    fs.mkdirSync(sessionLeadsDir, { recursive: true });
                }
        
                const sessionFile = path.join(sessionLinkedinDir, 'linkedin_session.json');
                const leadsSessionFile = path.join(sessionLeadsDir, 'linkedin_session.json');
                fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
                fs.writeFileSync(leadsSessionFile, JSON.stringify(sessionData, null, 2));
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        console.log(`LinkedIn session uploaded successfully with ${sessionData.cookies.length} cookies`);
        
        res.json({ 
            success: true, 
            message: `LinkedIn session uploaded successfully. Found ${sessionData.cookies.length} cookies.`,
            cookieCount: sessionData.cookies.length
        });
    } catch (error) {
        console.error('Error processing session file:', error);
        
        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(400).json({ 
            success: false, 
            message: 'Error processing session file: ' + error.message 
        });
    }
});

// Create LinkedIn session
app.post('/create-session', (req, res) => {
    const { uniqueId } = req.body;
    
    console.log(`Session creation request for: ${uniqueId}`);
    
    if (!uniqueId) {
        return res.status(400).json({ success: false, message: 'Session ID is required' });
    }
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId);
    
    // Create session directory
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Copy manual session creator to session directory
    const originalCreator = path.join(__dirname, 'manual_session_creator.js');
    const sessionCreator = path.join(sessionDir, 'manual_session_creator.js');
    if (fs.existsSync(originalCreator)) {
        fs.copyFileSync(originalCreator, sessionCreator);
    }
    
    // Copy package.json for dependencies
    const originalPackage = path.join(__dirname, 'package.json');
    const sessionPackage = path.join(sessionDir, 'package.json');
    if (fs.existsSync(originalPackage)) {
        fs.copyFileSync(originalPackage, sessionPackage);
    }
    
    // Check if session creator is already running
    const creatorKey = `creator_${uniqueId}`;
    if (sessionCreators.has(creatorKey)) {
        return res.json({ 
            success: false, 
            message: 'Session creator is already running for this session'
        });
    }
    
    console.log(`Starting session creator for: ${uniqueId}`);
    console.log(`Session directory: ${sessionDir}`);
    
    // Start session creator process
    const creatorProcess = spawn('node', ['manual_session_creator.js'], {
        cwd: sessionDir,
        env: { 
            ...process.env, 
            SESSION_ID: uniqueId,
            SANITIZED_SESSION_ID: sanitizedId
        },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const logFile = path.join(sessionDir, 'session_creator.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    logStream.write(`\n=== Session Creator Started: ${new Date().toISOString()} ===\n`);
    
    creatorProcess.stdout.on('data', (data) => {
        console.log(`Session Creator ${uniqueId}:`, data.toString().trim());
        logStream.write(`[STDOUT] ${data}`);
    });
    
    creatorProcess.stderr.on('data', (data) => {
        console.error(`Session Creator ${uniqueId} ERROR:`, data.toString().trim());
        logStream.write(`[STDERR] ${data}`);
    });
    
    creatorProcess.on('close', (code) => {
        console.log(`Session creator ${uniqueId} exited with code ${code}`);
        logStream.write(`\n=== Process Exited: ${code} at ${new Date().toISOString()} ===\n`);
        logStream.end();
        sessionCreators.delete(creatorKey);
    });
    
    creatorProcess.on('error', (error) => {
        console.error(`Session creator ${uniqueId} process error:`, error);
        logStream.write(`\n=== Process Error: ${error.message} at ${new Date().toISOString()} ===\n`);
        logStream.end();
        sessionCreators.delete(creatorKey);
    });
    
    sessionCreators.set(creatorKey, creatorProcess);
    
    res.json({ 
        success: true, 
        message: 'LinkedIn session creator started successfully. Please complete login in the browser.',
        sessionDir: sanitizedId,
        instructions: 'A browser will open. Please log in to LinkedIn and wait for the session to be saved.',
        logFile: 'session_creator.log'
    });
});

// Verify unique ID and secret key
app.post('/verify-session', (req, res) => {
    const { uniqueId, secretKey, email } = req.body;
    
    db.get('SELECT * FROM sessions WHERE id = ? AND secret_key = ?', [uniqueId, secretKey], (err, row) => {
        if (err) {
            res.json({ success: false, message: 'Database error' });
            return;
        }
        
        if (row) {
            // Update last used timestamp
            if (email && email !== row.email) {
                db.run('UPDATE sessions SET last_used = CURRENT_TIMESTAMP, email = ? WHERE id = ?', [email, uniqueId]);
            } else {
                db.run('UPDATE sessions SET last_used = CURRENT_TIMESTAMP WHERE id = ?', [uniqueId]);
            }
            res.json({ success: true, message: 'Session verified' });
        } else {
            // Check if it's a new session
            db.get('SELECT * FROM sessions WHERE id = ?', [uniqueId], (err, existingRow) => {
                if (existingRow) {
                    res.json({ success: false, message: 'Invalid secret key' });
                } else {
                    // Create new session
                    db.run('INSERT INTO sessions (id, secret_key, email) VALUES (?, ?, ?)', [uniqueId, secretKey, email], function(err) {
                        if (err) {
                            res.json({ success: false, message: 'Error creating session' });
                        } else {
                            res.json({ success: true, message: 'New session created successfully!' });
                        }
                    });
                }
            });
        }
    });
});

// Start WhatsApp bot
app.post('/start-whatsapp', upload.none(), (req, res) => {
    const { uniqueId, personality, contacts, excludeContacts } = req.body;
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId, 'whatsapp');
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Write configuration files
    fs.writeFileSync(path.join(sessionDir, 'personality.txt'), personality || 'Default personality');
    fs.writeFileSync(path.join(sessionDir, 'contacts.txt'), contacts || 'ALL');
    fs.writeFileSync(path.join(sessionDir, 'exclude_contacts.txt'), excludeContacts || '');
    fs.writeFileSync(path.join(sessionDir, 'original_session_id.txt'), uniqueId);
    
    // Copy bot files to session directory
    const originalBot = path.join(__dirname, 'smart_whatsapp_bot.js');
    const sessionBot = path.join(sessionDir, 'smart_whatsapp_bot.js');
    if (fs.existsSync(originalBot)) {
        fs.copyFileSync(originalBot, sessionBot);
    }
    
    const originalGemini = path.join(__dirname, 'gemini_bot.py');
    const sessionGemini = path.join(sessionDir, 'gemini_bot.py');
    if (fs.existsSync(originalGemini)) {
        fs.copyFileSync(originalGemini, sessionGemini);
    }
    
    // Check if bot is already running
    const botKey = `whatsapp_${uniqueId}`;
    if (activeBots.has(botKey)) {
        res.json({ success: false, message: 'WhatsApp bot is already running for this session' });
        return;
    }
    
    // Start WhatsApp bot process
    const botProcess = spawn('node', ['smart_whatsapp_bot.js'], {
        cwd: sessionDir,
        env: { 
            ...process.env, 
            SESSION_ID: uniqueId,
            SANITIZED_SESSION_ID: sanitizedId
        }
    });
    
    // Log bot output
    const logFile = path.join(sessionDir, 'bot.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    botProcess.stdout.on('data', (data) => {
        logStream.write(data);
        console.log(`WhatsApp Bot ${uniqueId}:`, data.toString().trim());
    });
    
    botProcess.stderr.on('data', (data) => {
        logStream.write(data);
        console.error(`WhatsApp Bot ${uniqueId} Error:`, data.toString().trim());
    });
    
    botProcess.on('close', (code) => {
        console.log(`WhatsApp bot ${uniqueId} exited with code ${code}`);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    botProcess.on('error', (error) => {
        console.error(`WhatsApp bot ${uniqueId} spawn error:`, error);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    activeBots.set(botKey, botProcess);
    
    res.json({ 
        success: true, 
        message: 'WhatsApp bot started successfully',
        sessionDir: sanitizedId
    });
});

// Start Instagram bot
app.post('/start-instagram', upload.single('cookies'), (req, res) => {
    const { uniqueId, personality, users } = req.body;
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId, 'instagram');
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Write personality to file
    fs.writeFileSync(path.join(sessionDir, 'personality.txt'), personality || 'Default personality');
    
    // Copy uploaded cookies file
    if (req.file) {
        fs.copyFileSync(req.file.path, path.join(sessionDir, 'cookies.json'));
    } else {
        res.json({ success: false, message: 'No cookies file provided' });
        return;
    }
    
    // Parse and write users list
    let usersList = [];
    try {
        if (users && typeof users === 'string') {
            usersList = JSON.parse(users);
        } else if (Array.isArray(users)) {
            usersList = users;
        }
    } catch (e) {
        console.log('Error parsing users list:', e);
        usersList = [];
    }
    fs.writeFileSync(path.join(sessionDir, 'users.json'), JSON.stringify(usersList));
    
    // Copy bot files to session directory
    const originalInstaBot = path.join(__dirname, 'insta_bot.py');
    const sessionInstaBot = path.join(sessionDir, 'insta_bot.py');
    if (fs.existsSync(originalInstaBot)) {
        fs.copyFileSync(originalInstaBot, sessionInstaBot);
    }
    
    const originalSessionGemini = path.join(__dirname, 'session_gemini_bot.py');
    const sessionSessionGemini = path.join(sessionDir, 'session_gemini_bot.py');
    if (fs.existsSync(originalSessionGemini)) {
        fs.copyFileSync(originalSessionGemini, sessionSessionGemini);
    }
    
    // Check if bot is already running
    const botKey = `instagram_${uniqueId}`;
    if (activeBots.has(botKey)) {
        res.json({ success: false, message: 'Instagram bot is already running for this session' });
        return;
    }
    
    // Start Instagram bot process
    const botProcess = spawn('python', ['insta_bot.py'], {
        cwd: sessionDir,
        env: { 
            ...process.env, 
            SESSION_ID: uniqueId,
            SANITIZED_SESSION_ID: sanitizedId
        },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Log bot output
    const logFile = path.join(sessionDir, 'bot.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    botProcess.stdout.on('data', (data) => {
        logStream.write(data);
        const output = data.toString();
        if (output.includes('ERROR') || output.includes('started') || output.includes('stopped') || output.includes('Bot result:')) {
            console.log(`Instagram Bot ${uniqueId}:`, output.trim());
        }
    });
    
    botProcess.stderr.on('data', (data) => {
        logStream.write(data);
        const output = data.toString();
        if (output.includes('- INFO -') || output.includes('- WARNING -') || 
            output.includes('Successfully') || output.includes('Message sent:') || 
            output.includes('started') || output.includes('stopped') ||
            output.includes('Bot result:') || output.includes('Checking conversation') ||
            output.includes('Initial response sent') || output.includes('NEW INCOMING MESSAGE')) {
            console.log(`Instagram Bot ${uniqueId}:`, output.trim());
        } else if (output.includes('- ERROR -') || output.includes('- CRITICAL -') || 
                   output.includes('Exception') || output.includes('Traceback')) {
            console.error(`Instagram Bot ${uniqueId} Error:`, output.trim());
        }
    });
    
    botProcess.on('close', (code) => {
        console.log(`Instagram bot ${uniqueId} exited with code ${code}`);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    botProcess.on('error', (error) => {
        console.error(`Instagram bot ${uniqueId} spawn error:`, error);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    activeBots.set(botKey, botProcess);
    
    res.json({ success: true, message: 'Instagram bot started successfully' });
});

// Start LinkedIn bot
app.post('/start-linkedin', upload.none(), (req, res) => {
    const { uniqueId, personality, portfolioLink, testMode } = req.body;
    
    console.log(`LinkedIn bot start request for session: ${uniqueId}`);
    console.log(`Request body:`, { uniqueId, personality: personality?.length, portfolioLink, testMode });
    
    if (!uniqueId) {
        return res.status(400).json({ success: false, message: 'Session ID is required' });
    }
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId, 'linkedin');
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Write configuration files
    fs.writeFileSync(path.join(sessionDir, 'personality.txt'), personality || 'You are Nithin responding to LinkedIn messages. Be professional yet friendly, and authentic. Keep responses casual and under 30 words.');
    fs.writeFileSync(path.join(sessionDir, 'portfolio_link.txt'), portfolioLink || 'https://your-portfolio-link.com');
    fs.writeFileSync(path.join(sessionDir, 'test_mode.txt'), testMode ? 'true' : 'false');
    fs.writeFileSync(path.join(sessionDir, 'original_session_id.txt'), uniqueId);
    

    
    // Check if LinkedIn session exists
    const linkedinSessionFile = path.join(__dirname, 'linkedin_session.json');
    if (!fs.existsSync(linkedinSessionFile)) {
        return res.status(400).json({ 
            success: false, 
            message: 'LinkedIn session not found. Please create a session first using the "Create Session" button.',
            needsSession: true
        });
    }
    
    // Write business context
    const businessContext = `Services Offered:
- Custom Software Development
- Web & Mobile App Development  
- AI/ML Integration & Automation
- Cloud Solutions & DevOps
- MVP Development for Startups
- Full-stack Development Teams

Technologies:
React, Node.js, Python, AWS, Azure, MongoDB, PostgreSQL, Docker, Kubernetes

Business Focus:
Professional LinkedIn automation for lead generation and client communication. Specializing in software development services with AI-powered response generation.`;
    fs.writeFileSync(path.join(sessionDir, 'business_context.txt'), businessContext);
    
    // Copy bot files to session directory
    const originalBot = path.join(__dirname, 'scraper_v2.js');
    const sessionBot = path.join(sessionDir, 'scraper_v2.js');
    if (fs.existsSync(originalBot)) {
        fs.copyFileSync(originalBot, sessionBot);
    }
    
    // Copy session files if they exist - prioritize existing session files
    const originalSession = path.join(__dirname, 'linkedin_session.json');
    const sessionSessionFile = path.join(sessionDir, 'linkedin_session.json');
    
    // Only copy session if it doesn't already exist in the session directory
    if (fs.existsSync(originalSession) && !fs.existsSync(sessionSessionFile)) {
        fs.copyFileSync(originalSession, sessionSessionFile);
        console.log(`Copied LinkedIn session to: ${sessionSessionFile}`);
    } else if (fs.existsSync(sessionSessionFile)) {
        console.log(`Using existing LinkedIn session: ${sessionSessionFile}`);
    }
    
    const originalUserData = path.join(__dirname, 'linkedin_user_data');
    const sessionUserData = path.join(sessionDir, 'linkedin_user_data');
    
    // Only copy user data if it doesn't already exist in the session directory
    if (fs.existsSync(originalUserData) && !fs.existsSync(sessionUserData)) {
        // Copy entire user data directory
        const copyDir = (src, dest) => {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (let entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    copyDir(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        };
        copyDir(originalUserData, sessionUserData);
        console.log(`Copied user data to: ${sessionUserData}`);
    } else if (fs.existsSync(sessionUserData)) {
        console.log(`Using existing user data: ${sessionUserData}`);
    }
    
    // Check if bot is already running
    const botKey = `linkedin_${uniqueId}`;
    if (activeBots.has(botKey)) {
        res.json({ success: false, message: 'LinkedIn bot is already running for this session' });
        return;
    }
    
    // Start LinkedIn bot process
    console.log(`Starting LinkedIn bot for session: ${uniqueId}`);
    console.log(`Session directory: ${sessionDir}`);
    console.log(`Test mode: ${testMode}, Portfolio: ${portfolioLink}`);
    
    const botProcess = spawn('node', ['scraper_v2.js'], {
        cwd: sessionDir,
        env: { 
            ...process.env, 
            SESSION_ID: uniqueId,
            SANITIZED_SESSION_ID: sanitizedId
        },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Log bot output
    const logFile = path.join(sessionDir, 'bot.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    botProcess.stdout.on('data', (data) => {
        logStream.write(data);
        console.log(`LinkedIn Bot ${uniqueId}:`, data.toString().trim());
    });
    
    botProcess.stderr.on('data', (data) => {
        logStream.write(data);
        console.error(`LinkedIn Bot ${uniqueId} Error:`, data.toString().trim());
    });
    
    botProcess.on('close', (code) => {
        console.log(`LinkedIn bot ${uniqueId} exited with code ${code}`);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    botProcess.on('error', (error) => {
        console.error(`LinkedIn bot ${uniqueId} spawn error:`, error);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    activeBots.set(botKey, botProcess);
    
    res.json({ 
        success: true, 
        message: 'LinkedIn bot started successfully',
        sessionDir: sanitizedId
    });
});

// Start Lead Generation
app.post('/start-leads', upload.none(), (req, res) => {
    const { uniqueId, keywords, location, maxLeads } = req.body;
    
    console.log(`Lead generation start request for session: ${uniqueId}`);
    console.log(`Request body:`, { uniqueId, keywords, location, maxLeads });
    
    if (!uniqueId) {
        return res.status(400).json({ success: false, message: 'Session ID is required' });
    }
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId, 'leads');
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Write configuration files
    fs.writeFileSync(path.join(sessionDir, 'keywords.txt'), keywords || 'software development, web development, mobile app');
    fs.writeFileSync(path.join(sessionDir, 'location.txt'), location || 'San Francisco');
    fs.writeFileSync(path.join(sessionDir, 'max_leads.txt'), maxLeads || '50');
    fs.writeFileSync(path.join(sessionDir, 'original_session_id.txt'), uniqueId);
    
    // Check if LinkedIn session exists (needed for LinkedIn lead generation)
    const linkedinSessionFile = path.join(__dirname, 'linkedin_session.json');
    if (!fs.existsSync(linkedinSessionFile)) {
        console.log('Warning: LinkedIn session not found. Lead generation will work but LinkedIn search may be limited.');
    }
    
    // Copy lead generator to session directory
    const originalLeadGen = path.join(__dirname, 'lead_generator.js');
    const sessionLeadGen = path.join(sessionDir, 'lead_generator.js');
    if (fs.existsSync(originalLeadGen)) {
        fs.copyFileSync(originalLeadGen, sessionLeadGen);
    }
    
    // Copy package.json if it exists for dependencies
    const originalPackage = path.join(__dirname, 'package.json');
    const sessionPackage = path.join(sessionDir, 'package.json');
    if (fs.existsSync(originalPackage)) {
        fs.copyFileSync(originalPackage, sessionPackage);
    }
    
    // Check if lead generation is already running
    const botKey = `leads_${uniqueId}`;
    if (activeBots.has(botKey)) {
        res.json({ success: false, message: 'Lead generation is already running for this session' });
        return;
    }
    
    // Start lead generation process
    console.log(`Starting lead generation for session: ${uniqueId}`);
    console.log(`Session directory: ${sessionDir}`);
    console.log(`Keywords: ${keywords}, Location: ${location}, Max: ${maxLeads}`);
    
    const leadProcess = spawn('node', ['lead_generator.js', `--keywords=${keywords}`, `--location=${location}`, `--max=${maxLeads}`, '--out=leads_report.json'], {
        cwd: sessionDir,
        env: { 
            ...process.env, 
            SESSION_ID: uniqueId,
            SANITIZED_SESSION_ID: sanitizedId
        },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Log output
    const logFile = path.join(sessionDir, 'bot.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    leadProcess.stdout.on('data', (data) => {
        logStream.write(data);
        console.log(`Lead Gen ${uniqueId}:`, data.toString().trim());
    });
    
    leadProcess.stderr.on('data', (data) => {
        logStream.write(data);
        console.error(`Lead Gen ${uniqueId} Error:`, data.toString().trim());
    });
    
    leadProcess.on('close', (code) => {
        console.log(`Lead generation ${uniqueId} completed with code ${code}`);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    leadProcess.on('error', (error) => {
        console.error(`Lead generation ${uniqueId} spawn error:`, error);
        activeBots.delete(botKey);
        logStream.end();
    });
    
    activeBots.set(botKey, leadProcess);
    
    res.json({ 
        success: true, 
        message: 'Lead generation started successfully',
        sessionDir: sanitizedId
    });
});

// Get leads report for dashboard
app.get('/get-leads/:uniqueId', (req, res) => {
    const { uniqueId } = req.params;
    const sanitizedId = sanitizeSessionId(uniqueId);
    const leadsDir = path.join(__dirname, 'sessions', sanitizedId, 'leads');

    try {
        if (!fs.existsSync(leadsDir)) {
            return res.status(404).json({ success: false, message: 'No leads directory found' });
        }

        // Collect all json reports (timestamped and default)
        const files = fs.readdirSync(leadsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(leadsDir, f);
                return {
                    name: f,
                    path: fullPath,
                    mtime: fs.statSync(fullPath).mtime
                };
            })
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length === 0) {
            return res.status(404).json({ success: false, message: 'No leads reports found' });
        }

        const latest = files[0];
        const report = JSON.parse(fs.readFileSync(latest.path, 'utf8'));

        return res.json({
            success: true,
            report,
            fileName: latest.name,
            generatedAt: latest.mtime
        });
    } catch (error) {
        console.error('Error reading leads report:', error);
        return res.status(500).json({ success: false, message: 'Error reading leads report' });
    }
});

// Download latest leads report
app.get('/download-leads/:uniqueId', (req, res) => {
    const { uniqueId } = req.params;
    const sanitizedId = sanitizeSessionId(uniqueId);
    const leadsDir = path.join(__dirname, 'sessions', sanitizedId, 'leads');

    if (!fs.existsSync(leadsDir)) {
        return res.status(404).json({ success: false, message: 'No leads directory found' });
    }

    const files = fs.readdirSync(leadsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const fullPath = path.join(leadsDir, f);
            return {
                name: f,
                path: fullPath,
                mtime: fs.statSync(fullPath).mtime
            };
        })
        .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
        return res.status(404).json({ success: false, message: 'No leads report found' });
    }

    const latest = files[0];
    return res.download(latest.path, `leads_report_${uniqueId}_${new Date().toISOString().split('T')[0]}.json`);
});

// Stop bot
app.post('/stop-bot', (req, res) => {
    const { uniqueId, botType } = req.body;
    const botKey = `${botType}_${uniqueId}`;
    
    if (activeBots.has(botKey)) {
        const botProcess = activeBots.get(botKey);
        
        // For Instagram bots, kill more forcefully
        if (botType === 'instagram') {
            try {
                if (process.platform === 'win32') {
                    require('child_process').exec(`taskkill /pid ${botProcess.pid} /T /F`, (error) => {
                        if (error) console.log(`Error killing Instagram bot: ${error}`);
                    });
                } else {
                    botProcess.kill('SIGKILL');
                }
            } catch (error) {
                console.log(`Error stopping Instagram bot: ${error}`);
            }
        } else {
            botProcess.kill();
        }
        
        activeBots.delete(botKey);
        console.log(`${botType} automation ${uniqueId} stopped`);
        res.json({ success: true, message: `${botType} automation stopped successfully` });
    } else {
        res.json({ success: false, message: 'Bot not found or already stopped' });
    }
});

// Get session status
app.get('/session-status/:uniqueId', (req, res) => {
    const { uniqueId } = req.params;
    
    if (!uniqueId) {
        return res.status(400).json({ success: false, message: 'Session ID is required' });
    }
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId);
    
    if (!fs.existsSync(sessionDir)) {
        return res.json({ 
            exists: false, 
            message: 'Session directory not found' 
        });
    }
    
    // Check LinkedIn session files
    const linkedinSessionFile = path.join(__dirname, 'linkedin_session.json');
    const sessionLinkedinFile = path.join(sessionDir, 'linkedin', 'linkedin_session.json');
    const hasLinkedInSession = fs.existsSync(linkedinSessionFile) || fs.existsSync(sessionLinkedinFile);
    
    // Check user data
    const linkedinUserData = path.join(__dirname, 'linkedin_user_data');
    const sessionUserData = path.join(sessionDir, 'linkedin', 'linkedin_user_data');
    const hasUserData = fs.existsSync(linkedinUserData) || fs.existsSync(sessionUserData);
    
    // Check session age
    let sessionAge = null;
    if (hasLinkedInSession) {
        try {
            const sessionFile = fs.existsSync(linkedinSessionFile) ? linkedinSessionFile : sessionLinkedinFile;
            const stats = fs.statSync(sessionFile);
            sessionAge = new Date(stats.mtime).toLocaleString();
        } catch (err) {
            console.log('Error getting session age:', err.message);
        }
    }
    
    // Check running processes
    const processes = {
        sessionCreator: sessionCreators.has(`creator_${uniqueId}`),
        linkedinBot: activeBots.has(`linkedin_${uniqueId}`),
        leadGeneration: activeBots.has(`leads_${uniqueId}`)
    };
    
    res.json({
        exists: true,
        sessionDir: sanitizedId,
        hasLinkedInSession,
        hasUserData,
        sessionAge,
        processes
    });
});

// Get bot status
app.get('/bot-status/:uniqueId/:botType', (req, res) => {
    const { uniqueId, botType } = req.params;
    const botKey = `${botType}_${uniqueId}`;
    
    const isRunning = activeBots.has(botKey);
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    const sessionDir = path.join(__dirname, 'sessions', sanitizedId, botType);
    
    let logs = '';
    try {
        const logFile = path.join(sessionDir, 'bot.log');
        if (fs.existsSync(logFile)) {
            logs = fs.readFileSync(logFile, 'utf8').split('\n').slice(-50).join('\n');
        }
    } catch (error) {
        logs = 'No logs available';
    }
    
    res.json({
        running: isRunning,
        logs: logs,
        sessionDir: sanitizedId
    });
});

// Remove session
app.post('/remove-session', (req, res) => {
    const { uniqueId } = req.body;
    
    if (!uniqueId) {
        res.json({ success: false, message: 'No unique ID provided' });
        return;
    }
    
    try {
        // Stop any active bots for this session first
        const whatsappBotKey = `whatsapp_${uniqueId}`;
        const instagramBotKey = `instagram_${uniqueId}`;
        
        // Kill WhatsApp bot if running
        if (activeBots.has(whatsappBotKey)) {
            const botProcess = activeBots.get(whatsappBotKey);
            try {
                botProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (activeBots.has(whatsappBotKey)) {
                        botProcess.kill('SIGKILL');
                    }
                }, 1000);
            } catch (e) {
                console.log('Error stopping WhatsApp bot:', e.message);
            }
            activeBots.delete(whatsappBotKey);
        }
        
        // Kill Instagram bot if running
        if (activeBots.has(instagramBotKey)) {
            const botProcess = activeBots.get(instagramBotKey);
            try {
                if (process.platform === 'win32') {
                    require('child_process').exec(`taskkill /pid ${botProcess.pid} /T /F`, (error) => {
                        if (error) console.log(`Error killing Instagram bot: ${error}`);
                    });
                } else {
                    botProcess.kill('SIGKILL');
                }
            } catch (e) {
                console.log('Error stopping Instagram bot:', e.message);
            }
            activeBots.delete(instagramBotKey);
        }
        
        // Wait for processes to terminate
        setTimeout(() => {
            // Remove from database
            db.run('DELETE FROM sessions WHERE id = ?', [uniqueId], function(err) {
                if (err) {
                    console.error('Database error:', err);
                    res.json({ success: false, message: 'Database error during removal' });
                    return;
                }
                
                // Mark session directory as deleted
                const sanitizedId = sanitizeSessionId(uniqueId);
                const sessionDir = path.join(__dirname, 'sessions', sanitizedId);
                const deletedSessionDir = path.join(__dirname, 'sessions', `${sanitizedId}_deleted_${Date.now()}`);
                
                if (fs.existsSync(sessionDir)) {
                    try {
                        setTimeout(() => {
                            try {
                                fs.renameSync(sessionDir, deletedSessionDir);
                                console.log(`Session ${uniqueId} marked as deleted`);
                            } catch (renameError) {
                                // Alternative: create a .deleted marker file
                                try {
                                    fs.writeFileSync(path.join(sessionDir, '.deleted'), new Date().toISOString());
                                    console.log(`Session ${uniqueId} marked as deleted with marker file`);
                                } catch (markerError) {
                                    console.error('Could not create deletion marker:', markerError.message);
                                }
                            }
                        }, 500);
                    } catch (error) {
                        console.error('Error accessing session directory:', error.message);
                    }
                }
                
                res.json({ 
                    success: true, 
                    message: 'Session removed successfully. Redirecting to login...' 
                });
            });
        }, 2000);
        
    } catch (error) {
        console.error('Error removing session:', error);
        res.json({ success: false, message: 'Error removing session' });
    }
});

// Start server
async function startServer() {
    try {
        // If PORT is provided, use it; otherwise find an open one starting at 3000
        const portToUse = process.env.PORT ? port : await findAvailablePort(port || 3000);
        port = portToUse;
        app.listen(portToUse, HOST, () => {
            console.log(`🚀 WOAT Bot Control Server running on http://localhost:${port}`);
            console.log(`🌐 Server accessible at http://${HOST}:${port}`);
            console.log('📱 Access the interface in your web browser');
            console.log('🔧 CORS enabled for all origins');
            console.log('🔍 Health check available at: /health');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    
    // Gracefully stop all active bots
    activeBots.forEach((botProcess, botKey) => {
        try {
            console.log(`Stopping bot: ${botKey}`);
            if (botKey.includes('instagram')) {
                if (process.platform === 'win32') {
                    require('child_process').exec(`taskkill /pid ${botProcess.pid} /T /F`);
                } else {
                    botProcess.kill('SIGKILL');
                }
            } else {
                botProcess.kill('SIGTERM');
            }
        } catch (e) {
            console.log(`Error stopping bot ${botKey}:`, e.message);
        }
    });
    
    activeBots.clear();
    
    // Close database
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.emit('SIGINT');
});
