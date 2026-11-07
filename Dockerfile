FROM node:22-alpine
WORKDIR /app
COPY server.js guide.json spawns.json pokerogue-ids.json ./
COPY lib ./lib
COPY public ./public
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
