FROM node:24-alpine
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
COPY --chown=node:node index.js ./index.mjs
COPY --chown=node:node source.mjs ./source.mjs
RUN ffmpeg -L > /app/FFMPEG-LICENSE.txt 2>&1
USER node
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -q -O /dev/null --header="X-Media-Key: ${MEDIA_INTERNAL_KEY}" http://127.0.0.1:8091/health
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","index.mjs"]
