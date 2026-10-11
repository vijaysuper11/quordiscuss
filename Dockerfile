FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
