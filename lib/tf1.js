/**
 * Client API TF1+
 *
 * Gère l'authentification Gigya et l'accès aux streams TF1+
 * Les credentials sont lus depuis les variables d'environnement
 * TF1_EMAIL et TF1_PASSWORD - JAMAIS stockés dans le code
 *
 * Proxy SOCKS5 optionnel (ex: NordVPN) via:
 * TF1_PROXY_HOST, TF1_PROXY_PORT, TF1_PROXY_USER, TF1_PROXY_PASS
 *
 * @module lib/tf1
 */

const fetch = require('node-fetch');
const { SocksProxyAgent } = require('socks-proxy-agent');

/** URL de l'API Gigya pour l'authentification */
const GIGYA_LOGIN_URL = 'https://compte.tf1.fr/accounts.login';

/** Clé API Gigya TF1 */
const GIGYA_API_KEY = '3_hWgJdARhz_7l1oOp3a8BDLoR9cuWZpUaKG4aqF7gum9_iK3uTZ2VlDBl8ANf8FVk';

/** URL pour obtenir le token TF1 */
const TOKEN_URL = 'https://www.tf1.fr/token/gigya/web';

/** URL de l'API MediaInfo */
const MEDIAINFO_URL = 'https://mediainfo.tf1.fr/mediainfocombo';

/** URL de l'API GraphQL TF1 */
const GRAPHQL_URL = 'https://www.tf1.fr/graphql/web';

/** IDs des requêtes GraphQL (persisted queries) */
const GRAPHQL_IDS = {
    PROGRAMS_BY_CHANNEL: '483ce0f',
    VIDEOS_BY_PROGRAM: 'a6f9cf0e',
    SEARCH_PROGRAMS: 'e78b188',
    SEARCH_VIDEOS: 'b2dc9439'
};

/** Mapping des chaînes pour l'API GraphQL */
const CHANNEL_SLUGS = ['tf1', 'tmc', 'tfx', 'lci'];

/** Cache en mémoire */
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/** Token d'authentification (en mémoire, jamais persisté) */
let authToken = null;
let authTokenExpiry = 0;

/** Agent proxy SOCKS5 (optionnel) */
let proxyAgent = null;

/**
 * Crée l'agent proxy SOCKS5 si configuré
 * @returns {SocksProxyAgent|null}
 */
function createProxyAgent() {
    const host = process.env.TF1_PROXY_HOST;
    const port = process.env.TF1_PROXY_PORT || '1080';
    const user = process.env.TF1_PROXY_USER;
    const pass = process.env.TF1_PROXY_PASS;

    if (!host) {
        return null;
    }

    let proxyUrl;
    if (user && pass) {
        proxyUrl = `socks5://${user}:${pass}@${host}:${port}`;
    } else {
        proxyUrl = `socks5://${host}:${port}`;
    }

    console.log(`[TF1] Proxy SOCKS5 configuré: ${host}:${port}`);
    return new SocksProxyAgent(proxyUrl);
}

// Initialise le proxy au chargement du module
proxyAgent = createProxyAgent();

/**
 * Récupère une valeur du cache ou exécute la fonction
 *
 * @param {string} key - Clé du cache
 * @param {Function} fn - Fonction à exécuter si pas en cache
 * @returns {Promise<*>} Résultat
 */
async function cached(key, fn) {
    const now = Date.now();
    const item = cache.get(key);

    if (item && now < item.expiry) {
        console.log(`[TF1] Cache hit: ${key}`);
        return item.value;
    }

    console.log(`[TF1] Cache miss: ${key}`);
    const value = await fn();
    cache.set(key, { value, expiry: now + CACHE_TTL });
    return value;
}

/**
 * Chaînes principales (statiques)
 */
