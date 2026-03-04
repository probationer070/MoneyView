# GEMINI.md - Project Context and Rules

> **Purpose**: This file serves as a landmark for the AI to understand the project's overall structure, rules, and current status, ensuring "context is maintained." Update this file after every task to keep it current.

## 1. Project Overview
- **Project Name**: MoneyView
- **Description**: Economic indicator collection, analysis, and visualization dashboard project.
- **Tech Stack**: Python, Streamlit, Plotly, Pandas

## 2. Folder Structure and Roles
- `guideline/`: Stores AI coding rules, workflows, and review checklists.
- `WebScrap/`: Data collection scripts (ECOS, Yahoo Finance, etc.).
- `views/`: Streamlit frontend screen configuration.
- `Single_Videos/`: Reference video summaries and text data.

## 3. Behavioral Guidelines (AI Compliance)
> **Tradeoff**: These guidelines bias toward caution over speed.

### 1. Think Before Coding
- **Don't assume**: State assumptions explicitly. If uncertain, ask.
- **Surface tradeoffs**: If multiple interpretations exist, present them.
- **Stop if unclear**: If something is confusing, stop and ask.

### 2. Simplicity First
- **Minimum code**: No features beyond what was asked.
- **No over-engineering**: No abstractions for single-use code.
- **Refactor**: If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
- **Touch only what you must**: Don't "improve" adjacent code unless necessary.
- **Clean up your own mess**: Remove imports/variables/functions that YOUR changes made unused.
- **Legacy code**: Don't remove pre-existing dead code unless asked (mention it instead).

### 4. Goal-Driven Execution
- **Define success**: Transform tasks into verifiable goals (e.g., "Write tests for invalid inputs").
- **Plan**: For multi-step tasks, state a brief plan with verification steps.

## 4. Current Work Status (Context)
- [ ] Initial project structure setup and guideline establishment.
- [ ] Modularization and stabilization of data collector (WebScrap).
- [ ] Dashboard UI (views) improvement.

## 5. User Preferences
- Prefers non-developer-friendly explanations and code structures.
- Aims for stable and easy-to-understand implementations rather than complex ones.