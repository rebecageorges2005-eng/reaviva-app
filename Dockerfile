FROM node:22-alpine
WORKDIR /app
COPY api/package*.json ./api/
RUN cd api && npm ci --omit=dev
COPY api ./api
COPY web ./web
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "api/server.js"]
