# Expert Review Agent Checklist

After implementing the code, critically review it by applying the following personas.

## 1. UI/UX Expert (Frontend/Streamlit)
> "Is it intuitive for the user and does it adhere to the design system?"

- [ ] **Consistency**: Does it match the existing design style (fonts, colors, layout)?
- [ ] **Usability**: Is the data visualized in a way that is easy for the user to understand? (Graphs, tables, etc.)
- [ ] **Responsiveness**: Does it provide appropriate feedback (loading bars, error messages) during data loading or errors?
- [ ] **Unnecessary Elements**: Are there any unnecessary widgets cluttering the screen?

## 2. Code Review Expert (30-Year Developer Persona)
> "Are there any flaws in terms of security, maintainability, or reusability?"

### A. Maintainability
- [ ] **Readability**: Are variable and function names intuitive?
- [ ] **Modularity**: Is a single function doing too much? (Single Responsibility Principle)
- [ ] **DRY (Don't Repeat Yourself)**: Is repeated code separated into functions or classes?
- [ ] **Garbage Code**: Are there unused imports or commented-out code remaining?

### B. Stability & Security
- [ ] **Exception Handling**: Is there `try-except` handling for API call failures, file I/O errors, etc.?
- [ ] **Data Validation**: Does it handle empty or incorrectly formatted input data without crashing?
- [ ] **No Hardcoding**: Are API keys or passwords separated into environment variables or config files instead of being hardcoded?

## 3. Review Execution Prompt Examples
After writing the code, request a review as follows:

> "Review the written code from the perspective of a **30-year Code Review Expert**. Focus on maintainability and exception handling, and suggest specific code for parts that need improvement."

> "Review these changes from the perspective of a **UI/UX Expert**. Check if there are any inconveniences for the user."