# api — the protected backend. No dependencies, so the build needs no npm
# registry access; only the node:20-alpine base is pulled.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json index.js ./
COPY --chown=node:node src ./src

USER node
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:8000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "index.js"]
