# TV Legal France - Stremio Addon

Addon Stremio pour accéder aux chaînes et contenus français **100% légaux** :

- **France.tv** - Direct + Replay (France 2, 3, 4, 5, franceinfo)
- **Arte.tv** - Direct + Replay
- **TF1+** - Direct uniquement (TF1, TMC, TFX, LCI + chaînes FAST)

## Installation

### Prérequis

- Node.js 14+
- npm

### Installation

```bash
git clone https://github.com/Loo-stick/stremio-addon-tvlegal.git
cd stremio-addon-tvlegal
npm install
npm start
```

### Installation dans Stremio

1. Ouvrez votre navigateur sur `http://localhost:7001/configure`
2. Configurez vos options :
   - **Catalogues** : Sélectionnez les catalogues à afficher
   - **Directs TV** : Activez/désactivez les chaînes en direct
   - **TF1+** : Entrez vos identifiants pour accéder aux directs TF1, TMC, TFX, LCI
   - **TMDB** : Ajoutez votre clé API pour le filtrage par genre (Films/Séries)
3. Cliquez sur "Installer dans Stremio"

> **Note** : France.tv et Arte fonctionnent sans configuration. TF1+ nécessite un compte gratuit. TMDB est optionnel (pour les filtres par genre).

### Configuration serveur (optionnel)

Pour une configuration par défaut côté serveur, créez un fichier `.env` :

```bash
cp .env.example .env
```

```env
# Port du serveur (défaut: 7001)
PORT=7001

# TF1+ (compte gratuit requis sur tf1.fr)
TF1_EMAIL=votre@email.com
TF1_PASSWORD=votremotdepasse

# TMDB (pour le filtrage par genre - clé gratuite sur themoviedb.org)
TMDB_API_KEY=votre_cle_api

# Proxy SOCKS5 optionnel (pour contourner les restrictions géographiques)
# TF1_PROXY_HOST=
# TF1_PROXY_PORT=1080
```

> Les utilisateurs peuvent aussi fournir leurs propres credentials via la page de configuration, sans avoir besoin du fichier `.env`.

## Docker

L'image Docker est disponible sur GitHub Container Registry.

### Lancement rapide

```bash
docker run -d \
  --name tvlegal \
  -p 7001:7001 \
  ghcr.io/loo-stick/stremio-addon-tvlegal:latest
```

### Avec options

```bash
docker run -d \
  --name tvlegal \
  -p 7001:7001 \
  -e TF1_EMAIL=votre@email.com \
  -e TF1_PASSWORD=votremotdepasse \
  -e TMDB_API_KEY=votre_cle_api \
  ghcr.io/loo-stick/stremio-addon-tvlegal:latest
```

### Avec Docker Compose

```yaml
version: '3.8'
services:
  tvlegal:
    image: ghcr.io/loo-stick/stremio-addon-tvlegal:latest
    container_name: tvlegal
    restart: unless-stopped
    ports:
      - "7001:7001"
    environment:
      - TF1_EMAIL=votre@email.com      # Optionnel
      - TF1_PASSWORD=votremotdepasse   # Optionnel
      - TMDB_API_KEY=votre_cle_api     # Optionnel
```

L'addon sera disponible sur :
- **Configuration** : `http://localhost:7001/configure`
- **Manifest** : `http://localhost:7001/manifest.json`

## Sources et contenus

| Source | Direct | Replay | Auth requise |
|--------|--------|--------|--------------|
| France.tv | ✅ | ✅ | Non |
| Arte.tv | ✅ | ✅ | Non |
| TF1+ | ✅ | ❌ (DRM) | Oui (gratuit) |

### Catalogues disponibles

| Catalogue | Source | Filtres par genre |
|-----------|--------|-------------------|
| Directs | France.tv, Arte, TF1+ | - |
| Films | Arte | Drame, Comédie, Thriller, Action, etc. (TMDB) |
| Séries France.tv | France.tv | Drame, Comédie, Policier, etc. (TMDB) |
| Séries Arte | Arte | Thriller, Policier, Comédie, etc. (TMDB) |
| Docs Arte | Arte | Histoire, Société, Culture, Nature, Sciences |
| Docs France.tv | France.tv | Histoire, Société, Nature, Culture |
| Émissions TV | France.tv | - |
| Sport | France.tv | - |
| Rugby | France.tv | - |

