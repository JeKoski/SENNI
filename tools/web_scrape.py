"""
Tool: web_scrape
Fetches and cleans the text content of a webpage.

Install dependency: pip install httpx beautifulsoup4
"""

TOOL_NAME   = "web_scrape"
DESCRIPTION = "Read the full text content of a specific URL (use after web_search to get details)."
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {
            "type":        "string",
            "description": "The full URL to fetch."
        }
    },
    "required": ["url"]
}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}
_MAX_CHARS = 10_000


def run(args: dict) -> str:
    url = args.get("url", "").strip()
    if not url:
        return "Error: no URL provided."

    try:
        import httpx
        from bs4 import BeautifulSoup

        with httpx.Client(headers=_HEADERS, follow_redirects=True, timeout=15) as client:
            response = client.get(url)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        lines = [line.strip() for line in soup.get_text(separator="\n").splitlines() if line.strip()]
        text  = "\n".join(lines)

        return text[:_MAX_CHARS] if len(text) > _MAX_CHARS else text

    except ImportError:
        return "Error: missing dependencies. Run: pip install httpx beautifulsoup4"
    except Exception as e:
        return f"Scrape error: {e}"
