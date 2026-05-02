"""
Web tools — search, fetch pages, and global news briefings.
"""

import httpx
import xml.etree.ElementTree as ET
import asyncio
import re

SEED_FEEDS = {
    'https://feeds.bbci.co.uk/news/world/rss.xml': 'BBC',
    'https://www.cnbc.com/id/100727362/device/rss/rss.html': 'CNBC',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml': 'NYT',
    'https://www.aljazeera.com/xml/rss/all.xml': 'ALJAZEERA',
}

async def fetch_and_parse_feed(client, url, source_name):
    """Fetch a single RSS feed and return a list of article dicts."""
    try:
        response = await client.get(url, headers={'User-Agent': 'Veronica/1.0'}, timeout=5.0)
        if response.status_code != 200:
            return []
        root = ET.fromstring(response.content)
        feed_items = []
        for item in root.findall(".//item")[:5]:
            title = item.findtext("title")
            description = item.findtext("description")
            link = item.findtext("link")
            if description:
                description = re.sub('<[^<]+?>', '', description).strip()
            feed_items.append({
                "source": source_name,
                "title": title,
                "summary": description[:200] + "..." if description else "",
                "link": link
            })
        return feed_items
    except Exception:
        return []

def register(mcp):
    @mcp.tool()
    async def get_world_news() -> str:
        """
        Fetches the latest global headlines from major news outlets simultaneously.
        Use this when the user asks 'What's going on in the world?' or for recent events.
        """
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            tasks = [fetch_and_parse_feed(client, url, name) for url, name in SEED_FEEDS.items()]
            results_of_lists = await asyncio.gather(*tasks)
            all_articles = [item for sublist in results_of_lists for item in sublist]
            if not all_articles:
                return "The global news grid is unresponsive. Unable to pull headlines."
            report = ["### GLOBAL NEWS BRIEFING (LIVE)\n"]
            for entry in all_articles[:12]:
                report.append(f"**[{entry['source']}]** {entry['title']}")
                report.append(f"{entry['summary']}")
                report.append(f"Link: {entry['link']}\n")
            return "\n".join(report)

    @mcp.tool()
    async def fetch_url(url: str) -> str:
        """Fetch the raw text content of a URL."""
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.text[:4000]

    @mcp.tool()
    async def open_world_monitor() -> str:
        """
        Opens the World Monitor dashboard in the system browser.
        Use after delivering a world news brief.
        """
        import webbrowser
        url = "https://worldmonitor.app/"
        try:
            webbrowser.open(url)
            return "Displaying the World Monitor on your primary screen now."
        except Exception as e:
            return f"Unable to initialize the visual monitor: {str(e)}"
