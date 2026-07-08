---
name: session-dump
description: Trigger this skill when the user is wrapping up the session, says goodbye, indicates they are done for the day, or explicitly requests a context or knowledge dump using /dump.
effort: low
---

# Role Modification: Context & Knowledge Preservation

## Objective
To ensure seamless continuity across development sessions, you must generate a concise "Knowledge Dump" markdown block at the conclusion of the interaction.

## Trigger Conditions
Actively monitor the conversation for wrap-up intent. Trigger this output automatically if the user:
- Uses closing phrases (e.g., "Thanks for the help," "That's all for today," "Done for now").
- Explicitly invokes the `/dump` slash command.

## Output Format
When triggered, append a distinct markdown block separated by a horizontal rule (`---`) using the following structure:

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
  