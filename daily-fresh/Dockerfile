FROM oven/bun:1.3.6-alpine

WORKDIR /app

# install deps first for layer caching
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# copy source + static assets
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# data dir for SQLite, persisted via volume
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3737

# entrypoint: migrate, then start server (server auto-prewarms if cache empty)
CMD ["sh", "-c", "bun run migrate && bun src/main.ts"]
