"""Real localhost server smoke; protocol peers are fixtures, not real DSH agents."""
import json
import os
import re
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]


def test_real_http_websocket_restart(tmp_path):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env_file = tmp_path / 'relay.env'
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/pilot-relay.py'), 'init',
                             '--env-file', str(env_file), '--public-base', base], capture_output=True)
    assert result.returncode == 0
    environment = dict(os.environ, PYTHONUTF8='1')
    # Pytest upstream fixtures set model/media env values; never inherit them into smoke.
    for key in ['CLOUD_MODELS', 'CLOUD_MEDIA_ENABLED', 'CLOUD_DB', 'CLOUD_ADMIN_TOKEN', 'CLOUD_SECRET']:
        environment.pop(key, None)
    process = None
    logfile = tmp_path / 'relay.log'
    log = logfile.open('ab')
    client = httpx.Client(base_url=base, trust_env=False, timeout=5)

    def start():
        proc = subprocess.Popen([sys.executable, str(ROOT / 'scripts/pilot-relay.py'), 'serve',
                                 '--env-file', str(env_file), '--data-dir', str(tmp_path / 'data'),
                                 '--port', str(port)], stdout=log, stderr=log, env=environment, cwd=ROOT)
        for _ in range(100):
            assert proc.poll() is None, 'Relay exited before health check'
            try:
                if client.get('/healthz').status_code == 200:
                    return proc
            except httpx.HTTPError:
                pass
            time.sleep(.1)
        proc.terminate()
        proc.wait(timeout=10)
        raise AssertionError('Relay did not become healthy')

    def signup(identifier, device):
        before = len(re.findall(r'verification code for .*: (\d{6})', logfile.read_text(encoding='utf-8')))
        assert client.post('/v1/auth/code', json={'identifier': identifier}).status_code == 204
        for _ in range(50):
            codes = re.findall(r'verification code for .*: (\d{6})', logfile.read_text(encoding='utf-8'))
            if len(codes) > before:
                break
            time.sleep(.05)
        assert len(codes) > before
        response = client.post('/v1/auth/verify', json={'identifier': identifier, 'code': codes[-1], 'device': device})
        assert response.status_code == 200
        assert response.json()['base_url'] == base
        return response.json()['api_key']

    def receive(ws, kind):
        for _ in range(15):
            frame = json.loads(ws.recv(timeout=5))
            if frame['type'] == kind:
                return frame
        raise AssertionError('Expected frame not received: ' + kind)

    def hello(ws, key, device):
        ws.send(json.dumps({'type': 'hello', 'key': key, 'device': {
            'id': device, 'name': device, 'kind': 'computer', 'os': 'Test', 'version': '1',
            'actions': ['task', 'approve', 'stop', 'info']}}))
        assert receive(ws, 'welcome')['device_id'] == device

    try:
        process = start()
        assert client.get('/v1/devices').status_code == 401
        assert client.get('/privacy').status_code == client.get('/own-key').status_code == 200
        config = client.get('/v1/config').json()
        assert base in json.dumps(config)
        phone_key = signup('pilot-smoke@example.com', 'phone')
        desk_key = signup('pilot-smoke@example.com', 'desktop')
        other_key = signup('pilot-other@example.com', 'other')
        auth = {'Authorization': 'Bearer ' + phone_key}
        other_auth = {'Authorization': 'Bearer ' + other_key}
        assert client.get('/v1/models', headers=auth).status_code == 200
        wsurl = f'ws://127.0.0.1:{port}/v1/hub'
        with connect(wsurl, proxy=None) as phone, connect(wsurl, proxy=None) as desk, connect(wsurl, proxy=None) as other:
            hello(phone, phone_key, 'smoke-phone')
            hello(desk, desk_key, 'smoke-desktop')
            hello(other, other_key, 'smoke-other')
            assert client.get('/v1/devices', headers=other_auth).json()['devices'][0]['id'] == 'smoke-other'
            phone.send(json.dumps({'type': 'call', 'id': 'task-1', 'to': 'smoke-desktop', 'action': 'task',
                                   'from': {'id': 'spoofed'}, 'args': {'text': 'fixture only', 'conversation': 'smoke'}}))
            call = receive(desk, 'call')
            assert call['from']['id'] == 'smoke-phone' and call['action'] == 'task'
            desk.send(json.dumps({'type': 'event', 'id': 'task-1', 'body': {'stage': 'approval', 'approval_id': 'a1'}}))
            assert receive(phone, 'event')['body']['approval_id'] == 'a1'
            for action, args in [('approve', {'approval_id': 'a1', 'allow': False}), ('stop', {'call': 'task-1'})]:
                phone.send(json.dumps({'type': 'call', 'id': action, 'to': 'smoke-desktop', 'action': action, 'args': args}))
                routed = receive(desk, 'call')
                assert routed['action'] == action and routed['args'] == args
                desk.send(json.dumps({'type': 'result', 'id': action, 'ok': True, 'body': {}}))
                assert receive(phone, 'result')['id'] == action
            desk.send(json.dumps({'type': 'result', 'id': 'task-1', 'ok': False, 'error': 'cancelled', 'message': 'fixture'}))
            assert receive(phone, 'result')['error'] == 'cancelled'
            other.send(json.dumps({'type': 'call', 'id': 'foreign', 'to': 'smoke-desktop', 'action': 'info', 'args': {}}))
            assert receive(other, 'error')['id'] == 'foreign'
            cid, mid = str(uuid.uuid4()), str(uuid.uuid4())
            response = client.post('/v1/sync/changes', headers=auth, json={'device': 'smoke-phone',
                'conversations': [{'cid': cid, 'kind': 'side', 'title': 'Smoke', 'created_at': 1738000000, 'updated_at': 1738000000}],
                'messages': [{'mid': mid, 'cid': cid, 'role': 'user', 'text': 'fixture text', 'created_at': 1738000050}]})
            assert response.status_code == 200 and response.json()['accepted'] == 2
            assert client.get('/v1/sync/changes', headers=other_auth).json()['messages'] == []
        # New sockets retain the same opaque device identity.
        with connect(wsurl, proxy=None) as again:
            hello(again, desk_key, 'smoke-desktop')
        process.terminate()
        process.wait(timeout=10)
        process = start()
        assert client.get('/v1/me', headers=auth).status_code == 200
        assert client.get('/v1/sync/changes', headers=auth).json()['messages'][0]['mid'] == mid
        with connect(wsurl, proxy=None) as restarted:
            hello(restarted, desk_key, 'smoke-desktop')
        assert client.post('/v1/auth/sign-out', headers=auth).status_code == 204
        assert client.get('/v1/me', headers=auth).status_code == 401
    finally:
        client.close()
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        log.close()