const MAIN_CHANNELS = [
    { id: 'L_TF1', name: 'TF1', logo: 'https://photos.tf1.fr/450/0/logo-tf1-2020-min-1c7c27-26ba3a-0@1x.jpg' },
    { id: 'L_TMC', name: 'TMC', logo: 'https://photos.tf1.fr/450/0/logo-tmc-2020-min-9fe0e0-5b1f13-0@1x.jpg' },
    { id: 'L_TFX', name: 'TFX', logo: 'https://photos.tf1.fr/450/0/logo-tfx-2020-min-e2ef72-8c8d13-0@1x.jpg' },
    { id: 'L_TF1-SERIES-FILMS', name: 'TF1 Séries Films', logo: 'https://photos.tf1.fr/450/0/logo-tf1-series-films-2020-min-f0f0f0-0@1x.jpg' },
    { id: 'L_LCI', name: 'LCI', logo: 'https://photos.tf1.fr/450/0/logo-lci-2020-min-a0978b-4a05fe-0@1x.jpg' },
    { id: 'L_ARTE', name: 'ARTE', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Arte_Logo_2017.svg/200px-Arte_Logo_2017.svg.png' },
    { id: 'L_LCP-PUBLIC-SENAT', name: 'LCP / Public Sénat', logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/d/d3/LCP_AN_2017.svg/200px-LCP_AN_2017.svg.png' },
    { id: 'L_LE-FIGARO', name: 'Le Figaro TV', logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/d/d5/Logo_Le_Figaro_TV.svg/200px-Logo_Le_Figaro_TV.svg.png' }
];

/** Cache pour les chaînes FAST (durée: 6 heures) */
const FAST_CACHE_TTL = 6 * 60 * 60 * 1000;
let fastChannelsCache = null;
let fastChannelsCacheExpiry = 0;

/**
 * Découvre automatiquement les chaînes FAST depuis le site TF1
 * @returns {Promise<Array>} Liste des chaînes FAST
 */
async function discoverFastChannels() {
    const now = Date.now();

    // Retourne le cache si valide
    if (fastChannelsCache && now < fastChannelsCacheExpiry) {
        return fastChannelsCache;
    }

    console.log('[TF1] Découverte des chaînes FAST...');

    try {
        const response = await fetch('https://www.tf1.fr/tf1/direct', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const html = await response.text();

        // Extrait les slugs des chaînes FAST (format: nom-123456789)
        const regex = /href="\/([a-z0-9-]+-\d{8,})\/direct"/g;
        const slugs = new Set();
        let match;

        while ((match = regex.exec(html)) !== null) {
            slugs.add(match[1]);
        }

        // Convertit en format chaîne
        const channels = Array.from(slugs).map(slug => {
            // Transforme le slug en nom lisible
            const namePart = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
            const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);

            return {
                id: `L_FAST_v2l-${slug}`,
                name: name,
                isFast: true
            };
        });

        // Trie par nom
        channels.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

        console.log(`[TF1] ${channels.length} chaînes FAST découvertes`);

        // Met en cache
        fastChannelsCache = channels;
        fastChannelsCacheExpiry = now + FAST_CACHE_TTL;

        return channels;

    } catch (error) {
        console.error('[TF1] Erreur découverte FAST:', error.message);
        // Retourne le cache même expiré en cas d'erreur
        return fastChannelsCache || [];
    }
}

/** Référence pour compatibilité */
const LIVE_CHANNELS = MAIN_CHANNELS;

/**
 * Classe client pour l'API TF1+
 */
class TF1Client {
    /**
     * @param {string} [email] - Email TF1+ (optionnel, sinon utilise TF1_EMAIL)
     * @param {string} [password] - Mot de passe TF1+ (optionnel, sinon utilise TF1_PASSWORD)
     */
    constructor(email = null, password = null) {
        this.channels = LIVE_CHANNELS;
        // Credentials depuis paramètres ou variables d'environnement - JAMAIS en dur
        this.email = email || process.env.TF1_EMAIL;
        this.password = password || process.env.TF1_PASSWORD;
    }

    /**
     * Vérifie si les credentials sont configurés
     *
     * @returns {boolean} True si les credentials sont présents
     */
    isConfigured() {
        return !!(this.email && this.password);
    }

    /**
     * Effectue une requête HTTP (avec proxy si configuré)
     *
     * @param {string} url - URL à appeler
     * @param {Object} options - Options fetch
     * @returns {Promise<Object>} Réponse JSON
     * @private
     */
    async _fetch(url, options = {}) {
        const defaultHeaders = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        const fetchOptions = {
            ...options,
            headers: { ...defaultHeaders, ...options.headers }
        };

        // Utilise le proxy SOCKS5 si configuré
        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`[TF1] Erreur requête ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Authentification via Gigya
     * Les credentials ne sont JAMAIS loggés
     *
     * @returns {Promise<Object>} Infos de session Gigya
     * @private
     */
    async _loginGigya() {
        if (!this.isConfigured()) {
            throw new Error('TF1_EMAIL et TF1_PASSWORD non configurés');
        }

        console.log('[TF1] Authentification Gigya...');

        const params = new URLSearchParams();
        params.append('apiKey', GIGYA_API_KEY);
        params.append('loginID', this.email);
        params.append('password', this.password);

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: params
        };

        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        const response = await fetch(GIGYA_LOGIN_URL, fetchOptions);

        const data = await response.json();

        if (data.statusCode !== 200) {
            console.error('[TF1] Échec authentification Gigya:', data.errorMessage);
            throw new Error(`Authentification échouée: ${data.errorMessage}`);
        }

        console.log('[TF1] Authentification Gigya réussie');

        return {
            uid: data.UID,
            signature: data.UIDSignature,
            timestamp: parseInt(data.signatureTimestamp)
        };
    }

    /**
     * Obtient un token TF1 à partir de la session Gigya
     *
     * @param {Object} gigyaSession - Session Gigya
     * @returns {Promise<string>} Token JWT TF1
     * @private
     */
    async _getToken(gigyaSession) {
        console.log('[TF1] Obtention du token TF1...');

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://www.tf1.fr'
            },
            body: JSON.stringify({
                uid: gigyaSession.uid,
                signature: gigyaSession.signature,
                timestamp: gigyaSession.timestamp
            })
        };

        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        const response = await fetch(TOKEN_URL, fetchOptions);

        const data = await response.json();

        if (data.error) {
            console.error('[TF1] Erreur obtention token:', data.error);
            throw new Error(`Erreur token: ${data.error}`);
        }

        console.log('[TF1] Token TF1 obtenu (valide 12h)');

        return {
            token: data.token,
            refreshToken: data.refresh_token,
            ttl: data.ttl || 43200
        };
    }

    /**
     * Assure qu'un token valide est disponible
     * Gère le refresh automatique
     *
     * @returns {Promise<string>} Token JWT valide
     */
    async ensureToken() {
        const now = Date.now();

        // Token encore valide (avec 5 min de marge)
        if (authToken && now < authTokenExpiry - 300000) {
            return authToken;
        }

        console.log('[TF1] Token expiré ou absent, renouvellement...');

        // Login Gigya puis obtention token TF1
        const gigyaSession = await this._loginGigya();
        const tokenData = await this._getToken(gigyaSession);

        authToken = tokenData.token;
        authTokenExpiry = now + (tokenData.ttl * 1000);

        return authToken;
    }

    /**
     * Récupère les informations d'un média (live ou replay)
     *
     * @param {string} mediaId - ID du média (ex: L_TF1, 14191414)
     * @returns {Promise<Object|null>} Infos du média avec URL de stream
     */
    async getMediaInfo(mediaId) {
        console.log(`[TF1] Récupération média ${mediaId}...`);

        try {
            const token = await this.ensureToken();

            const url = `${MEDIAINFO_URL}/${mediaId}?context=MYTF1&pver=5010000&format=hls`;
            const fetchOptions = {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Authorization': `Bearer ${token}`
                }
            };

            if (proxyAgent) {
                fetchOptions.agent = proxyAgent;
            }

            const response = await fetch(url, fetchOptions);

            const data = await response.json();
            const media = data.media || {};

            if (media.error_code) {
                console.log(`[TF1] Erreur média ${mediaId}: ${media.error_code} - ${media.error_desc}`);
                return {
                    id: mediaId,
                    title: media.title,
                    error: media.error_code,
                    errorDesc: media.error_desc
                };
            }

            // Récupère l'URL de stream depuis delivery
            let streamUrl = null;
            if (data.delivery && data.delivery.url) {
                streamUrl = data.delivery.url;
            }

            return {
                id: mediaId,
                title: media.title,
                shortTitle: media.shortTitle,
                programName: media.programName,
                programSlug: media.programSlug,
                channel: media.channel2 || media.channel,
                type: media.type,
                duration: media.duration,
                preview: media.preview,
                sqPreview: media.sqPreview,
                isLive: media.type === 'live',
                streamUrl: streamUrl,
                geolock: media.geolock
            };

        } catch (error) {
            console.error(`[TF1] Erreur média ${mediaId}:`, error.message);
            return null;
        }
    }

    /**
     * Récupère les directs disponibles (chaînes principales + FAST auto-découvertes)
     *
     * @returns {Promise<Array>} Liste des chaînes en direct
     */
    async getLiveChannels() {
        return cached('live_channels', async () => {
            console.log('[TF1] Récupération des directs...');

            // Combine chaînes principales + FAST découvertes
            const fastChannels = await discoverFastChannels();
            const allChannels = [...MAIN_CHANNELS, ...fastChannels];

            const lives = [];

            for (const channel of allChannels) {
                try {
                    const info = await this.getMediaInfo(channel.id);
                    if (info && !info.error) {
                        lives.push({
                            id: channel.id,
                            title: `${channel.name} - Direct`,
                            description: info.shortTitle || info.title || `En direct sur ${channel.name}`,
                            image: info.preview,
                            logo: channel.logo,
                            channel: channel.name,
                            isLive: true,
                            isFast: channel.isFast || false
                        });
                    }
                } catch (error) {
                    // Silencieux pour les chaînes FAST qui peuvent ne pas être disponibles
                    if (!channel.isFast) {
                        console.error(`[TF1] Erreur live ${channel.id}:`, error.message);
                    }
                }
            }

            console.log(`[TF1] ${lives.length} directs disponibles`);
            return lives;
        });
    }

    /**
     * Effectue une requête GraphQL vers l'API TF1
     *
     * @param {string} queryId - ID de la requête persistée
     * @param {Object|string} variables - Variables de la requête (objet ou string JSON)
     * @returns {Promise<Object>} Réponse GraphQL
     * @private
     */
    async _graphql(queryId, variables = {}) {
        const varsString = typeof variables === 'string' ? variables : JSON.stringify(variables);
        const url = `${GRAPHQL_URL}?id=${queryId}&variables=${encodeURIComponent(varsString)}`;

        const fetchOptions = {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.tf1.fr/programmes-tv'
            }
        };

        if (proxyAgent) {
            fetchOptions.agent = proxyAgent;
        }

        try {
            const response = await fetch(url, fetchOptions);
            const data = await response.json();

            if (data.error) {
                console.error(`[TF1] Erreur GraphQL:`, data.error);
                return null;
            }

            return data.data || data;
        } catch (error) {
            console.error(`[TF1] Erreur GraphQL:`, error.message);
            return null;
        }
    }

    /**
     * Récupère les programmes d'une chaîne
     *
     * @param {string} channel - Slug de la chaîne (tf1, tmc, tfx, lci)
     * @returns {Promise<Array>} Liste des programmes
     */
    async getProgramsByChannel(channel) {
        console.log(`[TF1] Récupération programmes ${channel}...`);

        const variables = {
            context: {
                persona: 'PERSONA_2',
                application: 'WEB',
                device: 'DESKTOP',
                os: 'WINDOWS'
            },
            filter: { channel: channel.toLowerCase() },
            offset: 0,
            limit: 50
        };

        const data = await this._graphql(GRAPHQL_IDS.PROGRAMS_BY_CHANNEL, variables);

        if (!data || !data.programs) {
            console.log(`[TF1] Pas de programmes pour ${channel}`);
            return [];
        }

        console.log(`[TF1] ${data.programs.items?.length || 0} programmes pour ${channel}`);
        return data.programs.items || [];
    }

    /**
     * Récupère les vidéos d'un programme
     *
     * @param {string} programSlug - Slug du programme
     * @param {string} type - Type de vidéo (REPLAY, EXTRACT, BONUS)
     * @returns {Promise<Array>} Liste des vidéos
     */
    async getVideosByProgram(programSlug, type = 'REPLAY') {
        console.log(`[TF1] Récupération vidéos ${programSlug}...`);

        // Format exact comme le plugin Kodi
        const variablesStr = `{"programSlug":"${programSlug}","offset":0,"limit":20,"sort":{"type":"DATE","order":"DESC"},"types":["${type}"]}`;

        const data = await this._graphql(GRAPHQL_IDS.VIDEOS_BY_PROGRAM, variablesStr);

        if (!data || !data.programBySlug || !data.programBySlug.videos) {
            return [];
        }

        return data.programBySlug.videos.items || [];
    }

    /**
     * Recherche des programmes
     *
     * @param {string} query - Terme de recherche
     * @returns {Promise<Array>} Liste des programmes trouvés
     */
    async search(query) {
        console.log(`[TF1] Recherche: ${query}`);

        const variables = {
            query: query,
            offset: 0,
            limit: 50
        };

        const data = await this._graphql(GRAPHQL_IDS.SEARCH_PROGRAMS, variables);

        if (!data || !data.searchPrograms) {
            return [];
        }

        return data.searchPrograms.items || [];
    }

    /**
     * Récupère les programmes populaires/récents de toutes les chaînes
     *
     * @returns {Promise<Array>} Liste des programmes avec leurs dernières vidéos
     */
    async getPopularPrograms() {
        return cached('popular_programs', async () => {
            console.log('[TF1] Récupération programmes populaires...');

            const allVideos = [];

            // Récupère les programmes de chaque chaîne
            for (const channel of CHANNEL_SLUGS) {
                try {
                    const programs = await this.getProgramsByChannel(channel);

                    // Pour chaque programme, récupère les dernières vidéos
                    for (const prog of programs.slice(0, 5)) { // Limite à 5 programmes par chaîne
                        try {
                            const videos = await this.getVideosByProgram(prog.slug);

                            for (const video of videos.slice(0, 2)) { // 2 vidéos max par programme
                                // L'ID du média est l'UUID
                                const mediaId = video.id;
                                // Vérifie si le contenu est accessible avec un compte gratuit (BASIC)
                                const rights = video.rights || [];
                                const isAccessible = rights.includes('BASIC');

                                if (mediaId && isAccessible) {
                                    const decoration = video.decoration || {};
                                    const playingInfos = video.playingInfos || {};

                                    // Extraction des images
                                    const images = decoration.images || [];
                                    let posterUrl = null;
                                    let backgroundUrl = null;

                                    // Cherche les images par type
                                    for (const img of images) {
                                        const sources = img.sources || [];
                                        const url = sources[0]?.url;
                                        if (!url) continue;

                                        if (img.type === 'THUMBNAIL' || img.type === 'PREVIEW') {
                                            posterUrl = posterUrl || url;
                                        }
                                        if (img.type === 'BACKGROUND' || img.type === 'PREVIEW') {
                                            backgroundUrl = backgroundUrl || url;
                                        }
                                    }

                                    // Fallback sur l'image du programme
                                    const progDecoration = prog.decoration || {};
                                    const progImage = progDecoration.image?.sources?.[0]?.url ||
                                                      progDecoration.thumbnail?.sources?.[0]?.url;
                                    const progBackground = progDecoration.background?.sources?.[0]?.url;

                                    allVideos.push({
                                        id: mediaId.toString(),
                                        title: decoration.label || video.slug || prog.name,
                                        programName: prog.name,
                                        programSlug: prog.slug,
                                        description: decoration.description || prog.description || '',
                                        image: posterUrl || progImage,
                                        background: backgroundUrl || progBackground || posterUrl || progImage,
                                        duration: playingInfos.duration,
                                        channel: channel.toUpperCase(),
                                        date: video.date
                                    });
                                }
                            }
                        } catch (error) {
                            console.error(`[TF1] Erreur vidéos ${prog.slug}:`, error.message);
                        }
                    }
                } catch (error) {
                    console.error(`[TF1] Erreur programmes ${channel}:`, error.message);
                }
            }

            // Trie par date (plus récent d'abord)
            allVideos.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            console.log(`[TF1] ${allVideos.length} vidéos récupérées`);
            return allVideos.slice(0, 50); // Limite à 50 vidéos
        });
    }
}

module.exports = TF1Client;
