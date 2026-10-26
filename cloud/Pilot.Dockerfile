# Build from the repository root: docker build -f cloud/Pilot.Dockerfile .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/pilot
COPY cloud/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir -r /tmp/requirements.lock
COPY cloud/pyproject.toml cloud/README.md ./cloud/
COPY cloud/nanomuse_cloud ./cloud/nanomuse_cloud
COPY cloud/pilot-public ./cloud/pilot-public
COPY scripts/pilot-relay.py ./scripts/pilot-relay.py
RUN pip install --no-cache-dir --no-deps ./cloud \
 && groupadd --gid 10001 relay \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin relay \
 && mkdir -p /srv/pilot/data \
 && chown 10001:10001 /srv/pilot/data
USER 10001:10001
ENV CLOUD_DB=/srv/pilot/data/cloud.db
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/healthz', timeout=3)"
CMD ["python", "scripts/pilot-relay.py", "serve", "--host", "0.0.0.0", "--environment"]
