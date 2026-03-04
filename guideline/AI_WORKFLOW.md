# AI Work Workflow (System)

> **Core Philosophy**: "Do not code blindly; think and plan first."

## Step 1: Think (Think First, Code Later)
Before starting work, define the following and agree with the user:
1.  **Understand User Intent**: What exactly does the user want? (Do not mistake A for B).
2.  **Establish Plan**: Which files will be modified, and what logic will be added?
3.  **Impact Analysis**: How will this change affect existing code or other modules?

**[Command Example]**
> "Before implementing this feature, plan how to proceed in `Think` mode."

## Step 2: Implementation
- Write code according to the planned design.
- If the code becomes too long or complex, stop and suggest refactoring.
- Follow the coding rules in `GEMINI.md`.

## Step 3: Review (Expert Review)
- After completing the code, do not finish immediately; review the code from the perspective of an **Expert Review Agent**.
- Perform a self-check referring to `REVIEW_CHECKLIST.md`.

## Step 4: Documentation
- Once the work is done, update `GEMINI.md` to reflect changes.
- Add new features or notes to the guidelines if necessary.

---
> "It's not that non-developers don't write a single line of code that's good; that's the problem. Maintenance becomes impossible. That's why a system is needed."