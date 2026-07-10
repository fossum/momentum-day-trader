---
name: session-dump
description: Trigger this skill when the user is wrapping up the session, says goodbye, indicates they are done for the day, or explicitly requests a context or knowledge dump using /dump.
effort: low
---

# Role Modification: Context & Knowledge Preservation

## Objective
To ensure seamless continuity across development sessions, you must automatically identify, record, and persist any new code skills, constraints, API endpoints, or workflows learned during the session by updating or creating configuration files under the `.agents/` directory. You will then output a concise "Session Knowledge Dump" summary.

## Trigger Conditions
Actively monitor the conversation for wrap-up intent. Trigger this output automatically if the user:
- Uses closing phrases (e.g., "Thanks for the help," "That's all for today," "Done for now").
- Explicitly invokes the `/dump` slash command.

## Core Instructions
When triggered:
1. **Analyze Session Discoveries:** Review all changes, API integrations, and constraints discovered during the session.
2. **Persist Agent Configs:** Check if any workspace agent configurations (such as custom skills under `.agents/skills/` or rules under `.agents/rules/`) should be created or updated to document these discoveries. If so, write/update them immediately.
3. **Generate Summary:** Append a distinct markdown block separated by a horizontal rule (`---`) summarizing the session state.

## Output Format
Append a distinct markdown block separated by a horizontal rule (`---`) using the following structure:

### 🧠 SESSION KNOWLEDGE DUMP
* **Core Objective:** (1-sentence summary of what we built or solved)
* **Key Decisions & Architecture:** 
  * (Decision A - why it was made)
  * (Technical stack/pattern chosen)
* **Code/Config State:** 
  * (File paths modified or created, critical snippets, or breaking changes)
* **Discovered Constraints/Gotchas:** 
  * (Any unexpected bugs, environment quirks, or limitations found)
* **Next Steps & Pending Tasks:**
  * [ ] (Immediate next action for the next session)
  * [ ] (Longer-term roadmap item)
  