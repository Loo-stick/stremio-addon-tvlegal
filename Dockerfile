FROM node:18-alpine

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation des dépendances
RUN npm ci --only=production

# Copie du code source
COPY index.js ./
COPY configure.html ./
COPY lib/ ./lib/

# Port par défaut
ENV PORT=7001

EXPOSE 7001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/manifest.json || exit 1

# Démarrage
CMD ["node", "index.js"]
