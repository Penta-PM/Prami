"""시작 시 필수 환경변수 검사 — DB·네트워크 없이 돈다."""

from __future__ import annotations

import pytest

from jodal.cli import main


@pytest.fixture
def env(tmp_path, monkeypatch):
    config, ref = tmp_path / "config", tmp_path / "reference"
    config.mkdir()
    ref.mkdir()
    monkeypatch.setenv("COLLECTOR_DATABASE_URL", "postgres://e2e:e2e@localhost:1/e2e_unused_test")
    monkeypatch.setenv("JODAL_CONFIG_DIR", str(config))
    monkeypatch.setenv("JODAL_REF_DIR", str(ref))
    return {"config": config, "ref": ref}


def _start_error(capsys, argv) -> str:
    with pytest.raises(SystemExit) as exc:
        main(argv)
    assert exc.value.code == 2
    return capsys.readouterr().err


@pytest.mark.parametrize("name", ["JODAL_REF_DIR", "JODAL_CONFIG_DIR", "COLLECTOR_DATABASE_URL"])
def test_daily_requires_env(env, monkeypatch, capsys, name):
    monkeypatch.delenv(name)
    err = _start_error(capsys, ["daily", "--no-email"])
    assert "시작 오류" in err and name in err


@pytest.mark.parametrize("name", ["JODAL_REF_DIR", "JODAL_CONFIG_DIR"])
def test_daily_rejects_missing_directory(env, tmp_path, monkeypatch, capsys, name):
    monkeypatch.setenv(name, str(tmp_path / "missing"))
    err = _start_error(capsys, ["daily", "--no-email"])
    assert name in err


def test_config_dir_required_even_with_file_overrides(env, monkeypatch, capsys, tmp_path):
    monkeypatch.delenv("JODAL_CONFIG_DIR")
    f = tmp_path / "f.md"
    f.write_text("물품분류명\n가상분류명\n", encoding="utf-8")
    err = _start_error(capsys, ["daily", "--filter-file", str(f), "--products-file", str(f)])
    assert "JODAL_CONFIG_DIR" in err


def test_bids_requires_database_url(env, monkeypatch, capsys):
    monkeypatch.delenv("COLLECTOR_DATABASE_URL")
    assert "COLLECTOR_DATABASE_URL" in _start_error(capsys, ["bids"])


def test_removed_options_are_rejected(env, capsys):
    for argv in (["daily", "--email-to", "x"], ["daily", "--db"], ["bids", "--db"], ["monthly"]):
        with pytest.raises(SystemExit):
            main(argv)
