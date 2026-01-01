from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import sqlite3
import os
import shutil
import subprocess
import json
import asyncio
import signal
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
import uuid
import re
import socket

app = FastAPI(title="Bot Control Server - WhatsApp & LinkedIn", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
active_bots: Dict[str, subprocess.Popen] = {}
DB_PATH = "sessions.db"

# Pydantic models
class SessionVerification(BaseModel):
    uniqueId: str
    secretKey: str
    email: Optional[str] = None

class WhatsAppBotConfig(BaseModel):
    uniqueId: str
    personality: Optional[str] = "Default personality"
    contacts: Optional[str] = "ALL"
    excludeContacts: Optional[str] = ""

class LinkedInBotConfig(BaseModel):
    uniqueId: str
    systemPrompt: Optional[str] = None
    relationshipLevel: Optional[str] = "professional"
    maxReplies: Optional[int] = 5
    hoursRecent: Optional[int] = 24
    testMode: Optional[bool] = True

class BotStop(BaseModel):
    uniqueId: str
    botType: str

class SessionRemoval(BaseModel):
    uniqueId: str

class LeadGenerationRequest(BaseModel):
    uniqueId: str
    keywords: Optional[List[str]] = ["software development", "web development", "mobile app"]
    location: Optional[str] = ""
    maxLeads: Optional[int] = 50
    includeApproachStrategy: Optional[bool] = True

# Helper functions
def find_available_port(start_port: int = 8000) -> int:
    """Find an available port starting from start_port"""
    port = start_port
    while True:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            port += 1
        if port > start_port + 100:  # Limit search range
            raise Exception("No available ports found")

def sanitize_session_id(session_id: str) -> str:
    """Sanitize session ID for file system use"""
    return (session_id
            .replace('@', '_at_')
            .replace('<', '_lt_').replace('>', '_gt_')
            .replace(':', '_colon_').replace('"', '_quote_')
            .replace('/', '_slash_').replace('\\', '_backslash_')
            .replace('|', '_pipe_').replace('?', '_question_')
            .replace('*', '_asterisk_').replace('.', '_dot_')
            .replace(' ', '_'))

def init_database():
    """Initialize SQLite database"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Main sessions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            secret_key TEXT NOT NULL,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # LinkedIn sessions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS linkedin_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            session_file TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id)
        )
    ''')
    
    # Leads table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT,
            title TEXT,
            company TEXT,
            location TEXT,
            profile_url TEXT,
            snippet TEXT,
            source TEXT,
            score INTEGER DEFAULT 0,
            approach_strategy TEXT,
            status TEXT DEFAULT 'new',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            contacted_at DATETIME,
            notes TEXT
        )
    ''')
    
    # Lead generation jobs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS lead_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            keywords TEXT,
            location TEXT,
            status TEXT DEFAULT 'pending',
            total_leads INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    """Get database connection"""
    return sqlite3.connect(DB_PATH)

# API Endpoints
@app.get("/")
async def root():
    return {
        "message": "Bot Control Server - WhatsApp & LinkedIn",
        "version": "1.0.0",
        "status": "running",
        "bots": ["whatsapp", "linkedin"]
    }

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "Server is running",
        "timestamp": datetime.now().isoformat(),
        "active_bots": list(active_bots.keys())
    }

@app.post("/verify-session")
async def verify_session(session_data: SessionVerification):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check existing session
        cursor.execute(
            "SELECT * FROM sessions WHERE id = ? AND secret_key = ?",
            (session_data.uniqueId, session_data.secretKey)
        )
        row = cursor.fetchone()
        
        if row:
            # Update last used timestamp
            if session_data.email and session_data.email != row[2]:
                cursor.execute(
                    "UPDATE sessions SET last_used = CURRENT_TIMESTAMP, email = ? WHERE id = ?",
                    (session_data.email, session_data.uniqueId)
                )
            else:
                cursor.execute(
                    "UPDATE sessions SET last_used = CURRENT_TIMESTAMP WHERE id = ?",
                    (session_data.uniqueId,)
                )
            conn.commit()
            return {"success": True, "message": "Session verified"}
        else:
            # Check if session exists with different key
            cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_data.uniqueId,))
            existing_row = cursor.fetchone()
            
            if existing_row:
                return {"success": False, "message": "Invalid secret key"}
            else:
                # Create new session
                cursor.execute(
                    "INSERT INTO sessions (id, secret_key, email) VALUES (?, ?, ?)",
                    (session_data.uniqueId, session_data.secretKey, session_data.email)
                )
                conn.commit()
                return {"success": True, "message": "New session created successfully!"}
                
    except Exception as e:
        return {"success": False, "message": f"Database error: {str(e)}"}
    finally:
        conn.close()

@app.post("/start-whatsapp")
async def start_whatsapp_bot(config: WhatsAppBotConfig):
    sanitized_id = sanitize_session_id(config.uniqueId)
    session_dir = Path("sessions") / sanitized_id / "whatsapp"
    session_dir.mkdir(parents=True, exist_ok=True)
    
    # Write configuration files
    (session_dir / "personality.txt").write_text(config.personality or "Default personality")
    (session_dir / "contacts.txt").write_text(config.contacts or "ALL")
    (session_dir / "exclude_contacts.txt").write_text(config.excludeContacts or "")
    (session_dir / "original_session_id.txt").write_text(config.uniqueId)
    
    # Copy bot files to session directory
    bot_files = ["smart_whatsapp_bot.js", "gemini_bot.py"]
    for bot_file in bot_files:
        if Path(bot_file).exists():
            shutil.copy2(bot_file, session_dir / bot_file)
    
    # Check if bot is already running
    bot_key = f"whatsapp_{config.uniqueId}"
    if bot_key in active_bots:
        return {"success": False, "message": "WhatsApp bot is already running for this session"}
    
    try:
        # Start WhatsApp bot process
        env = os.environ.copy()
        env.update({
            "SESSION_ID": config.uniqueId,
            "SANITIZED_SESSION_ID": sanitized_id
        })
        
        process = subprocess.Popen(
            ["node", "smart_whatsapp_bot.js"],
            cwd=str(session_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        active_bots[bot_key] = process
        
        # Log process output asynchronously
        asyncio.create_task(log_bot_output(process, session_dir / "bot.log", f"WhatsApp Bot {config.uniqueId}"))
        
        return {
            "success": True,
            "message": "WhatsApp bot started successfully",
            "sessionDir": sanitized_id,
            "process_id": process.pid
        }
        
    except Exception as e:
        return {"success": False, "message": f"Failed to start WhatsApp bot: {str(e)}"}

@app.post("/start-linkedin")
async def start_linkedin_bot(config: LinkedInBotConfig):
    sanitized_id = sanitize_session_id(config.uniqueId)
    session_dir = Path("sessions") / sanitized_id / "linkedin"
    session_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy LinkedIn bot files to session directory
    bot_files = ["scraper.js", "manual_session_creator.js", "package.json"]
    for bot_file in bot_files:
        if Path(bot_file).exists():
            shutil.copy2(bot_file, session_dir / bot_file)
    
    # Copy or link LinkedIn session data
    linkedin_session_file = Path("linkedin_session.json")
    linkedin_user_data = Path("linkedin_user_data")
    
    if linkedin_session_file.exists():
        shutil.copy2(linkedin_session_file, session_dir / "linkedin_session.json")
    
    if linkedin_user_data.exists():
        shutil.copytree(linkedin_user_data, session_dir / "linkedin_user_data", dirs_exist_ok=True)
    
    # Store LinkedIn session info in database
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO linkedin_sessions (user_id, session_file, last_used)
        VALUES (?, ?, CURRENT_TIMESTAMP)
    ''', (config.uniqueId, str(session_dir / "linkedin_session.json")))
    conn.commit()
    conn.close()
    
    # Check if bot is already running
    bot_key = f"linkedin_{config.uniqueId}"
    if bot_key in active_bots:
        return {"success": False, "message": "LinkedIn bot is already running for this session"}
    
    try:
        # Create bot configuration
        bot_config = {
            "systemPrompt": config.systemPrompt,
            "relationshipLevel": config.relationshipLevel,
            "maxReplies": config.maxReplies,
            "hoursRecent": config.hoursRecent,
            "testMode": config.testMode
        }
        
        # Write config to file
        (session_dir / "bot_config.json").write_text(json.dumps(bot_config))
        
        # Start LinkedIn bot process
        env = os.environ.copy()
        env.update({
            "SESSION_ID": config.uniqueId,
            "SANITIZED_SESSION_ID": sanitized_id
        })
        
        process = subprocess.Popen(
            ["node", "scraper.js", "--linkedin-bot", "--headful"],
            cwd=str(session_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        active_bots[bot_key] = process
        
        # Log process output asynchronously
        asyncio.create_task(log_bot_output(process, session_dir / "bot.log", f"LinkedIn Bot {config.uniqueId}"))
        
        return {
            "success": True,
            "message": "LinkedIn bot started successfully",
            "sessionDir": sanitized_id,
            "process_id": process.pid,
            "testMode": config.testMode
        }
        
    except Exception as e:
        return {"success": False, "message": f"Failed to start LinkedIn bot: {str(e)}"}

@app.post("/stop-bot")
async def stop_bot(config: BotStop):
    bot_key = f"{config.botType}_{config.uniqueId}"
    
    if bot_key in active_bots:
        process = active_bots[bot_key]
        
        try:
            # Kill process based on bot type
            if config.botType == "linkedin":
                # LinkedIn uses Node.js, terminate normally
                process.terminate()
            else:
                # WhatsApp also uses Node.js
                process.terminate()
                
            # Wait for process to terminate
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                
            del active_bots[bot_key]
            
            return {"success": True, "message": f"{config.botType} bot stopped successfully"}
            
        except Exception as e:
            return {"success": False, "message": f"Error stopping bot: {str(e)}"}
    else:
        return {"success": False, "message": "Bot not found or already stopped"}

@app.get("/bot-status/{unique_id}/{bot_type}")
async def get_bot_status(unique_id: str, bot_type: str):
    bot_key = f"{bot_type}_{unique_id}"
    is_running = bot_key in active_bots
    
    sanitized_id = sanitize_session_id(unique_id)
    session_dir = Path("sessions") / sanitized_id / bot_type
    
    logs = ""
    try:
        log_file = session_dir / "bot.log"
        if log_file.exists():
            with open(log_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                logs = ''.join(lines[-50:])  # Get last 50 lines
    except Exception:
        logs = "No logs available"
    
    return {
        "running": is_running,
        "logs": logs,
        "sessionDir": sanitized_id
    }

@app.post("/remove-session")
async def remove_session(config: SessionRemoval):
    if not config.uniqueId:
        return {"success": False, "message": "No unique ID provided"}
    
    try:
        # Stop any active bots for this session
        whatsapp_key = f"whatsapp_{config.uniqueId}"
        linkedin_key = f"linkedin_{config.uniqueId}"
        
        for bot_key in [whatsapp_key, linkedin_key]:
            if bot_key in active_bots:
                process = active_bots[bot_key]
                try:
                    process.terminate()
                    
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        
                    del active_bots[bot_key]
                except Exception as e:
                    print(f"Error stopping {bot_key}: {e}")
        
        # Wait for processes to terminate
        await asyncio.sleep(2)
        
        # Remove from database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE id = ?", (config.uniqueId,))
        cursor.execute("DELETE FROM linkedin_sessions WHERE user_id = ?", (config.uniqueId,))
        conn.commit()
        conn.close()
        
        # Mark session directory as deleted
        sanitized_id = sanitize_session_id(config.uniqueId)
        session_dir = Path("sessions") / sanitized_id
        deleted_session_dir = Path("sessions") / f"{sanitized_id}_deleted_{int(datetime.now().timestamp())}"
        
        if session_dir.exists():
            try:
                session_dir.rename(deleted_session_dir)
                print(f"Session {config.uniqueId} marked as deleted")
            except Exception:
                # Alternative: create a .deleted marker file
                try:
                    (session_dir / ".deleted").write_text(datetime.now().isoformat())
                    print(f"Session {config.uniqueId} marked as deleted with marker file")
                except Exception as e:
                    print(f"Could not create deletion marker: {e}")
        
        return {
            "success": True,
            "message": "Session removed successfully"
        }
        
    except Exception as e:
        print(f"Error removing session: {e}")
        return {"success": False, "message": "Error removing session"}

@app.post("/generate-leads")
async def generate_leads(request: LeadGenerationRequest):
    """Generate leads for software development services"""
    sanitized_id = sanitize_session_id(request.uniqueId)
    session_dir = Path("sessions") / sanitized_id / "leads"
    session_dir.mkdir(parents=True, exist_ok=True)
    
    # Check if lead generation is already running
    job_key = f"leads_{request.uniqueId}"
    if job_key in active_bots:
        return {"success": False, "message": "Lead generation is already running for this session"}
    
    # Create job record
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO lead_jobs (user_id, keywords, location, status)
        VALUES (?, ?, ?, 'running')
    ''', (request.uniqueId, ','.join(request.keywords), request.location))
    job_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    try:
        # Copy lead generator to session directory
        if Path("lead_generator.js").exists():
            shutil.copy2("lead_generator.js", session_dir / "lead_generator.js")
        
        # Build command arguments
        cmd = [
            "node", "lead_generator.js",
            f"--keywords={','.join(request.keywords)}",
            f"--location={request.location}",
            f"--max={request.maxLeads}",
            f"--out=leads_report.json"
        ]
        
        # Start lead generation process
        env = os.environ.copy()
        env.update({
            "SESSION_ID": request.uniqueId,
            "JOB_ID": str(job_id)
        })
        
        process = subprocess.Popen(
            cmd,
            cwd=str(session_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        active_bots[job_key] = process
        
        # Log process output and save leads to database
        asyncio.create_task(log_lead_generation(process, session_dir, request.uniqueId, job_id))
        
        return {
            "success": True,
            "message": "Lead generation started",
            "jobId": job_id,
            "process_id": process.pid
        }
        
    except Exception as e:
        # Update job status to failed
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE lead_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (job_id,))
        conn.commit()
        conn.close()
        
        return {"success": False, "message": f"Failed to start lead generation: {str(e)}"}

@app.get("/leads/{unique_id}")
async def get_leads(unique_id: str, status: Optional[str] = None, min_score: Optional[int] = 0):
    """Get generated leads for a user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM leads WHERE user_id = ? AND score >= ?"
    params = [unique_id, min_score]
    
    if status:
        query += " AND status = ?"
        params.append(status)
    
    query += " ORDER BY score DESC, created_at DESC"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    leads = []
    for row in rows:
        leads.append({
            "id": row[0],
            "name": row[2],
            "title": row[3],
            "company": row[4],
            "location": row[5],
            "profileUrl": row[6],
            "snippet": row[7],
            "source": row[8],
            "score": row[9],
            "approachStrategy": row[10],
            "status": row[11],
            "createdAt": row[12],
            "contactedAt": row[13],
            "notes": row[14]
        })
    
    return {"success": True, "leads": leads, "total": len(leads)}

@app.get("/lead-jobs/{unique_id}")
async def get_lead_jobs(unique_id: str):
    """Get lead generation job history"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM lead_jobs WHERE user_id = ? ORDER BY created_at DESC
    ''', (unique_id,))
    rows = cursor.fetchall()
    conn.close()
    
    jobs = []
    for row in rows:
        jobs.append({
            "id": row[0],
            "keywords": row[2],
            "location": row[3],
            "status": row[4],
            "totalLeads": row[5],
            "createdAt": row[6],
            "completedAt": row[7]
        })
    
    return {"success": True, "jobs": jobs}

@app.put("/leads/{lead_id}/status")
async def update_lead_status(lead_id: int, status: str = "contacted", notes: Optional[str] = None):
    """Update lead status (new, contacted, qualified, closed, rejected)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if status == "contacted":
        cursor.execute('''
            UPDATE leads SET status = ?, contacted_at = CURRENT_TIMESTAMP, notes = ?
            WHERE id = ?
        ''', (status, notes, lead_id))
    else:
        cursor.execute('''
            UPDATE leads SET status = ?, notes = ?
            WHERE id = ?
        ''', (status, notes, lead_id))
    
    conn.commit()
    conn.close()
    
    return {"success": True, "message": f"Lead status updated to {status}"}

@app.post("/stop-lead-generation")
async def stop_lead_generation(uniqueId: str):
    """Stop ongoing lead generation"""
    job_key = f"leads_{uniqueId}"
    
    if job_key in active_bots:
        process = active_bots[job_key]
        try:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            
            del active_bots[job_key]
            return {"success": True, "message": "Lead generation stopped"}
        except Exception as e:
            return {"success": False, "message": f"Error stopping lead generation: {str(e)}"}
    else:
        return {"success": False, "message": "No lead generation running"}

# Helper function for logging lead generation output
async def log_lead_generation(process: subprocess.Popen, session_dir: Path, user_id: str, job_id: int):
    """Log lead generation output and save leads to database"""
    log_file = session_dir / "lead_generation.log"
    
    try:
        with open(log_file, 'a', encoding='utf-8') as log:
            while True:
                if process.stdout:
                    output = process.stdout.readline()
                    if output:
                        log.write(output)
                        log.flush()
                        print(f"Lead Gen {user_id}: {output.strip()}")
                
                if process.stderr:
                    error = process.stderr.readline()
                    if error:
                        log.write(error)
                        log.flush()
                        print(f"Lead Gen {user_id} Error: {error.strip()}")
                
                if process.poll() is not None:
                    break
                    
                await asyncio.sleep(0.1)
        
        # Process completed, load results and save to database
        report_file = session_dir / "leads_report.json"
        if report_file.exists():
            with open(report_file, 'r', encoding='utf-8') as f:
                report = json.load(f)
            
            # Save leads to database
            conn = get_db_connection()
            cursor = conn.cursor()
            
            leads_count = 0
            for lead in report.get('leads', []):
                cursor.execute('''
                    INSERT INTO leads (
                        user_id, name, title, company, location, profile_url,
                        snippet, source, score, approach_strategy, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
                ''', (
                    user_id,
                    lead.get('name', ''),
                    lead.get('title', ''),
                    lead.get('company', ''),
                    lead.get('location', ''),
                    lead.get('profileUrl', lead.get('url', '')),
                    lead.get('snippet', lead.get('tweet', '')),
                    lead.get('source', ''),
                    lead.get('score', 0),
                    lead.get('approachStrategy', '')
                ))
                leads_count += 1
            
            # Update job status
            cursor.execute('''
                UPDATE lead_jobs SET status = 'completed', total_leads = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (leads_count, job_id))
            
            conn.commit()
            conn.close()
            
            print(f"✅ Saved {leads_count} leads to database for user {user_id}")
        
        # Remove from active bots
        job_key = f"leads_{user_id}"
        if job_key in active_bots:
            del active_bots[job_key]
            
    except Exception as e:
        print(f"Error in lead generation logging: {e}")
        
        # Update job status to failed
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE lead_jobs SET status = 'failed', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (job_id,))
            conn.commit()
            conn.close()
        except:
            pass

# Helper function for logging bot output
async def log_bot_output(process: subprocess.Popen, log_file: Path, bot_name: str):
    """Asynchronously log bot output to file and console"""
    try:
        with open(log_file, 'a', encoding='utf-8') as log:
            while True:
                # Read stdout
                if process.stdout:
                    output = process.stdout.readline()
                    if output:
                        log.write(output)
                        log.flush()
                        if any(keyword in output for keyword in ['ERROR', 'started', 'stopped', 'Bot result:']):
                            print(f"{bot_name}: {output.strip()}")
                
                # Read stderr
                if process.stderr:
                    error = process.stderr.readline()
                    if error:
                        log.write(error)
                        log.flush()
                        if any(keyword in error for keyword in ['- INFO -', '- WARNING -', 'Successfully', 'Message sent:', 'started', 'stopped']):
                            print(f"{bot_name}: {error.strip()}")
                        elif any(keyword in error for keyword in ['- ERROR -', '- CRITICAL -', 'Exception', 'Traceback']):
                            print(f"{bot_name} Error: {error.strip()}")
                
                # Check if process is still running
                if process.poll() is not None:
                    break
                    
                await asyncio.sleep(0.1)
                
    except Exception as e:
        print(f"Error logging output for {bot_name}: {e}")

# Startup event
@app.on_event("startup")
async def startup_event():
    print("🚀 Bot Control Server - WhatsApp & LinkedIn")
    init_database()
    print("📚 Database initialized")
    print("🤖 Ready to manage WhatsApp and LinkedIn bots")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    print("🛑 Shutting down server...")
    
    # Stop all active bots
    for bot_key, process in list(active_bots.items()):
        try:
            print(f"Stopping bot: {bot_key}")
            process.terminate()
            
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                
        except Exception as e:
            print(f"Error stopping bot {bot_key}: {e}")
    
    active_bots.clear()
    print("✅ All bots stopped")

if __name__ == "__main__":
    import uvicorn
    
    # Find available port
    try:
        port = find_available_port(8000)
        print(f"🌐 Starting server on port {port}")
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=port,
            reload=False,
            access_log=True
        )
    except Exception as e:
        print(f"Failed to start server: {e}")