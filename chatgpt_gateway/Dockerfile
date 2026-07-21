FROM python@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.lock /tmp/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock \
    && rm -f /tmp/requirements.lock

COPY --chown=65532:65532 . /app/chatgpt_gateway
RUN install -d -o 65532 -g 65532 -m 0700 /data

USER 65532:65532
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3))['status'] == 'ok'"

CMD ["python", "-m", "chatgpt_gateway.server"]
