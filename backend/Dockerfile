FROM python:3.12.14-alpine3.24

WORKDIR /app
RUN apk upgrade --no-cache

COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY . .

RUN addgroup -g 10001 yucg && adduser -D -u 10001 -G yucg yucg \
    && mkdir -p /data && chown -R 10001:10001 /app /data
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
