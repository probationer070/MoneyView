Python Data Classes – Advanced Usage Patterns

This guide outlines seven advanced techniques for using Python data classes beyond simple data containers. By leveraging the fact that data classes are full-featured classes, you can reduce system complexity and build more expressive architectures.

1. Singleton-like Factory
Purpose:
Maintain a single shared instance (e.g., configuration per environment).

Key Idea:
Use ClassVar as a shared cache and a @classmethod to return an existing instance if available.

Benefits:
Provides global access to a consistent object without explicit dependency injection.

---

2. Automatic Registration System
Purpose:
Automatically register classes upon definition (useful for plugins or event systems).

Key Idea:
Use a custom decorator to register classes into a global registry at definition time.

dataclass_transform:
Helps IDEs and type checkers understand that the decorator behaves like a dataclass.

Benefits:
Eliminates manual registration and reduces boilerplate.

---

3. Self-Validation
Purpose:
Perform lightweight validation without external libraries like Pydantic.

Key Idea:
Use __post_init__ to validate field values immediately after object creation.
Optionally use decorators to define field-specific validators.

Benefits:
Keeps validation logic close to the data model.

---

4. SQL Schema Generator
Purpose:
Generate SQL table schemas from dataclass definitions.

Key Idea:
Use field(metadata=...) to store schema-related information such as primary keys and indexes.
At runtime, inspect metadata to generate SQL statements.

Benefits:
Ensures consistency between application models and database schema.

---

5. Cached Properties
Purpose:
Optimize performance by caching expensive computations.

Key Idea:
Use functools.cached_property to compute values once and reuse them.
Works even with frozen=True dataclasses.

Benefits:
Reduces repeated computation cost (e.g., parsing results).

---

6. Self-building CLI Parser
Purpose:
Automatically generate CLI interfaces from dataclass fields.

Key Idea:
Integrate with argparse to map dataclass fields and types into CLI arguments.

Benefits:
Minimizes boilerplate and keeps CLI definitions in sync with data models.

---

7. Context Manager Support
Purpose:
Allow dataclass instances to be used with the "with" statement.

Key Idea:
Implement __enter__ and __exit__ methods.
Store resource-related information (e.g., file path, mode) in the dataclass.

Benefits:
Combines data representation with resource lifecycle management.

---

Bonus: InitVar (Initialization-only Variables)

Definition:
InitVar fields are passed during initialization but are not stored as instance attributes.

Use Case:
Handle temporary input (e.g., raw passwords) and store only processed results.

Example:

from dataclasses import dataclass, field, InitVar

@dataclass
class User:
    email: str
    password_hash: str = field(init=False)
    raw_password: InitVar[str]

    def __post_init__(self, raw_password: str):
        self.password_hash = self.hash_method(raw_password)

---

Summary and Recommendations

Technique         | Use Case                          | Key Features / Modules
------------------|-----------------------------------|------------------------
Singleton         | Global configuration management   | ClassVar, @classmethod
Registration      | Plugin / event systems            | Decorators, dataclass_transform
Validation        | Lightweight input validation      | __post_init__
Cached Property   | Performance optimization          | functools.cached_property
CLI Parser        | CLI tool generation               | argparse integration
InitVar           | Temporary data handling           | InitVar type hint

Conclusion:
Data classes are not just simple data holders. They are full-fledged Python classes capable of leveraging the language’s advanced features. By effectively using __post_init__, InitVar, and metadata, you can build clean and maintainable systems without relying on heavy frameworks.