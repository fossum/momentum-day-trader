## 2024-05-18 - Path Traversal in File Logging
**Vulnerability:** A critical Path Traversal vulnerability was found in `logUserDecision` (server.ts) where an unvalidated user input string (`userId`) was directly concatenated into a log file path using `path.join`.
**Learning:** Directly using identifiers extracted from requests (headers, query params) in local filesystem operations without validation allows attackers to write files outside intended directories (e.g., `../../../hacked`).
**Prevention:** Always validate and sanitize identifiers used in file paths using strict allowlists or regexes (e.g., `/^[a-zA-Z0-9_-]+$/`).
