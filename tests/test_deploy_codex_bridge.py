from pathlib import Path


def test_swarm_bridge_uses_supported_hardening_flags() -> None:
    script = (
        Path(__file__).resolve().parents[1] / "deploy" / "deploy_codex_bridge.sh"
    ).read_text(encoding="utf-8")
    assert "--user 1000:1000" in script
    assert "--read-only" in script
    assert "--cap-drop ALL" in script
    assert "node.hostname==" in script
    assert "--security-opt" not in script
