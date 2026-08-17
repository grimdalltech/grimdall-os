# CrewAI adapter

Requires `crewai`:

```bash
pip install "grimdall[crewai]"
```

`wrap_crewai_tool` replaces a tool's `_run` and `run` entry points so every
call is checked before delegation to the original `_run`. Blocked calls
raise `GrimdallBlockedError` and are logged; allowed calls behave exactly
as before.

```python
from crewai.tools import BaseTool

from grimdall import Guard
from grimdall.integrations.crewai import wrap_crewai_tool

guard = Guard()

class FileEditorTool(BaseTool):
    name: str = "editFile"
    description: str = "Edits a file in the repository."

    def _run(self, file_path: str, content: str) -> str:
        return f"[mock] edited {file_path}"

tool = FileEditorTool()
wrap_crewai_tool(tool, guard)

result = tool.run(file_path="src/main.py", content="print('hi')")  # guarded
```

## Example

```bash
pip install "grimdall[crewai]"
python examples/python/crewai/crewai_example.py
```