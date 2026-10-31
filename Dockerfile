FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend ./frontend
COPY public/js/broadcast-media.js public/js/broadcast-media.d.ts public/js/event-channel.js public/js/event-channel.d.ts ./public/js/
COPY public/js/display-cache.js public/js/display-cache.d.ts ./public/js/
COPY public/js/output-profile.js public/js/output-profile.d.ts public/js/display-preferences.js public/js/display-preferences.d.ts ./public/js/
COPY vite.config.ts tsconfig.json ./
RUN npm run build
FROM node:24-alpine
WORKDIR /app
LABEL io.resolver.network-layout="2"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=9080 RESOLVER_DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --from=build --chown=node:node /app/public/platform ./public/platform
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 9080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-9080}/api/health"
CMD ["node", "server/index.js"]
