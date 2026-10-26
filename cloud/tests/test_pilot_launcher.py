"""Pilot adapter tests; upstream auth, hub and sync have their own unchanged suites."""
import importlib.util
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('pilot_relay', ROOT / 'scripts/pilot-relay.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


@pytest.mark.parametrize('url', ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://192.168.1.2:8787', 'http://[::1]:8787', 'https://relay.example.com'])
def test_valid_origins(url):
    assert launcher.relay_origin(url + '/') == url


@pytest.mark.parametrize('url', ['http://example.com', 'http://8.8.8.8', 'http://0.0.0.0', 'http://169.254.1.1', 'https://user:pass@example.com', 'https://example.com/v1', 'https://example.com?key=secret', 'https://example.com#x', 'https://example.com:0', 'https://example.com:99999', 'https://bad host'])
def test_invalid_origins(url):
    with pytest.raises(ValueError):
        launcher.relay_origin(url)


def test_init_preserves_keys_and_uses_only_own_links(tmp_path, capsys):
    path = tmp_path / 'relay.env'
    launcher.initialize(path, 'https://relay.example.com', 'smtp')
    from dotenv import dotenv_values
    values = dotenv_values(path)
    assert len(values['CLOUD_SECRET']) == len(values['CLOUD_ADMIN_TOKEN']) == 64
    assert values['CLOUD_SECRET'] != values['CLOUD_ADMIN_TOKEN']
    assert values['CODE_SENDER'] == 'smtp'
    assert values['GITHUB_COLLECT'] == values['CLOUD_GEOIP'] == values['IMPROVE_DEFAULT'] == '0'
    for key in ['REPO_URL', 'PRIVACY_URL', 'INVITE_URL', 'OWN_KEY_DOCS']:
        assert values[key].startswith('https://relay.example.com/')
    before = path.read_bytes()
    with pytest.raises(FileExistsError):
        launcher.initialize(path, 'https://another.example.com', 'log')
    assert path.read_bytes() == before
    assert values['CLOUD_SECRET'] not in capsys.readouterr().out


def test_config_file_literal_values_and_validation(tmp_path, monkeypatch):
    path = tmp_path / 'relay.env'
    launcher.initialize(path, 'http://127.0.0.1:8787', 'log')
    with path.open('a') as f:
        f.write('SMTP_PASSWORD=abc$literal${NAME}\n')
    before = dict(launcher.os.environ)
    try:
        launcher.load_environment(path)
        assert launcher.os.environ['SMTP_PASSWORD'] == 'abc$literal${NAME}'
        launcher.os.environ['CLOUD_ADMIN_TOKEN'] = launcher.os.environ['CLOUD_SECRET']
        with pytest.raises(ValueError):
            launcher.validate_environment()
    finally:
        launcher.os.environ.clear()
        launcher.os.environ.update(before)


def test_public_links_are_served_by_pilot_app():
    from nanomuse_cloud.config import Settings
    settings = Settings(database=':memory:', secret='test-secret', github_collect=False, geoip_enabled=False)
    with TestClient(launcher.create_pilot_app(settings)) as client:
        assert client.get('/healthz').status_code == 200
        for path in ['/privacy', '/own-key']:
            response = client.get(path)
            assert response.status_code == 200
            assert 'Pilot' in response.text


def test_compose_matches_container_and_keeps_relay_private():
    compose = yaml.safe_load((ROOT / 'cloud/compose.pilot.yml').read_text())
    relay = compose['services']['relay']
    assert 'ports' not in relay
    assert relay['env_file'][0]['format'] == 'raw'
    assert relay['cap_drop'] == ['ALL']
    assert compose['services']['caddy']['depends_on']['relay']['condition'] == 'service_healthy'
    dockerfile = (ROOT / 'cloud/Pilot.Dockerfile').read_text()
    assert '--environment' in dockerfile and 'USER 10001:10001' in dockerfile
    assert 'COPY cloud/pilot-public' in dockerfile
