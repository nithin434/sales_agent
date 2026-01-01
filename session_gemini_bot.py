#!/usr/bin/env python3

import sys
import os
import sqlite3
import json
from pathlib import Path

def setup_session_environment():
    """Setup session-specific environment"""
    session_id = os.environ.get('SESSION_ID', 'default')
    session_dir = Path(f'sessions/{session_id}/instagram')
    session_dir.mkdir(parents=True, exist_ok=True)
    
    # Change working directory to session directory
    os.chdir(session_dir)
    
    return session_id, session_dir

# Setup session environment first
session_id, session_dir = setup_session_environment()

# Now import the rest after changing directory
import google.generativeai as genai
import json
import logging
from datetime import datetime
import re
from collections import Counter

# Configure logging to write to session directory
log_file = session_dir / 'bot.log'
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)

# Configuration
GEMINI_API_KEY = "AIzaSyBsOChWdEgk7ResbVkk9WcLor2w127NO4U"
MODEL_NAME = "gemini-2.0-flash"

# Load personality from session directory
personality_file = session_dir / 'personality.txt'
if personality_file.exists():
    with open(personality_file, 'r', encoding='utf-8') as f:
        BOT_PERSONALITY = f.read().strip()
else:
    BOT_PERSONALITY = """You are Nithin responding to Instagram DMs. Be casual, friendly, and authentic. Keep responses under 40 words and use normal punctuation only."""

def setup_gemini():
    try:
        if GEMINI_API_KEY == "YOUR_GEMINI_API_KEY_HERE":
            raise ValueError("Please set your actual Gemini API key in the script")
        
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(MODEL_NAME)
        return model
    except Exception as e:
        logging.error(f"Failed to setup Gemini: {e}")
        return None

def get_ai_response(user_message, username):
    """Get AI response using Gemini"""
    try:
        model = setup_gemini()
        if not model:
            return "Hey! Got your message, will get back to you soon."
        
        system_message = f"""
        {BOT_PERSONALITY}
        
        STRICT REQUIREMENTS:
        - Respond without excessive emojis (max 1-2 if needed)
        - Use normal punctuation and casual text style
        - Sound like a real person texting, not an AI
        - Be natural, conversational, and engaging
        - Keep response under 40 words
        - Respond as if you're Nithin personally
        - NO mention of AI or being a bot
        """
        
        user_content = f'New DM from {username}: "{user_message}"\n\nRespond as Nithin:'
        
        response = model.generate_content(
            f"{system_message}\n\n{user_content}",
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=100,
                temperature=0.8,
                top_p=0.9,
                top_k=30
            )
        )
        
        if response and hasattr(response, 'text') and response.text:
            # Clean response
            clean_response = response.text.strip()
            clean_response = ''.join(char if ord(char) < 128 else '' for char in clean_response)
            
            if clean_response and len(clean_response.strip()) > 0:
                return clean_response.strip()
        
        return "Hey! Got your message, will get back to you soon."
        
    except Exception as e:
        logging.error(f"Error getting AI response: {e}")
        return "Hey! Thanks for the message, will respond soon."

def main():
    """Main function for testing"""
    if len(sys.argv) >= 3:
        message = sys.argv[1]
        username = sys.argv[2]
        response = get_ai_response(message, username)
        print(response)
    else:
        print("Usage: python session_gemini_bot.py <message> <username>")

if __name__ == "__main__":
    main()