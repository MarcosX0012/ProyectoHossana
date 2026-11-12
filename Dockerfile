# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
# ETAPA 1: compilar la API (TypeScript + Prisma)
# ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Prisma necesita openssl para su motor de consultas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Se copia prisma/ antes de npm ci para que el postinstall de
# @prisma/client pueda encontrar el schema.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

RUN npx prisma generate --schema prisma/schema.prisma

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────────
# ETAPA 2: imagen de ejecución
# ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# En producción real sobrescribe NODE_ENV y define secretos fuertes.
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl \
        ca-certificates \
        dumb-init \
    && rm -rf /var/lib/apt/lists/*

# prisma está en dependencies para poder ejecutar `migrate deploy`
# cuando arranca el contenedor.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# Cliente generado en la etapa de build (misma versión del lockfile).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Código compilado.
COPY --from=build /app/dist ./dist

# Comprobantes de pago. En compose se monta un volumen aquí.
RUN mkdir -p /app/uploads/payment-proofs \
    && chown -R node:node /app/uploads

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/src/index.js"]
