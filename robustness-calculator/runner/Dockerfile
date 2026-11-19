# easyNNV runner image: the newest Vehicle and Marabou, plus server.py and a copy of the page.
# Rebuilt daily by .github/workflows/runner-image.yml, which publishes it only if smoke_test.py passes.
# Build context: the robustness-calculator folder (docker build -f runner/Dockerfile .).
# Vehicle publishes builds for Linux, macOS and Windows, but Marabou (maraboupy 2.0.0) only for x86
# Linux and Intel macOS, on Python 3.8-3.11; so the image is linux/amd64 (Apple Silicon Macs run it
# under emulation, slower) on Python 3.11 (Vehicle needs >= 3.10).
FROM python:3.11-slim

# Pre-built packages only, so no package's install scripts run. No versions pinned: always the newest.
# --no-deps: vehicle-lang declares black, pytest and pre-commit (and their dependencies) as
# requirements, but needs only typing-extensions at run time; every extra package would be one
# more release that could carry malicious code. The smoke test catches a newly needed dependency.
RUN pip install --no-cache-dir --only-binary=:all: --upgrade --no-deps \
      vehicle-lang maraboupy typing-extensions \
 && mkdir -p /app \
 && pip freeze > /app/packages.txt \
 && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner

COPY runner/server.py /app/server.py
# The page, served at http://127.0.0.1:8765/ for browsers that block the public site from
# reaching this machine (see server.py, serve_site).
COPY index.html style.css /app/site/
COPY css /app/site/css
COPY src /app/site/src
COPY runner/example /app/site/runner/example

LABEL org.opencontainers.image.source="https://github.com/ckessler2/ckessler2.github.io" \
      org.opencontainers.image.description="easyNNV runner: Vehicle and Marabou behind a local HTTP API" \
      org.opencontainers.image.licenses="MIT"

ARG REVISION=local
ENV EASYNNV_IMAGE_REVISION=$REVISION EASYNNV_CONTAINER=1 HOME=/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8765
ENTRYPOINT ["python", "-I", "/app/server.py"]
