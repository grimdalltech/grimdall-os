"""Minimal Grimdall Python example: one decorator, one denied tool."""

from grimdall import Guard, Policy

guard = Guard()
guard.add_policy(Policy(deny=["delete_repo"]))


@guard.wrap
def run_shell(command: str) -> str:
    return f"[mock] executed: {command}"


@guard.wrap
def delete_repo(repo: str) -> str:
    return f"[mock] deleted {repo}"


print(run_shell("ls -la"))

try:
    delete_repo("acme/web")
except Exception as error:
    print(f"{type(error).__name__}: {error}")
