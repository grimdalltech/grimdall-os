# python-basic

Minimal Python SDK example: `@guard.wrap` one decorator, one denied tool.

```bash
pip install -e ./packages/python
python examples/python-basic/main.py
```

Expect an allowed call, then a `GrimdallBlockedError`. The audit trail is written to `.grimdall/audit.json` in your current directory.
