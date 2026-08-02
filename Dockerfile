FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig*.json vite.config.ts ./
COPY src/client ./src/client
COPY src/logo.png ./src/logo.png
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=20204

COPY package.json ./
COPY src/server.js ./src/server.js
COPY src/server ./src/server
COPY --from=build /app/dist ./dist

EXPOSE 20204

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 20204) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
