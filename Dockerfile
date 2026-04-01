FROM node:24-alpine

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js Joblio.html ./
COPY --chown=node:node assets ./assets
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node templates ./templates

RUN npm run build

RUN mkdir -p .joblio-data backups && chown node:node .joblio-data backups

USER node

EXPOSE 8787
VOLUME ["/app/.joblio-data", "/app/backups"]

CMD ["npm", "start"]
