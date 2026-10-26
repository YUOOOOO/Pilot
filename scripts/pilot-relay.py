#!/usr/bin/env python3
"""Pilot launcher for the pinned upstream relay; no alternate auth or task protocol."""
from __future__ import annotations

import argparse
import ipaddress
import logging
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CLOUD = ROOT / 'cloud'


def relay_origin(value: str) -> str:
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('Invalid relay port') from exc
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/')
            or any(c.isspace() for c in value)):
        raise ValueError('Relay URL must be an http(s) origin without credentials, path, query or fragment')
    if port is not None and not 1 <= port <= 65535:
        raise ValueError('Relay port must be 1-65535')
    local = parsed.hostname == 'localhost'
    try:
        address = ipaddress.ip_address(parsed.hostname)
        local = address.is_loopback or address in ipaddress.ip_network('10.0.0.0/8') or address in ipaddress.ip_network('172.16.0.0/12') or address in ipaddress.ip_network('192.168.0.0/16') or address in ipaddress.ip_network('fc00::/7')
    except ValueError:
        pass
    if parsed.scheme == 'http' and not local:
        raise ValueError('Public relays require HTTPS; HTTP is for loopback or private IPs only')
    return value.rstrip('/')


def initialize(path: Path, public_base: str, sender: str) -> None:
    base = relay_origin(public_base)
    if sender not in ('log', 'smtp', 'aliyun', 'both'):
        raise ValueError('Unsupported code sender')
    values = {
        'PUBLIC_BASE': base, 'CLOUD_DOMAIN': urlsplit(base).hostname, 'ACME_EMAIL': '',
        'CLOUD_SECRET': secrets.token_hex(32), 'CLOUD_ADMIN_TOKEN': secrets.token_hex(32),
        'CODE_SENDER': sender, 'SMTP_HOST': '', 'SMTP_PORT': '587', 'SMTP_USER': '',
        'SMTP_PASSWORD': '', 'SMTP_FROM': '', 'SIGNUP_OPEN': '1', 'IMPROVE_DEFAULT': '0',
        'HUB_ENABLED': '1', 'UPSTREAM_KEY': '', 'CLOUD_CATALOG': '0',
        'CLOUD_CATALOG_PROBE': '0', 'GITHUB_COLLECT': '0', 'CLOUD_GEOIP': '0',
        'REPO_URL': base + '/app/', 'PRIVACY_URL': base + '/privacy',
        'INVITE_URL': base + '/app/?invite=', 'OWN_KEY_DOCS': base + '/own-key',
        'REVIEW_ADDRESSES': '', 'REVIEW_CODE': '',
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('# Pilot relay: back up this file together with the database; never commit.\n')
        handle.writelines(f'{key}={value}\n' for key, value in values.items())
    print(f'Created {path}; secrets are not printed; existing files are never overwritten.')


def validate_environment() -> None:
    relay_origin(os.environ.get('PUBLIC_BASE', ''))
    for key in ('CLOUD_SECRET', 'CLOUD_ADMIN_TOKEN'):
        if len(os.environ.get(key, '').strip()) < 32:
            raise ValueError(f'{key} must contain at least 32 random characters')
    if os.environ['CLOUD_SECRET'] == os.environ['CLOUD_ADMIN_TOKEN']:
        raise ValueError('CLOUD_SECRET and CLOUD_ADMIN_TOKEN must differ')


def load_environment(path: Path) -> None:
    from dotenv import dotenv_values
    if not path.is_file():
        raise ValueError(f'Configuration missing: {path}; run init first')
    for key, value in dotenv_values(path, interpolate=False, encoding='utf-8').items():
        if value is None:
            raise ValueError(f'Missing configuration value: {key}')
        os.environ[key] = value
    validate_environment()


def create_pilot_app(settings):
    from fastapi.responses import FileResponse
    from nanomuse_cloud.api import create_app
    app = create_app(settings)
    # Fixed files, never a user-controlled filename/path.
    def privacy():
        return FileResponse(CLOUD / 'pilot-public/privacy.html', media_type='text/html')
    def own_key():
        return FileResponse(CLOUD / 'pilot-public/own-key.html', media_type='text/html')
    app.add_api_route('/privacy', privacy, include_in_schema=False)
    app.add_api_route('/own-key', own_key, include_in_schema=False)
    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Pilot self-hosted relay (pinned nanoMuse protocol)')
    parser.add_argument('command', choices=('init', 'serve', 'check'))
    parser.add_argument('--env-file', type=Path, default=CLOUD / '.env')
    parser.add_argument('--environment', action='store_true', help='Read original upstream process environment instead of a file (Docker env_file)')
    parser.add_argument('--public-base', default='http://127.0.0.1:8787')
    parser.add_argument('--sender', choices=('log', 'smtp', 'aliyun', 'both'), default='log')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--data-dir', type=Path, help='Map an explicit data directory to upstream CLOUD_DB')
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('Port must be 1-65535')
    try:
        if args.command == 'init':
            initialize(args.env_file.resolve(), args.public_base, args.sender)
            return 0
        sys.path.insert(0, str(CLOUD))
        if args.environment:
            validate_environment()
        else:
            load_environment(args.env_file.resolve())
        if args.data_dir:
            os.environ['CLOUD_DB'] = str(args.data_dir.resolve() / 'cloud.db')
        os.chdir(CLOUD)
        from nanomuse_cloud.__main__ import check_data_dir
        from nanomuse_cloud.config import Settings
        settings = Settings()
        check_data_dir(settings.database)
        if args.command == 'check':
            print(f'Configuration OK: {settings.public_base}; sender={settings.sender}; Hub={settings.hub_enabled}')
            return 0
        import uvicorn
        logging.basicConfig(level=logging.INFO)
        logging.getLogger('httpx').setLevel(logging.WARNING)
        uvicorn.run(create_pilot_app(settings), host=args.host, port=args.port, proxy_headers=True,
                    forwarded_allow_ips=settings.trusted_proxy_list, ws_max_size=settings.hub_frame_limit,
                    ws_ping_interval=25.0, ws_ping_timeout=60.0)
        return 0
    except (ValueError, OSError, ImportError) as exc:
        print(f'Relay failed: {exc}', file=sys.stderr)
        if isinstance(exc, ImportError):
            print('Install: python -m pip install -r cloud/requirements.lock; python -m pip install --no-deps -e cloud', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
