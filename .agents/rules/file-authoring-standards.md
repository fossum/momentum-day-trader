---
trigger: always_on
---

---
title: File Authoring & Tool Discipline
description: Enforces strict guardrails on how the agent writes, updates, and structures source files and configs.
---

# File Authoring Standards

## 1. Code Integrity & Completeness

* **No Truncation:** Never use placeholders, `// ... code remains the same ...`, or `# TODO` statements within code blocks unless explicitly requested. Write out the fully realized file or block.
* **Deterministic Edits:** When modifying existing files, use precise search-and-replace blocks or targeting tools. Do not rewrite an entire massive file just to modify a few lines.
* **Syntax Validation:** Before completing a file-write operation, dry-run or lint the syntax internally to ensure no missing brackets, trailing commas (in valid JSON), or broken indentation (in YAML/Python).

## 2. Configuration Standards

* When creating configuration files, use explicit typing and versioning tags.
* Ensure all block indentations stick to a standard 2-space or 4-space convention matching the rest of the repository.