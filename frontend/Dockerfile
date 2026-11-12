# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
# ETAPA 1: compilar React + Vite
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────
# ETAPA 2: servir con nginx y hacer proxy a la API
# ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# El entrypoint oficial de nginx sustituye ${API_URL} en las plantillas
# de /etc/nginx/templates y genera /etc/nginx/conf.d/default.conf.
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
ENV API_URL=http://api:3000

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
