import requests
import json
import time
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
import logging
from datetime import datetime
import socketserver
from playwright.sync_api import sync_playwright
import random
from collections import deque
import hashlib
from dotenv import load_dotenv
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

log_buffer = deque(maxlen=500)

class LogHandler(logging.Handler):
    def emit(self, record):
        log_entry = self.format(record)
        log_buffer.append(log_entry)

log_handler = LogHandler()
log_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logging.getLogger().addHandler(log_handler)

class InstagramBot:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.page = None
        self.context = None
        self.is_running = False
        self.monitored_users = set()
        self.processed_messages = set()
        self.last_checked = {}
        self.bot_personality = """You are Nithin responding to Instagram DMs. Be casual, friendly, and authentic. Match the vibe of whoever you're talking to. Keep responses under 40 words and use normal punctuation only."""
        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
        self.monitor_thread = None
        self.current_conversation_id = None
        self.session_dir = "instagram_session"
        self.sent_initial_response = set()
        self.message_tracking_file = "message_tracking.json"
        self.bot_messages = set()  
        self.conversation_states = {} 
        self.monitoring_start_time = {}  
        self.last_responded_message = {}  
        
        # Load previous message tracking
        self.load_message_tracking()

    def load_message_tracking(self):
        try:
            if os.path.exists(self.message_tracking_file):
                with open(self.message_tracking_file, 'r') as f:
                    data = json.load(f)
                    self.processed_messages = set(data.get('processed_messages', []))
                    self.bot_messages = set(data.get('bot_messages', []))
                    self.conversation_states = data.get('conversation_states', {})
                    self.sent_initial_response = set(data.get('sent_initial_response', []))
                    self.last_responded_message = data.get('last_responded_message', {})
                    logging.info(f"Loaded {len(self.processed_messages)} processed messages from tracking file")
        except Exception as e:
            logging.warning(f"Could not load message tracking: {e}")
            
    def save_message_tracking(self):
        try:
            data = {
                'processed_messages': list(self.processed_messages),
                'bot_messages': list(self.bot_messages),
                'conversation_states': self.conversation_states,
                'sent_initial_response': list(self.sent_initial_response),
                'last_responded_message': self.last_responded_message
            }
            with open(self.message_tracking_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logging.error(f"Failed to save message tracking: {e}")

    def generate_message_id(self, text, conversation_id, element_position=None):
        try:
            text_clean = text.strip().lower()
            base_string = f"{conversation_id}:{text_clean}"
            
            if element_position:
                base_string += f":{element_position}"
                
            message_id = hashlib.md5(base_string.encode()).hexdigest()[:16]
            return message_id
        except Exception as e:
            logging.debug(f"Error generating message ID: {e}")
            return f"{conversation_id}_{hash(text)}_{int(time.time())}"

    def setup_headless_browser(self):
        try:
            if self.playwright:
                try:
                    self.playwright.stop()
                except:
                    pass
            if not os.path.exists(self.session_dir):
                os.makedirs(self.session_dir)
            
            self.playwright = sync_playwright().start()
            
            self.browser = self.playwright.chromium.launch(
                headless=False,  
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-extensions-except',
                    '--disable-plugins-discovery',
                    '--no-first-run',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--window-size=1366,768'
                ]
            )
            
            self.context = self.browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1366, 'height': 768},
                locale='en-US',
                timezone_id='America/New_York',
                storage_state=os.path.join(self.session_dir, 'session.json') if os.path.exists(os.path.join(self.session_dir, 'session.json')) else None
            )
            self.page = self.context.new_page()
            
            logging.info("Playwright browser setup successfully with session storage")
            return True
        except Exception as e:
            logging.error(f"Failed to setup Playwright browser: {e}")
            return False

    def save_session(self):
    
        try:
            session_file = os.path.join(self.session_dir, 'session.json')
            storage_state = self.context.storage_state()
            with open(session_file, 'w') as f:
                json.dump(storage_state, f)
        except Exception as e:
            logging.error(f"Failed to save session: {e}")

    def add_human_delays(self):
        delay = random.uniform(1, 3)
        time.sleep(delay)

    def simulate_human_behavior(self):
        try:
            # Random mouse movements
            self.page.mouse.move(
                random.randint(100, 800),
                random.randint(100, 600)
            )
            time.sleep(random.uniform(0.5, 1.5))
            
            # Random scroll
            self.page.mouse.wheel(0, random.randint(-200, 200))
            time.sleep(random.uniform(0.5, 1))
            
        except Exception as e:
            logging.debug(f"Human behavior simulation error: {e}")

    def load_cookies_from_json(self, json_file_path):
        try:
            if not self.page:
                if not self.setup_headless_browser():
                    return False
            
            # Navigate to Instagram first
            logging.info("Navigating to Instagram...")
            self.page.goto("https://www.instagram.com", wait_until='networkidle', timeout=60000)
            
            # Add human-like delay
            self.add_human_delays()
            
            with open(json_file_path, 'r') as f:
                cookies_data = json.load(f)
            
            #logging.info(f"Loading {len(cookies_data)} cookies...")
            
            # Convert cookies to Playwright format
            playwright_cookies = []
            for cookie in cookies_data:
                try:
                    same_site_mapping = {
                        'no_restriction': 'None',
                        'lax': 'Lax', 
                        'strict': 'Strict',
                        'unspecified': 'Lax'
                    }
                    
                    playwright_cookie = {
                        'name': cookie['name'],
                        'value': cookie['value'],
                        'domain': cookie['domain'],
                        'path': cookie.get('path', '/'),
                        'secure': cookie.get('secure', True),
                        'httpOnly': cookie.get('httpOnly', False)
                    }
                    
                    raw_same_site = cookie.get('sameSite', 'Lax')
                    if isinstance(raw_same_site, str):
                        raw_same_site = raw_same_site.lower()
                    
                    playwright_cookie['sameSite'] = same_site_mapping.get(raw_same_site, 'Lax')
                    
                    if 'expirationDate' in cookie and cookie['expirationDate']:
                        try:
                            expiry_timestamp = float(cookie['expirationDate'])
                            if expiry_timestamp > time.time():
                                playwright_cookie['expires'] = int(expiry_timestamp)
                        except (ValueError, TypeError):
                            logging.warning(f"Invalid expiry date for cookie {cookie['name']}")
                    
                    playwright_cookies.append(playwright_cookie)
                    
                except Exception as cookie_error:
                    logging.warning(f"Failed to convert cookie {cookie.get('name', 'unknown')}: {cookie_error}")
                    continue
            
            if not playwright_cookies:
                logging.error("No valid cookies to add")
                return False
            
            self.context.add_cookies(playwright_cookies)
            
            logging.info("Refreshing page to open instagram......")
            try:
                self.page.reload(wait_until='domcontentloaded', timeout=60000)
                time.sleep(3)
                logging.info("Page refreshed successfully - cookies applied")
                
                self.save_session()
                
            except Exception as refresh_error:
                logging.warning(f"Page refresh had issues but continuing: {refresh_error}")
            
            logging.info(" loaded successfully - assuming login is working")
            return True
                
        except Exception as e:
            logging.error(f"Error loading cookies: {e}")
            return False

    def verify_instagram_login_with_retries(self):
        logging.info("Skipping login verification - proceeding with bot operations")
        return True

    def navigate_to_direct_inbox(self):
        try:
            inbox_url = "https://www.instagram.com/direct/inbox/"
            logging.info(f"Navigating to inbox: {inbox_url}")
            
            self.page.goto(inbox_url, wait_until='domcontentloaded', timeout=30000)
            time.sleep(5)
        
            inbox_indicators = [
                'div[role="grid"]',
                '[aria-label*="conversation"]',
                '[data-testid*="conversation"]',
                'div[aria-label*="Direct"]'
            ]
            
            for indicator in inbox_indicators:
                try:
                    element = self.page.wait_for_selector(indicator, timeout=5000)
                    if element:
                        logging.info("Successfully navigated to direct inbox")
                        return True
                except:
                    continue
            
            logging.warning("Could not confirm inbox navigation, but continuing")
            return True
            
        except Exception as e:
            logging.error(f"Error navigating to inbox: {e}")
            return False

    def get_conversations_from_inbox(self):
        try:
            if not self.navigate_to_direct_inbox():
                return []
            
            time.sleep(3)
            
            conversations = []
            
            conversation_selectors = [
                'div[role="grid"] > div',  
                '[role="listitem"]',
                'div[data-testid*="conversation"]',
                'a[href*="/direct/t/"]'  
            ]
            
            for selector in conversation_selectors:
                try:
                    conv_elements = self.page.query_selector_all(selector)
                    if conv_elements:
                        logging.info(f"Found {len(conv_elements)} conversation elements using: {selector}")
                        
                        for element in conv_elements:
                            try:
                                href = element.get_attribute('href')
                                if href and '/direct/t/' in href:
                                    conv_id = href.split('/direct/t/')[-1].rstrip('/')
                                    conv_text = element.text_content() or ""
                                    
                                    conversations.append({
                                        'id': conv_id,
                                        'text': conv_text,
                                        'element': element
                                    })
                                else:
                                    conv_text = element.text_content() or ""
                                    if len(conv_text.strip()) > 0:
                                        links = element.query_selector_all('a[href*="/direct/t/"]')
                                        if links:
                                            href = links[0].get_attribute('href')
                                            if href:
                                                conv_id = href.split('/direct/t/')[-1].rstrip('/')
                                                conversations.append({
                                                    'id': conv_id,
                                                    'text': conv_text,
                                                    'element': element
                                                })
                            except Exception as conv_error:
                                logging.debug(f"Error parsing conversation element: {conv_error}")
                                continue
                        
                        if conversations:
                            break
                            
                except Exception as e:
                    logging.debug(f"Conversation selector {selector} failed: {e}")
                    continue
            
            # Remove duplicates
            unique_conversations = {}
            for conv in conversations:
                if conv['id'] not in unique_conversations:
                    unique_conversations[conv['id']] = conv
            
            result = list(unique_conversations.values())
            logging.info(f"Found {len(result)} unique conversations")
            
            return result
            
        except Exception as e:
            logging.error(f"Error getting conversations from inbox: {e}")
            return []

    def click_on_conversation(self, conversation_id):
        try:
            conversations = self.get_conversations_from_inbox()
            
            target_conversation = None
            for conv in conversations:
                if conv['id'] == conversation_id:
                    target_conversation = conv
                    break
            
            if not target_conversation:
                logging.warning(f"Conversation {conversation_id} not found in inbox")
                return False
            
            target_conversation['element'].click()
            time.sleep(3)
            
            message_indicators = [
                'div[contenteditable="true"]',
                'textarea[placeholder*="Message"]',
                '[aria-label*="Message"]'
            ]
            
            for indicator in message_indicators:
                try:
                    element = self.page.wait_for_selector(indicator, timeout=5000)
                    if element and element.is_visible():
                        logging.info(f"Successfully opened conversation {conversation_id}")
                        self.current_conversation_id = conversation_id
                        return True
                except:
                    continue
            
            logging.warning(f"Clicked on conversation {conversation_id} but couldn't find message input")
            return True 
            
        except Exception as e:
            logging.error(f"Error clicking on conversation {conversation_id}: {e}")
            return False

    def navigate_to_direct_chat(self, conversation_id):
        try:
            chat_url = f"https://www.instagram.com/direct/t/{conversation_id}/"
            logging.info(f"Navigating directly to chat: {chat_url}")
            
            self.page.goto(chat_url, wait_until='domcontentloaded', timeout=30000)
            time.sleep(5)
            
            # Check if we're in the chat
            chat_indicators = [
                'div[contenteditable="true"]',
                'textarea[placeholder*="Message"]',
                '[aria-label*="Message"]',
                'div[role="textbox"]'
            ]
            
            for indicator in chat_indicators:
                try:
                    element = self.page.wait_for_selector(indicator, timeout=5000)
                    if element and element.is_visible():
                        logging.info("Successfully navigated to direct chat")
                        self.current_conversation_id = conversation_id
                        return True
                except:
                    continue
            
            logging.warning("Could not confirm chat navigation, but continuing")
            return True
            
        except Exception as e:
            logging.error(f"Error navigating to chat: {e}")
            return False

    def get_message_timestamp_from_element(self, element):
        try:
            parent = element
            for _ in range(3):
                try:
                    parent = parent.locator('..')
                    time_element = parent.query_selector('time')
                    if time_element:
                        datetime_attr = time_element.get_attribute('datetime')
                        if datetime_attr:
                            # Parse ISO timestamp
                            from datetime import datetime
                            dt = datetime.fromisoformat(datetime_attr.replace('Z', '+00:00'))
                            return dt.timestamp()
                except:
                    continue
            
            current_time = time.time()
            logging.debug(f"No timestamp found for message, using current time: {current_time}")
            return current_time
            
        except Exception as e:
            logging.debug(f"Error getting message timestamp: {e}")
            return time.time()

    def is_own_message_improved(self, element, text):
        try:
            msg_id = self.generate_message_id(text, self.current_conversation_id)
            if msg_id in self.bot_messages:
                return True
            
            bot_patterns = [
                "hey! nice to hear", "hey! whats up", "hey! got your message",
                "thanks for the message", "will respond soon", "will get back to you",
                "i'm back online", "automatically now", "respond to your messages"
            ]
            
            text_lower = text.lower()
            if any(pattern in text_lower for pattern in bot_patterns):
                return True
            
            return self.is_outgoing_message(element)
            
        except Exception as e:
            logging.debug(f"Error in improved own message detection: {e}")
            return False

    def get_messages_from_current_conversation(self):
        """Get messages from the currently open conversation with better detection"""
        try:
            time.sleep(2)
            
            message_selectors = [
                'div[role="log"] > div',
                '[data-testid*="message-container"]',
                'div[dir="auto"]:not([role="button"])'  
            ]
            
            all_messages = []
            current_timestamp = time.time()
            monitoring_start = self.monitoring_start_time.get(self.current_conversation_id, current_timestamp)
            
            for selector in message_selectors:
                try:
                    msg_elements = self.page.query_selector_all(selector)
                    if msg_elements:
                        logging.info(f"Found {len(msg_elements)} message elements using: {selector}")
                        
                        for i, element in enumerate(msg_elements):
                            try:
                                text = element.text_content()
                                if not text or len(text.strip()) < 2:
                                    continue
                                
                                clean_text = text.strip()
                                
                                skip_indicators = [
                                    'now', 'active', 'seen', 'delivered', 'typing', 'online', 
                                    'yesterday', 'min ago', 'hour ago', 'today', 'sent', 'received',
                                    'message', 'photo', 'video', 'call', 'missed call'
                                ]
                                if any(skip in clean_text.lower() for skip in skip_indicators):
                                    continue
                                
                                # Get message timestamp
                                msg_timestamp = self.get_message_timestamp_from_element(element)
                                
                                if msg_timestamp > current_timestamp + 3600:  # More than 1 hour in future
                                    logging.debug(f"Invalid timestamp {msg_timestamp}, using monitoring start time")
                                    msg_timestamp = monitoring_start - 1  # Make it older than monitoring start
                                
                                # Skip messages older than monitoring start time with better validation
                                time_diff = msg_timestamp - monitoring_start
                                if time_diff < 0:
                                    logging.debug(f"Skipping old message: {clean_text[:30]}... (time_diff: {time_diff:.2f}s)")
                                    continue
                                
                                # Check if this is our message using improved detection
                                is_outgoing = self.is_own_message_improved(element, clean_text)
                                
                                # Generate consistent message ID
                                message_id = self.generate_message_id(clean_text, self.current_conversation_id, i)
                                
                                message_data = {
                                    'text': clean_text,
                                    'timestamp': msg_timestamp,
                                    'is_outgoing': is_outgoing,
                                    'element': element,
                                    'id': message_id
                                }
                                
                                all_messages.append(message_data)
                                
                            except Exception as e:
                                logging.debug(f"Error parsing message: {e}")
                                continue
                        
                        if all_messages:
                            break
                            
                except Exception as e:
                    logging.debug(f"Message selector {selector} failed: {e}")
                    continue
            
            # Filter for new incoming messages only
            new_incoming = []
            last_responded = self.last_responded_message.get(self.current_conversation_id, "")
            
            for msg in all_messages:
                # Skip our own messages
                if msg['is_outgoing']:
                    self.bot_messages.add(msg['id'])
                    logging.debug(f"Marking as bot message: {msg['text'][:30]}")
                    continue
                    
                # Skip already processed messages
                if msg['id'] in self.processed_messages:
                    logging.debug(f"Skipping already processed: {msg['text'][:30]}")
                    continue
                    
                # Skip our bot messages
                if msg['id'] in self.bot_messages:
                    logging.debug(f"Skipping bot message: {msg['text'][:30]}")
                    continue
                    
                # Additional timestamp check - only messages after monitoring started
                if msg['timestamp'] < monitoring_start:
                    logging.debug(f"Skipping old message by timestamp: {msg['text'][:30]} (msg: {msg['timestamp']}, start: {monitoring_start})")
                    continue
                
                # Skip if this is the same message we last responded to
                if msg['text'] == last_responded:
                    logging.debug(f"Skipping last responded message: {msg['text'][:30]}")
                    continue
                
                new_incoming.append(msg)
            
            # Take only the most recent incoming messages (last 1 to be safe)
            recent_incoming = new_incoming[-1:] if new_incoming else []
            
            if recent_incoming:
                logging.info(f"Found {len(recent_incoming)} new incoming messages")
                for msg in recent_incoming:
                    logging.info(f"  - New incoming: {msg['text'][:50]}... (timestamp: {msg['timestamp']}, monitoring: {monitoring_start})")
            else:
                logging.info("No new incoming messages found")
            
            # Update conversation state
            if all_messages:
                self.conversation_states[self.current_conversation_id] = current_timestamp
                self.save_message_tracking()
            
            return recent_incoming
            
        except Exception as e:
            logging.error(f"Error getting messages from current conversation: {e}")
            return []

    def is_outgoing_message(self, element):
        """Determine if a message was sent by us (outgoing) or received (incoming)"""
        try:
            # Check parent containers for alignment or styling clues
            parent = element
            for _ in range(5):  # Check up to 5 parent levels
                try:
                    parent = parent.locator('..')
                    parent_class = parent.get_attribute('class') or ""
                    parent_style = parent.get_attribute('style') or ""
                    
                    # Look for indicators of outgoing messages
                    outgoing_indicators = [
                        'right', 'end', 'sent', 'outgoing', 'blue', 'primary'
                    ]
                    
                    if any(indicator in parent_class.lower() or indicator in parent_style.lower() 
                           for indicator in outgoing_indicators):
                        return True
                    
                    # Look for indicators of incoming messages
                    incoming_indicators = [
                        'left', 'start', 'received', 'incoming', 'gray', 'secondary'
                    ]
                    
                    if any(indicator in parent_class.lower() or indicator in parent_style.lower() 
                           for indicator in incoming_indicators):
                        return False
                        
                except:
                    break
            
            # Fallback: check text position on screen
            try:
                box = element.bounding_box()
                if box:
                    # If message is positioned more to the right, likely outgoing
                    viewport_width = self.page.viewport_size['width']
                    if box['x'] > viewport_width * 0.6:
                        return True
                    elif box['x'] < viewport_width * 0.4:
                        return False
            except:
                pass
            
            # Default to incoming if unsure
            return False
            
        except Exception as e:
            logging.debug(f"Error determining message direction: {e}")
            return False

    def send_message_in_current_conversation(self, message):
        try:
            # Find message input
            input_selectors = [
                'div[contenteditable="true"]',
                'textarea[placeholder*="Message"]',
                'div[role="textbox"]',
                '[aria-label*="Message"]'
            ]
            
            message_input = None
            for selector in input_selectors:
                try:
                    elements = self.page.query_selector_all(selector)
                    for element in elements:
                        if element.is_visible():
                            message_input = element
                            logging.info(f"Found message input using: {selector}")
                            break
                    if message_input:
                        break
                except Exception as e:
                    logging.debug(f"Input selector {selector} failed: {e}")
                    continue
            
            if not message_input:
                logging.error("Could not find message input")
                return False
            
            # Type and send message
            message_input.click()
            time.sleep(0.5)
            message_input.fill('')
            message_input.type(message, delay=random.randint(50, 100))
            time.sleep(1)
            
            # Try to send
            send_success = False
            
            # Method 1: Press Enter
            try:
                message_input.press('Enter')
                time.sleep(1)
                send_success = True
                logging.info(f"Message sent: {message}")
                
                # Track our sent message
                sent_msg_id = self.generate_message_id(message, self.current_conversation_id)
                self.bot_messages.add(sent_msg_id)
                self.save_message_tracking()
                
            except Exception as e1:
                logging.debug(f"Enter method failed: {e1}")
                
                # Method 2: Look for send button
                try:
                    send_btn = self.page.query_selector('[aria-label="Send"]')
                    if send_btn:
                        send_btn.click()
                        send_success = True
                        logging.info(f"Message sent via button: {message}")
                        
                        # Track our sent message
                        sent_msg_id = self.generate_message_id(message, self.current_conversation_id)
                        self.bot_messages.add(sent_msg_id)
                        self.save_message_tracking()
                        
                except Exception as e2:
                    logging.debug(f"Send button method failed: {e2}")
            
            return send_success
            
        except Exception as e:
            logging.error(f"Error sending message: {e}")
            return False

    def send_initial_response(self, conversation_id):
        try:
            if conversation_id in self.sent_initial_response:
                logging.info(f"Initial response already sent to {conversation_id}, skipping")
                return True
            
            initial_message = "Hey! I'm back online and will respond to your messages automatically now 👋"
            
            if self.send_message_in_current_conversation(initial_message):
                self.sent_initial_response.add(conversation_id)
                logging.info(f"✅ Initial response sent to {conversation_id}")
                return True
            else:
                logging.error(f"❌ Failed to send initial response to {conversation_id}")
                return False
                
        except Exception as e:
            logging.error(f"Error sending initial response: {e}")
            return False

    def get_ai_response(self, user_message, username):
        try:
            system_message = f"""
            You are Nithin responding to Instagram DMs. Be casual, friendly, and authentic like a real person.
            
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
            
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.openrouter_api_key}",
                    "HTTP-Referer": "https://github.com/nithin434/woat",
                    "X-Title": "Instagram Bot",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek/deepseek-r1:free",
                    "messages": [
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": user_content}
                    ],
                    "max_tokens": 100,
                    "temperature": 0.8,
                    "top_p": 0.9
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'choices' in data and len(data['choices']) > 0:
                    ai_response = data['choices'][0]['message']['content'].strip()
                    clean_response = ''.join(char if ord(char) < 128 else '' for char in ai_response)
                    return clean_response[:200]
            
            logging.error(f"AI API failed: {response.status_code}")
            return "Hey! Got your message, will get back to you soon."
            
        except Exception as e:
            logging.error(f"Error getting AI response: {e}")
            return "Hey! Thanks for the message, will respond soon."

    def start_monitoring_conversation(self, conversation_id):
        self.monitoring_start_time[conversation_id] = time.time() + 10
        logging.info(f"Started monitoring conversation {conversation_id} at {time.time() + 10} (with 10s buffer)")

    def monitor_and_respond(self):
        while self.is_running:
            try:
                for conversation_id in self.monitored_users:
                    try:
                        logging.info(f"Checking conversation: {conversation_id}")
                        
                        # Only navigate if we haven't navigated to this conversation yet or it's been a while
                        if (self.current_conversation_id != conversation_id or 
                            not hasattr(self, '_last_nav_time') or 
                            time.time() - getattr(self, '_last_nav_time', 0) > 300):  # 5 minutes
                            
                            # Navigate directly to the specific chat
                            if self.navigate_to_direct_chat(conversation_id):
                                self._last_nav_time = time.time()
                            else:
                                continue
                        
                        # Mark monitoring start time for this conversation if not already set
                        if conversation_id not in self.monitoring_start_time:
                            self.start_monitoring_conversation(conversation_id)
                        
                        # Send initial response ONLY if first time monitoring this conversation
                        if conversation_id not in self.sent_initial_response:
                            time.sleep(2)
                            if self.send_initial_response(conversation_id):
                                time.sleep(3)
                                # Update monitoring start time after initial response to avoid replying to old messages
                                self.start_monitoring_conversation(conversation_id)
                        
                        # Get new incoming messages
                        messages = self.get_messages_from_current_conversation()
                        
                        for msg in messages:
                            msg_id = msg['id']
                            msg_text = msg['text']
                            msg_timestamp = msg['timestamp']
                            monitoring_start = self.monitoring_start_time.get(conversation_id, time.time())
                            
                            # Triple-check timestamp with stricter validation
                            time_diff = msg_timestamp - monitoring_start
                            if time_diff < 0:
                                logging.debug(f"Final timestamp check: Skipping old message: {msg_text[:30]} (diff: {time_diff:.2f}s)")
                                continue
                            
                            # Skip if already processed
                            if msg_id in self.processed_messages:
                                logging.debug(f"Skipping already processed message: {msg_id}")
                                continue
                            
                            # Skip our own messages
                            if msg['is_outgoing'] or msg_id in self.bot_messages:
                                self.processed_messages.add(msg_id)
                                logging.debug(f"Skipping own message: {msg_text[:30]}")
                                continue
                            
                            # Final check for bot message patterns
                            if self.is_own_message_improved(msg['element'], msg_text):
                                self.bot_messages.add(msg_id)
                                self.processed_messages.add(msg_id)
                                logging.debug(f"Detected as bot message: {msg_text[:30]}")
                                continue
                            
                            # Check if this is the same message we last responded to
                            last_responded = self.last_responded_message.get(conversation_id, "")
                            if msg_text == last_responded:
                                logging.debug(f"Skipping - already responded to: {msg_text[:30]}")
                                continue
                            
                            logging.info(f"🆕 NEW INCOMING MESSAGE in {conversation_id}: {msg_text}")
                            logging.info(f"    Message timestamp: {msg_timestamp}, Monitoring since: {monitoring_start}, Diff: {time_diff:.2f}s")
                            
                            # Get AI response
                            ai_response = self.get_ai_response(msg_text, conversation_id)
                            logging.info(f"🤖 AI Response: {ai_response}")
                            
                            # Random delay before responding (simulate human typing)
                            time.sleep(random.randint(3, 7))
                            
                            # Send response
                            if self.send_message_in_current_conversation(ai_response):
                                logging.info(f"✅ Response sent successfully")
                                self.processed_messages.add(msg_id)
                                # Track this message as the last one we responded to
                                self.last_responded_message[conversation_id] = msg_text
                                self.save_message_tracking()
                                time.sleep(random.randint(2, 4))
                            else:
                                logging.error(f"❌ Failed to send response")
                        
                        time.sleep(2)
                        
                    except Exception as conv_error:
                        logging.error(f"Error monitoring conversation {conversation_id}: {conv_error}")
                        continue
                
                time.sleep(5)
                
            except Exception as e:
                logging.error(f"Error in monitoring loop: {e}")
                time.sleep(10)

    def start_bot(self, cookies_file=None, users=None, personality=None):
        if self.is_running:
            return "Bot is already running"
        
        try:
            if cookies_file and not self.load_cookies_from_json(cookies_file):
                return "Failed to load cookies or login to Instagram"
            
            if users:
                self.monitored_users = set(users)
                logging.info(f"Monitoring conversations: {list(self.monitored_users)}")
            
            if personality:
                self.bot_personality = personality
            
            self.is_running = True
            logging.info("🚀 Instagram bot started - monitoring conversations")
            
            # Start monitoring in the main thread
            self.monitor_and_respond()
            
            return "Bot started successfully - monitoring Instagram conversations"
            
        except Exception as e:
            logging.error(f"Error starting bot: {e}")
            return f"Failed to start bot: {e}"

    def stop_bot(self):
        """Stop the bot and clear all session data"""
        self.is_running = False
        
        # Clear all tracking data
        self.processed_messages.clear()
        self.bot_messages.clear()
        self.conversation_states.clear()
        self.sent_initial_response.clear()
        self.last_responded_message.clear()
        self.monitoring_start_time.clear()
        self.monitored_users.clear()
        self.current_conversation_id = None
        
        # Remove message tracking file
        try:
            if os.path.exists(self.message_tracking_file):
                os.remove(self.message_tracking_file)
                logging.info("Message tracking file cleared")
        except Exception as e:
            logging.warning(f"Could not remove message tracking file: {e}")
        
        # Clear session files
        try:
            session_file = os.path.join(self.session_dir, 'session.json')
            if os.path.exists(session_file):
                os.remove(session_file)
                logging.info("Session file cleared")
        except Exception as e:
            logging.warning(f"Could not remove session file: {e}")
        
        try:
            if os.path.exists('temp_cookies.json'):
                os.remove('temp_cookies.json')
                logging.info("Temp cookies file cleared")
        except Exception as e:
            logging.warning(f"Could not remove temp cookies file: {e}")
        
        if self.browser:
            try:
                self.browser.close()
            except:
                pass
        
        if self.playwright:
            try:
                self.playwright.stop()
            except:
                pass
        
        # Reset browser references
        self.browser = None
        self.page = None
        self.context = None
        self.playwright = None
        
        logging.info("🛑 Instagram bot stopped and all session data cleared")
        return "Bot stopped successfully - all session data cleared. Ready for fresh start."

    def get_status(self):
        status_info = {
            'running': self.is_running,
            'monitored_users': list(self.monitored_users),
            'logs': list(log_buffer)  # Include recent logs
        }
        
        if self.is_running:
            status_msg = f"Bot is running, monitoring {len(self.monitored_users)} conversations: {list(self.monitored_users)}"
        else:
            status_msg = "Bot is not running"
        
        return {
            'status': status_msg,
            'details': status_info
        }

    def add_user(self, user_id):
        if user_id:
            self.monitored_users.add(user_id)
            return f"Added {user_id} to monitoring list"
        return "Invalid user ID"

    def remove_user(self, user_id):
        """Remove user from monitoring list"""
        if user_id in self.monitored_users:
            self.monitored_users.remove(user_id)
            return f"Removed {user_id} from monitoring list"
        return "User not in monitoring list"

bot = InstagramBot()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True

class BotHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            if self.path == '/':
                # Serve the HTML interface
                try:
                    with open('insta_interface.html', 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.send_header('Content-Length', str(len(content.encode())))
                    self.end_headers()
                    self.wfile.write(content.encode())
                except FileNotFoundError:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b'HTML interface not found')
            
            elif self.path == '/bot-status':
                status_data = bot.get_status()
                
                # Return both status and logs as JSON
                response_data = json.dumps(status_data)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Content-Length', str(len(response_data.encode())))
                self.end_headers()
                self.wfile.write(response_data.encode())
            
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            logging.error(f"Error in do_GET: {e}")
            try:
                self.send_response(500)
                self.end_headers()
            except:
                pass
    
    def do_POST(self):
        try:
            if self.path == '/bot-control':
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                
                try:
                    if 'multipart/form-data' in self.headers.get('Content-Type', ''):
                        # Handle file upload - FIXED VERSION
                        boundary = self.headers['Content-Type'].split('boundary=')[1]
                        parts = post_data.split(f'--{boundary}'.encode())
                        
                        form_data = {}
                        cookies_file_path = None
                        
                        for part in parts:
                            if b'Content-Disposition' in part:
                                if b'name="action"' in part:
                                    try:
                                        form_data['action'] = part.split(b'\r\n\r\n')[1].split(b'\r\n--')[0].decode('utf-8').strip()
                                    except:
                                        form_data['action'] = part.split(b'\r\n\r\n')[1].split(b'\r\n')[0].decode('utf-8').strip()
                                
                                elif b'name="personality"' in part:
                                    try:
                                        form_data['personality'] = part.split(b'\r\n\r\n')[1].split(b'\r\n--')[0].decode('utf-8').strip()
                                    except:
                                        form_data['personality'] = part.split(b'\r\n\r\n')[1].split(b'\r\n')[0].decode('utf-8').strip()
                                
                                elif b'name="users"' in part:
                                    try:
                                        users_json = part.split(b'\r\n\r\n')[1].split(b'\r\n--')[0].decode('utf-8').strip()
                                        form_data['users'] = json.loads(users_json) if users_json else []
                                    except:
                                        form_data['users'] = []
                                
                                elif b'name="cookies"' in part and b'filename=' in part:
                                    # Extract and save uploaded cookies file
                                    try:
                                        # Find the actual JSON content
                                        content_start = part.find(b'\r\n\r\n') + 4
                                        content_end = part.rfind(b'\r\n--')
                                        if content_end == -1:
                                            content_end = len(part)
                                        
                                        file_content = part[content_start:content_end]
                                        
                                        # Try to parse as JSON to validate
                                        try:
                                            cookies_data = json.loads(file_content.decode('utf-8'))
                                            logging.info(f"Successfully parsed cookies file with {len(cookies_data)} cookies")
                                        except json.JSONDecodeError as je:
                                            logging.error(f"Invalid JSON in cookies file: {je}")
                                            raise ValueError("Invalid cookies JSON file")
                                        
                                        # Save to temporary file
                                        cookies_file_path = 'temp_cookies.json'
                                        with open(cookies_file_path, 'w', encoding='utf-8') as f:
                                            json.dump(cookies_data, f, indent=2)
                                        
                                        #logging.info(f"Cookies file saved to {cookies_file_path}")
                                        
                                    except Exception as e:
                                        logging.error(f"Error processing cookies file: {e}")
                                        raise ValueError(f"Failed to process cookies file: {e}")
                        
                        # Process the start action
                        if form_data.get('action') == 'start':
                            if not cookies_file_path:
                                result = "Error: No cookies file provided"
                            else:
                                result = bot.start_bot(
                                    cookies_file=cookies_file_path,
                                    users=form_data.get('users', []),
                                    personality=form_data.get('personality')
                                )
                        else:
                            result = "Unknown action"
                    
                    else:
                        # Handle JSON data
                        data = json.loads(post_data.decode())
                        action = data.get('action')
                        
                        if action == 'stop':
                            result = bot.stop_bot()
                        elif action == 'add_user':
                            result = bot.add_user(data.get('user'))
                        elif action == 'remove_user':
                            result = bot.remove_user(data.get('user'))
                        else:
                            result = "Unknown action"
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'text/plain')
                    self.send_header('Content-Length', str(len(result.encode())))
                    self.end_headers()
                    self.wfile.write(result.encode())
                    
                except Exception as e:
                    error_msg = f"Error: {str(e)}"
                    logging.error(f"Error in do_POST: {e}")
                    self.send_response(500)
                    self.send_header('Content-type', 'text/plain')
                    self.send_header('Content-Length', str(len(error_msg.encode())))
                    self.end_headers()
                    self.wfile.write(error_msg.encode())
            
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            logging.error(f"Error in do_POST: {e}")
            try:
                self.send_response(500)
                self.end_headers()
            except:
                pass

def main():
    port = 8081
    server = ThreadedHTTPServer(('localhost', port), BotHandler)
    print(f"Instagram Bot Server running on http://localhost:{port}")
    print("Upload your cookies.json file and configure the bot via the web interface")
    print("The bot will run in headless mode for better stability")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        bot.stop_bot()
        server.shutdown()

if __name__ == "__main__":
    main()
