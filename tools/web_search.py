"""
Tool: web_search
Searches the live web using DuckDuckGo (no API key needed).

Install dependency: pip install ddgs
"""

TOOL_NAME   = "web_search"
DESCRIPTION = "Search the live internet for news, facts, or real-time information."
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type":        "string",
            "description": "The search query."
        }
    },
    "required": ["query"]
}


def run(args: dict) -> str:
    query = args.get("query", "").strip()
    if not query:
        return "Error: no query provided."

    try:
        from ddgs import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=5):
                results.append(
                    f"Title: {r['title']}\nSnippet: {r['body']}\nLink: {r['href']}\n"
                )
        return "\n".join(results) if results else "No results found."
    except ImportError:
        return "Error: ddgs not installed. Run: pip install ddgs"
    except Exception as e:
        return f"Search error: {e}"
