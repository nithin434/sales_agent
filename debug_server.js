// Debug helper for testing server endpoints
const path = require('path');
const fs = require('fs');

function sanitizeSessionId(sessionId) {
    return sessionId
        .replace(/[@]/g, '_at_')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\./g, '_dot_')
        .replace(/\s+/g, '_');
}

// Test session creation
function testSessionCreation(uniqueId) {
    console.log('Testing session creation for:', uniqueId);
    
    const sanitizedId = sanitizeSessionId(uniqueId);
    console.log('Sanitized ID:', sanitizedId);
    
    // Test LinkedIn session
    const linkedinDir = path.join(__dirname, 'sessions', sanitizedId, 'linkedin');
    console.log('LinkedIn session dir:', linkedinDir);
    
    if (!fs.existsSync(linkedinDir)) {
        fs.mkdirSync(linkedinDir, { recursive: true });
        console.log('✅ Created LinkedIn session directory');
    } else {
        console.log('✅ LinkedIn session directory exists');
    }
    
    // Test Lead generation session  
    const leadsDir = path.join(__dirname, 'sessions', sanitizedId, 'leads');
    console.log('Leads session dir:', leadsDir);
    
    if (!fs.existsSync(leadsDir)) {
        fs.mkdirSync(leadsDir, { recursive: true });
        console.log('✅ Created leads session directory');
    } else {
        console.log('✅ Leads session directory exists');
    }
    
    // Check if files exist
    const scraper = path.join(__dirname, 'scraper_v2.js');
    const leadGen = path.join(__dirname, 'lead_generator.js');
    
    console.log('✅ scraper_v2.js exists:', fs.existsSync(scraper));
    console.log('✅ lead_generator.js exists:', fs.existsSync(leadGen));
    
    return { sanitizedId, linkedinDir, leadsDir };
}

// Test specific session
const testSessionId = 'test@example.com';
testSessionCreation(testSessionId);