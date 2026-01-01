# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import List, Optional
import subprocess
import json
import os
from datetime import datetime

app = FastAPI(title="Web Scraper API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    query: str
    max_results: Optional[int] = 10

class ScrapeRequest(BaseModel):
    urls: List[HttpUrl]

class ScraperResponse(BaseModel):
    status: str
    data: dict
    timestamp: str

def run_node_scraper(command: List[str]) -> dict:
    """Run Node.js scraper script and return parsed JSON"""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        
        # Read the output JSON file
        with open('scraped_data.json', 'r') as f:
            return json.load(f)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Scraper error: {e.stderr}")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="scraped_data.json not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid JSON output")

@app.get("/")
async def root():
    return {
        "message": "Web Scraper API",
        "endpoints": {
            "/search": "POST - Search Google and scrape results",
            "/scrape": "POST - Scrape specific URLs",
            "/linkedin": "POST - Scrape LinkedIn profiles",
            "/health": "GET - Health check"
        }
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.post("/search", response_model=ScraperResponse)
async def search_and_scrape(request: SearchRequest):
    """Search Google for a query and scrape top results"""
    try:
        data = run_node_scraper(['node', 'scraper.js', request.query])
        
        return ScraperResponse(
            status="success",
            data=data,
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/scrape")
async def scrape_urls(request: ScrapeRequest):
    """Scrape specific URLs"""
    try:
        # Create a temporary script that scrapes specific URLs
        scrape_script = f"""
const WebScraper = require('./scraper.js');

async function scrapeUrls() {{
    const scraper = new WebScraper();
    await scraper.init();
    
    const urls = {json.dumps([str(url) for url in request.urls])};
    const results = await scraper.scrapeMultiplePages(urls);
    
    const output = {{
        urls: urls,
        timestamp: new Date().toISOString(),
        results: results
    }};
    
    await scraper.saveToJson(output, 'scraped_data.json');
    await scraper.close();
}}

scrapeUrls().catch(console.error);
"""
        
        # Write temporary script
        with open('temp_scrape.js', 'w') as f:
            f.write(scrape_script)
        
        # Run it
        data = run_node_scraper(['node', 'temp_scrape.js'])
        
        # Cleanup
        if os.path.exists('temp_scrape.js'):
            os.remove('temp_scrape.js')
        
        return {
            "status": "success",
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/linkedin")
async def scrape_linkedin(request: ScrapeRequest):
    """Scrape LinkedIn profiles"""
    try:
        # Validate LinkedIn URLs
        linkedin_urls = [str(url) for url in request.urls if 'linkedin.com' in str(url)]
        
        if not linkedin_urls:
            raise HTTPException(status_code=400, detail="No LinkedIn URLs provided")
        
        scrape_script = f"""
const WebScraper = require('./scraper.js');

async function scrapeLinkedIn() {{
    const scraper = new WebScraper();
    await scraper.init();
    
    const urls = {json.dumps(linkedin_urls)};
    const results = [];
    
    for (const url of urls) {{
        try {{
            const data = await scraper.scrapeLinkedIn(url);
            results.push({{ success: true, data }});
        }} catch (err) {{
            results.push({{ success: false, url, error: err.message }});
        }}
    }}
    
    const output = {{
        platform: 'linkedin',
        timestamp: new Date().toISOString(),
        profiles: results
    }};
    
    await scraper.saveToJson(output, 'scraped_data.json');
    await scraper.close();
}}

scrapeLinkedIn().catch(console.error);
"""
        
        with open('temp_linkedin.js', 'w') as f:
            f.write(scrape_script)
        
        data = run_node_scraper(['node', 'temp_linkedin.js'])
        
        if os.path.exists('temp_linkedin.js'):
            os.remove('temp_linkedin.js')
        
        return {
            "status": "success",
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/results")
async def get_latest_results():
    """Get the latest scraped results"""
    try:
        with open('scraped_data.json', 'r') as f:
            data = json.load(f)
        return {
            "status": "success",
            "data": data
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No results found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)