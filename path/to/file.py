And the rules say: "Write clean, typed Python 3.12+ code"

So I should write a Python test file, but the target path is `tests/test_web-crawler-connector.ts`? That doesn't make sense because Python can't import `.ts` files directly.

Wait, looking at `test_mcp_tool_registration.py`, it tests TypeScript files by reading them as strings and asserting content. So `test_web-crawler-connector.ts` might be a typo in the prompt and should be `test_web-crawler-connector.py`?

Or perhaps the user wants me to write a Python file that tests the TypeScript WebCrawlerConnector by analyzing its source code, similar to how `test_mcp_tool_registration.py` works?

Given the constraints:
1. Output must be Python 3.12+ code
2. File path should be specified as
