# ── AlgoMint Frontend ─────────────────────────────────────────
# Multi-stage build: build Next.js, then serve with minimal image.

# --- Stage 1: Install deps & build ---
FROM node:18-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Backend URL injected at build time for Next.js static optimisation
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL

RUN npm run build

# --- Stage 2: Production runner ---
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy only what is needed to run
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
