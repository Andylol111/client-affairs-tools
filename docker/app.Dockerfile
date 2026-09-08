# One image = Vite SPA + FastAPI. Local `start-all.sh` is unchanged (venv + Vite).
FROM node:22-alpine AS fe
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend .
COPY --from=fe /fe/dist /app/frontend_dist
ENV FRONTEND_DIST=/app/frontend_dist
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