### Filtres par genre

- **Films et Séries** : Filtrage via TMDB (clé API requise)
- **Documentaires** : Filtrage natif via les catégories Arte/France.tv (pas de clé requise)

> Sans clé TMDB, les options de genre pour Films/Séries sont masquées. Les filtres Documentaires fonctionnent toujours.

### Compatibilité IMDB

L'addon répond automatiquement aux IDs IMDB (`tt1234567`). Cela signifie que lorsque vous consultez une fiche série/film depuis un autre catalogue (Cinemeta, etc.), l'addon TV Legal proposera automatiquement les sources Arte/France.tv si le contenu est disponible.

## Limitations connues

- **TF1+ Replay** : Protégé par DRM Widevine, non supporté
- **Certains contenus France.tv** : Peuvent être protégés par DRM
- **Géolocalisation** : Certains contenus sont réservés à la France métropolitaine

## Déploiement

### Avec PM2

```bash
npm install -g pm2
pm2 start index.js --name tvlegal
pm2 save
pm2 startup
```

### Avec systemd

```ini
[Unit]
Description=TV Legal Stremio Addon
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/chemin/vers/stremio-addon-tvlegal
ExecStart=/usr/bin/node index.js
Restart=on-failure
EnvironmentFile=/chemin/vers/stremio-addon-tvlegal/.env

[Install]
WantedBy=multi-user.target
```

## Sécurité des credentials

**Important** : Ne partagez jamais votre fichier `.env` contenant vos identifiants.

- Le fichier `.env` est automatiquement ignoré par git (`.gitignore`)
- Utilisez `.env.example` comme modèle sans vos vraies informations
- Pour TF1+, créez un compte dédié si vous préférez ne pas utiliser votre compte principal

## Licence

MIT

---

## Avertissement légal / Disclaimer

### Français

Cet addon est un projet **personnel et non commercial** qui agrège des contenus provenant exclusivement de **sources légales et officielles** :
- France Télévisions (france.tv)
- Arte (arte.tv)
- TF1 (tf1.fr)

**L'auteur de ce projet :**
- Ne fournit, n'héberge et ne stocke aucun contenu média
- Ne contourne aucune protection DRM (les contenus protégés ne sont pas accessibles)
- Respecte les conditions d'utilisation des services sources
- N'est pas affilié à France Télévisions, Arte ou TF1

**Responsabilité :**
- Ce logiciel est fourni "tel quel", sans aucune garantie
- L'auteur décline toute responsabilité quant à l'utilisation de cet addon
- L'utilisateur est seul responsable du respect des conditions d'utilisation des services tiers
- L'utilisateur est seul responsable de la légalité de l'utilisation dans sa juridiction

**Usage des credentials :**
- Les identifiants TF1+ et clés API sont encodés dans l'URL de l'addon
- Ils ne sont jamais transmis à des tiers autres que les services concernés (TF1.fr, TMDB)
- Vous êtes responsable de la sécurité de vos propres identifiants
- Vous pouvez reconfigurer l'addon à tout moment via le bouton "Configure" dans Stremio

### English

This addon is a **personal, non-commercial project** that aggregates content exclusively from **legal and official sources**:
- France Télévisions (france.tv)
- Arte (arte.tv)
- TF1 (tf1.fr)

**The author of this project:**
- Does not provide, host, or store any media content
- Does not bypass any DRM protection (protected content is not accessible)
- Respects the terms of service of source platforms
- Is not affiliated with France Télévisions, Arte, or TF1

**Liability:**
- This software is provided "as is", without any warranty
- The author disclaims all liability for the use of this addon
- Users are solely responsible for complying with third-party service terms
- Users are solely responsible for the legality of use in their jurisdiction

**Credentials usage:**
- TF1+ credentials and API keys are encoded in the addon URL
- They are never transmitted to third parties other than the relevant services (TF1.fr, TMDB)
- You are responsible for the security of your own credentials
- You can reconfigure the addon at any time via the "Configure" button in Stremio
