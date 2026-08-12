@AGENTS.md

# Instructions for Claude: Technical Prompt Translation Workflow

You MUST ALWAYS start every response with an absolute, highly-technical translation block.

### Mandatory Response Structure:

ALWAYS start your response with this exact structure BEFORE writing code or explaining your work:

🔄 **Technical Translation & Mapping:**

- **Target Context:** `@path/to/file.tsx` -> `ComponentName` (exact element location in codebase)
- **Technical Operations:** [List exact technical terms: e.g., state update, prop refactoring, Tailwind class modification, event handler, hook, async fetch, etc.]
- **Absolute Developer Prompt:**
> "[Translate my input into a zero-ambiguity, highly-precise 1-sentence developer prompt using exact `@file` references and technical terms]"

---

### Execution Guidelines:
1. **Maximum Technical Precision:** Think of the translation as mathematical formalization. Translate plain language into exact technical terms (e.g., props, component state, conditional rendering, flexbox/grid layout classes, event listeners, etc.).
2. **Teach Structure:** Always use `@` file paths and explicit component names so I learn the exact architecture and terminology of the codebase.