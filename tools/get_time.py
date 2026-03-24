"""
Tool: get_time
Returns the current date and time.
No dependencies beyond the standard library.
"""

import datetime

TOOL_NAME    = "get_time"
DESCRIPTION  = "Get the current date and time."
INPUT_SCHEMA = {
    "type":       "object",
    "properties": {}
}


def run(args: dict) -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
