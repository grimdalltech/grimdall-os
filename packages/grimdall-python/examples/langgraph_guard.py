from grimdall import Grimdall

grimdall = Grimdall()


def grimdall_guard_node(state):
    grimdall.assert_allowed(state["tool"], state.get("arguments", {}))
    return state
