import signal

import pytest

from jodal import cli


def test_sigterm_becomes_system_exit():
    # 잡 함수의 except BaseException 이 받아 job_runs 를 failed 로 닫을 수 있게 SystemExit 로 바꾼다
    with pytest.raises(SystemExit) as exc:
        cli._terminate(signal.SIGTERM, None)
    assert exc.value.code == 128 + signal.SIGTERM
