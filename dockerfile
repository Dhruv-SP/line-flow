# ─── Stage 1: Build Next.js frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .
RUN npm run build


# ─── Stage 2: Final combined image ───────────────────────────────────────────
FROM python:3.12-slim

# Install Node.js 20 + supervisord
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Backend ───────────────────────────────────────────────────────────────────
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/

# ── Frontend (Next.js standalone) ────────────────────────────────────────────
COPY --from=frontend-builder /app/frontend/.next/standalone ./frontend/
COPY --from=frontend-builder /app/frontend/.next/static    ./frontend/.next/static/

# ── Process supervisor ────────────────────────────────────────────────────────
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 3002 is the public-facing Next.js port; 8002 is internal backend only
EXPOSE 3002

CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]