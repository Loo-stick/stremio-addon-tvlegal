FROM node:18-alpine

WORKDIR /app

# Dépendances système pour socks-proxy-agent (compilation native) et pywidevine
RUN apk add --no-cache python3 py3-pip make g++

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation des dépendances Node.js
RUN npm ci --only=production

# Installation de pywidevine pour le décryptage DRM (TF1 Replay)
# Note: L'utilisateur doit fournir son propre fichier device.wvd
RUN pip3 install --no-cache-dir --break-system-packages pywidevine requests

# Nettoyage des outils de build (optionnel, réduit la taille)
RUN apk del make g++

# Copie du code source
COPY index.js ./
COPY configure.html ./
COPY lib/ ./lib/

# Note: device.wvd doit être monté par l'utilisateur via volume Docker
# Exemple: docker run -v /path/to/device.wvd:/app/device.wvd ...

# Port par défaut
ENV PORT=7001

EXPOSE 7001

# Healthcheck avec délai plus long au démarrage
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/manifest.json || exit 1

# Démarrage
CMD ["node", "index.js"]
