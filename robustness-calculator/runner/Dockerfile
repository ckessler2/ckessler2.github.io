# easyNNV runner image: the newest Vehicle and Marabou, plus server.py.
# Rebuilt daily by .github/workflows/runner-image.yml, which publishes it only if smoke_test.py passes.
# Both tools publish Linux builds for x86 only, so the image is linux/amd64
# (Apple Silicon Macs run it under emulation). maraboupy ships builds for Python <= 3.11 and Vehicle needs >= 3.10, so 3.11.
FROM python:3.11-slim

# Pre-built packages only, so no package's install scripts run. No versions pinned: always the newest.
RUN pip install --no-cache-dir --only-binary=:all: --upgrade vehicle-lang maraboupy \
 && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner

COPY server.py /app/server.py

LABEL org.opencontainers.image.source="https://github.com/ckessler2/ckessler2.github.io" \
      org.opencontainers.image.description="easyNNV runner: Vehicle and Marabou behind a local HTTP API"

ARG REVISION=local
ENV EASYNNV_IMAGE_REVISION=$REVISION HOME=/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8765
ENTRYPOINT ["python", "-I", "/app/server.py"]
