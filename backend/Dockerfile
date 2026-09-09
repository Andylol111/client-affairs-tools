FROM python:3.12-slim

WORKDIR /app

COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY . .

RUN groupadd --gid 10001 yucg && useradd --uid 10001 --gid 10001 --create-home yucg \
    && mkdir -p /data && chown -R 10001:10001 /app /data
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
