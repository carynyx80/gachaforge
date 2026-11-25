# syntax=docker/dockerfile:1
# GachaForge API — multi-stage build for Railway (or any container host).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# SQL migrations are applied at boot by the Postgres store (dist/store -> ../../drizzle).
COPY drizzle ./drizzle
USER node
# Railway injects PORT; 4000 is the local default.
EXPOSE 4000
CMD ["node", "dist/index.js"]
