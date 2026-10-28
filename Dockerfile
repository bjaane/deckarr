FROM node:22-alpine

RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    PORT=8484 \
    CONFIG_DIR=/config \
    PUID=99 \
    PGID=100

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Strip Windows line endings in case the repo was edited on Windows.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8484
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD sh -c 'wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1'

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server/index.js"]
