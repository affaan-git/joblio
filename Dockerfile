FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node server.js Joblio.html ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node templates ./templates

RUN mkdir -p .joblio-data backups && chown -R node:node /app

USER node

EXPOSE 8787
VOLUME ["/app/.joblio-data", "/app/backups"]

CMD ["npm", "start"]
