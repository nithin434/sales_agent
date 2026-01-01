const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
let port = 3000;

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
    const allowedOrigins = [
        'https://nithin434.github.io',
        'https://nithin434.github.io/woat_launch/',
        'https://thoroughly-judge-nomination-children.trycloudflare.com',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001'
    ];
    
    const origin = req.headers.origin;
    
    // Allow the origin if it's in the allowed list or if there's no origin (direct access)
    if (!origin || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
    } else {
        res.header('Access-Control-Allow-Origin', '*'); // Fallback to allow all
    }
    
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
        console.log(`${botType} bot ${uniqueId} stopped`);
        res.json({ success: true, message: `${botType} bot stopped successfully` });
    } else {
        res.json({ success: false, message: 'Bot not found or already stopped' });
    }
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
        port = await findAvailablePort(3000);
        app.listen(port, '0.0.0.0', () => {
            console.log(`🚀 WOAT Bot Control Server running on http://localhost:${port}`);
            console.log(`🌐 Server accessible at http://0.0.0.0:${port}`);
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
