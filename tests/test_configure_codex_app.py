from __future__ import annotations

import os
import subprocess
from pathlib import Path


def test_configure_codex_app_attaches_and_verifies_swarm_secret(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log_path = tmp_path / "docker.log"
    state_path = tmp_path / "updated"

    docker = bin_dir / "docker"
    docker.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$DOCKER_LOG"; printf '\n' >>"$DOCKER_LOG"
if [[ "$1 $2" == "service inspect" ]]; then
  if [[ "$*" == *"ContainerSpec.Secrets"* ]] && [[ -f "$DOCKER_STATE" ]]; then
    echo supermemento_codex_relay_key
  elif [[ "$*" == *"ContainerSpec.Env"* ]]; then
    echo OPENAI_CODEX_RELAY_KEY=legacy-direct-value
  fi
  exit 0
fi
if [[ "$1 $2" == "secret inspect" ]]; then exit 1; fi
if [[ "$1 $2" == "secret create" ]]; then /bin/cat >/dev/null; exit 0; fi
if [[ "$1 $2" == "service update" ]]; then touch "$DOCKER_STATE"; exit 0; fi
if [[ "$1" == "ps" ]]; then echo container-id; exit 0; fi
if [[ "$1" == "exec" ]]; then exit 0; fi
exit 1
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)

    curl = bin_dir / "curl"
    curl.write_text("#!/usr/bin/env bash\nprintf '200'\n", encoding="utf-8")
    curl.chmod(0o755)

    script = Path(__file__).resolve().parents[1] / "deploy" / "configure_codex_app.sh"
    environment = os.environ.copy()
    environment.update(
        {
            "PATH": f"{bin_dir}:{environment['PATH']}",
            "DOCKER_LOG": str(log_path),
            "DOCKER_STATE": str(state_path),
        }
    )
    result = subprocess.run(
        [str(script)],
        input="r" * 48,
        text=True,
        capture_output=True,
        env=environment,
        check=True,
    )

    log = log_path.read_text(encoding="utf-8")
    assert "secret create supermemento_codex_relay_key -" in log
    assert r"--secret-add source=supermemento_codex_relay_key\,target=supermemento_codex_relay_key\,mode=0400" in log
    assert "--env-add OPENAI_CODEX_RELAY_KEY_FILE=/run/secrets/supermemento_codex_relay_key" in log
    assert "--env-rm OPENAI_CODEX_RELAY_KEY" in log
    assert "secret_mounted=yes health=200" in result.stdout
    assert "legacy-direct-value" not in result.stdout
