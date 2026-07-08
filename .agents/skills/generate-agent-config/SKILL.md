---
name: generate-agent-config
description: Trigger this skill when creating or editing files inside the .agents/ directory, including workspace rules, workflows, or custom agent skills.
effort: low
---

# Skill: Generate Pristine Antigravity Configurations

## Objective

Instruct the agent on how to correctly structure internal `.agents/` configuration artifacts to prevent structural malformation or execution errors.

## Structural Blueprints

### A. When Writing a Rule (`.agents/rules/*.md`)

See [Rules and Workflows](https://antigravity.google/docs/rules-workflows) for complete documentation.

* **Character Limit:** The file must strictly be under 12,000 characters.
* **Frontmatter:** Every rule requires valid YAML frontmatter specifying title and activation type.
* **Activation Modes:** Must use one of the valid modes: `Always On`, `Manual`, `Model Decision`, or `Glob` (with a specified pattern).

Example Format:

```markdown
---
title: Example Rule Name
activation: Always On
---
# Rules for [Topic]
* Constraint 1
* Constraint 2
```

### B. When Writing a Skill (`.agents/skills/<name>/SKILL.md`)

See [Agent Skills](https://antigravity.google/docs/skills) for complete documentation.

* Frontmatter: Must include `name`, `description` (the semantic trigger phrase), and `effort`.
* Body Elements: The body must contain distinct sections for Objective, Trigger Conditions, Step-by-Step Instructions, and Constraints.

Example Format:

```markdown
---
name: skill-identifier
description: Detailed semantic trigger phrase for when the model should auto-load this context.
effort: low
---
# Skill Title
## Objective
...
```

## Generation Constraints

* Always verify the directory structure before writing. Rules go into `.agents/rules/`, and skills require a dedicated subfolder matching the skill name within `.agents/skills/`.
* Do not invent non-existent configuration fields in the frontmatter.

### Workspace Directory Layout
Ensure your workspace matches this layout exactly so the Antigravity engine indexes both files natively:

```text
your-project-root/
└── .agents/
    ├── rules/
    │   └── file-authoring-standards.md   <-- Always-on tool enforcement
    └── skills/
        └── generate-agent-config/
            └── SKILL.md                  <-- Configuration generation blueprint
```