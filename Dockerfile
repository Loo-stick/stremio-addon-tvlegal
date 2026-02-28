FROM node:18-alpine

WORKDIR /app

# Dépendances système pour socks-proxy-agent (compilation native)
RUN apk add --no-cache python3 make g++

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation des dépendances
RUN npm ci --only=production

# Nettoyage des outils de build (optionnel, réduit la taille)
RUN apk del make g++

# Copie du code source
COPY index.js ./
COPY configure.html ./
COPY lib/ ./lib/

# Port par défaut
ENV PORT=7001

EXPOSE 7001

# Healthcheck avec délai plus long au démarrage
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/manifest.json || exit 1

# Démarrage
CMD ["node", "index.js"]
