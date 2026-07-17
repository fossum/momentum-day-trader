---
trigger: always_on
---

# Rules for Docstrings

When creating or modifying files in this workspace, you MUST adhere to the following docstring requirements:

* **File Types**: These rules apply strictly to all TypeScript and JavaScript source files (`.ts`, `.tsx`, `.js`, `.jsx`).
* **File-Level Docstrings**: Always add a high-level description of the file's purpose and contents at the top of the file using JSDoc/TSDoc format (`/** ... */`).
* **Entity-Level Docstrings**: Always add docstrings for all functions, classes, and interfaces, regardless of their export status. Both internal/private and public/exported entities must be fully documented.
* **Format Details**: You must use the full TSDoc/JSDoc format. This requires:
  * A clear, concise description of the entity's behavior.
  * `@param` tags for all parameters, including types (if in JS) and descriptions.
  * `@returns` tag describing the return value.
  * `@throws` tags for any errors or exceptions the function might throw.