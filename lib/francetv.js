/**
 * Client API France.tv
 *
 * Gère les interactions avec l'API France.tv pour récupérer
 * le catalogue et les streams vidéo.
 *
 * @module lib/francetv
 */

const fetch = require('node-fetch');

/** URL de base pour l'API Mobile */
const API_MOBILE_URL = 'https://api-mobile.yatta.francetv.fr';

/** URL de base pour l'API Vidéo */
const API_VIDEO_URL = 'https://k7.ftven.fr/videos';

/** URL pour le token Akamai */
const TOKEN_URL = 'https://hdfauth.ftven.fr/esi/TA';

/** Cache en mémoire */
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
        console.log(`[FranceTV] Cache hit: ${key}`);
        return item.value;
    }

    console.log(`[FranceTV] Cache miss: ${key}`);
    const value = await fn();
    cache.set(key, { value, expiry: now + CACHE_TTL });
    return value;
}

/**
 * Liste des chaînes France Télévisions
 */
const CHANNELS = [
    { id: 'france-2', name: 'France 2', logo: 'france2.png' },
    { id: 'france-3', name: 'France 3', logo: 'france3.png' },
    { id: 'france-4', name: 'France 4', logo: 'france4.png' },
    { id: 'france-5', name: 'France 5', logo: 'france5.png' },
    { id: 'franceinfo', name: 'franceinfo', logo: 'franceinfo.png' },
    { id: 'slash', name: 'France tv Slash', logo: 'slash.png' }
];

/**
 * Classe client pour l'API France.tv
 */
class FranceTVClient {
    constructor() {
        this.channels = CHANNELS;
    }

    /**
     * Effectue une requête HTTP
     *
     * @param {string} url - URL à appeler
     * @returns {Promise<Object>} Réponse JSON
     * @private
     */
    async _fetch(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`[FranceTV] Erreur requête ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Récupère le contenu d'une chaîne
     *
     * @param {string} channelId - ID de la chaîne (ex: france-2)
     * @returns {Promise<Array>} Liste des vidéos
     */
    async getChannelContent(channelId) {
        return cached(`channel_${channelId}`, async () => {
            console.log(`[FranceTV] Récupération contenu ${channelId}...`);

            const data = await this._fetch(
                `${API_MOBILE_URL}/apps/channels/${channelId}?platform=apps`
            );

            const videos = [];

            // Parcourt les collections
            if (data.collections) {
                for (const collection of data.collections) {
                    if (collection.items) {
                        for (const item of collection.items) {
                            const video = this._formatVideo(item);
                            if (video) {
                                videos.push(video);
                            }
                        }
                    }
                }
            }

            // Déduplique
            const unique = [];
            const seen = new Set();
            for (const video of videos) {
                if (!seen.has(video.id)) {
                    seen.add(video.id);
                    unique.push(video);
                }
            }

            console.log(`[FranceTV] ${unique.length} vidéos trouvées pour ${channelId}`);
            return unique;
        });
    }

    /**
     * Récupère tous les programmes d'une chaîne
     *
     * @param {string} channelId - ID de la chaîne
     * @returns {Promise<Array>} Liste des programmes
     */
    async getChannelPrograms(channelId) {
        return cached(`programs_${channelId}`, async () => {
            console.log(`[FranceTV] Récupération programmes ${channelId}...`);

            const data = await this._fetch(
                `${API_MOBILE_URL}/apps/regions/${channelId}/programs?platform=apps`
            );

            const programs = [];

            if (data.items) {
                for (const item of data.items) {
                    const program = this._formatProgram(item);
                    if (program) {
                        programs.push(program);
                    }
                }
            }

            console.log(`[FranceTV] ${programs.length} programmes trouvés pour ${channelId}`);
            return programs;
        });
    }

    /**
     * Récupère les infos d'une vidéo et son stream
     *
     * @param {string} videoId - ID de la vidéo (si_id)
     * @returns {Promise<Object|null>} Infos vidéo avec stream URL
     */
    async getVideoInfo(videoId) {
        console.log(`[FranceTV] Récupération vidéo ${videoId}...`);

        try {
            const data = await this._fetch(
                `${API_VIDEO_URL}/${videoId}?country_code=FR&domain=www.france.tv&os=android&browser=firefox`
            );

            if (!data.video) {
                console.log(`[FranceTV] Pas de vidéo pour ${videoId}`);
                return null;
            }

            const video = data.video;
            const meta = data.meta || {};

            // Vérifie si DRM
            if (video.drm === true) {
                console.log(`[FranceTV] Vidéo ${videoId} protégée par DRM`);
                return {
                    id: videoId,
                    title: meta.title,
                    description: meta.description,
                    duration: video.duration,
                    image: meta.image_url,
                    drm: true,
                    streamUrl: null
                };
            }

            // Récupère le token pour l'URL
            let streamUrl = video.url;
            if (video.token && video.token.akamai) {
                try {
                    const tokenResponse = await this._fetch(
                        `${video.token.akamai}&url=${encodeURIComponent(video.url)}`
                    );
                    if (tokenResponse.url) {
                        streamUrl = tokenResponse.url;
                    }
                } catch (err) {
                    console.error(`[FranceTV] Erreur token:`, err.message);
                }
            }

            return {
                id: videoId,
                title: meta.title,
                description: meta.description,
                duration: video.duration,
                image: meta.image_url,
                drm: false,
                format: video.format,
                streamUrl: streamUrl
            };

        } catch (error) {
            console.error(`[FranceTV] Erreur vidéo ${videoId}:`, error.message);
            return null;
        }
    }

    /**
     * Recherche des vidéos
     *
     * @param {string} query - Terme de recherche
     * @returns {Promise<Array>} Liste des vidéos
     */
    async search(query) {
        return cached(`search_${query}`, async () => {
            console.log(`[FranceTV] Recherche: ${query}...`);

            const data = await this._fetch(
                `${API_MOBILE_URL}/apps/search?term=${encodeURIComponent(query)}&platform=apps`
            );

            const videos = [];

            if (data.collections) {
                for (const collection of data.collections) {
                    if (collection.label === 'Vidéos' && collection.items) {
                        for (const item of collection.items) {
                            const video = this._formatVideo(item);
                            if (video) {
                                videos.push(video);
                            }
                        }
                    }
                }
            }

            console.log(`[FranceTV] ${videos.length} résultats pour "${query}"`);
            return videos;
        });
    }

    /**
     * Récupère le contenu rugby depuis le programme dédié
     *
     * @returns {Promise<Array>} Liste des vidéos rugby
     */
    async getRugbyContent() {
        return cached('rugby', async () => {
            console.log(`[FranceTV] Récupération contenu rugby...`);

            const data = await this._fetch(
                `${API_MOBILE_URL}/apps/program/sport_rugby?platform=apps`
            );

            const videos = [];

            if (data.collections) {
                for (const collection of data.collections) {
                    if (collection.items) {
                        for (const item of collection.items) {
                            const video = this._formatVideo(item);
                            if (video) {
                                videos.push(video);
                            }
                        }
                    }
                }
            }

            // Déduplique
            const unique = [];
            const seen = new Set();
            for (const video of videos) {
                if (!seen.has(video.id)) {
                    seen.add(video.id);
                    unique.push(video);
                }
            }

            console.log(`[FranceTV] ${unique.length} vidéos rugby trouvées`);
            return unique;
        });
    }

    /**
     * Récupère les informations d'un programme (série) avec tous ses épisodes
     *
     * @param {string} programPath - Chemin du programme (ex: france-2_il-etait-deux-fois)
     * @returns {Promise<Object|null>} Infos du programme avec épisodes
     */
    async getProgramInfo(programPath) {
        return cached(`program_${programPath}`, async () => {
            console.log(`[FranceTV] Récupération programme ${programPath}...`);

            try {
                const data = await this._fetch(
                    `${API_MOBILE_URL}/apps/program/${programPath}?platform=apps`
                );

                if (!data || !data.item) {
                    console.log(`[FranceTV] Programme non trouvé: ${programPath}`);
                    return null;
                }

                const item = data.item;

                // Récupère l'image du programme
                let image = null;
                let poster = null;
                let background = null;
                if (item.images) {
                    for (const img of item.images) {
                        if (img.type === 'vignette_16x9' && img.urls) {
                            image = img.urls['w:1024'] || img.urls['w:800'];
                            background = image;
                        }
                        if (img.type === 'vignette_3x4' && img.urls) {
                            poster = img.urls['w:800'] || img.urls['w:400'];
                        }
                    }
                }

                // Récupère les épisodes depuis les collections
                const episodes = [];
                if (data.collections) {
                    for (const collection of data.collections) {
                        // Cherche la collection des épisodes
                        if (collection.type === 'playlist_video' && collection.items) {
                            for (const ep of collection.items) {
                                if (ep.si_id) {
                                    // Récupère l'image de l'épisode
                                    let epImage = null;
                                    if (ep.images) {
                                        for (const img of ep.images) {
                                            if (img.type === 'vignette_16x9' && img.urls) {
                                                epImage = img.urls['w:800'] || img.urls['w:400'];
                                                break;
                                            }
                                        }
                                    }

                                    episodes.push({
                                        id: ep.si_id,
                                        title: ep.title || ep.label,
                                        season: ep.season || 1,
                                        episode: ep.episode || episodes.length + 1,
                                        description: ep.description,
                                        duration: ep.duration,
                                        thumbnail: epImage || image
                                    });
                                }
                            }
                        }
                    }
                }

                console.log(`[FranceTV] Programme ${programPath}: ${episodes.length} épisodes trouvés`);

                return {
                    id: programPath,
                    title: item.label || item.title,
                    description: item.description,
                    image: image,
                    poster: poster,
                    background: background,
                    type: 'series',
                    episodes: episodes
                };

            } catch (error) {
                console.error(`[FranceTV] Erreur programme ${programPath}:`, error.message);
                return null;
            }
        });
    }

    /**
     * Récupère le stream live d'une chaîne
     *
     * @param {string} channelId - ID de la chaîne
     * @returns {Promise<Object|null>} Infos du live
     */
    async getLiveStream(channelId) {
        console.log(`[FranceTV] Récupération live ${channelId}...`);

        try {
            const data = await this._fetch(
                `${API_MOBILE_URL}/apps/channels/${channelId}?platform=apps`
            );

            // Cherche la collection "live"
            if (data.collections) {
                for (const collection of data.collections) {
                    if (collection.type === 'live' && collection.items && collection.items[0]) {
                        const liveItem = collection.items[0];
                        if (liveItem.channel && liveItem.channel.si_id) {
                            const videoInfo = await this.getVideoInfo(liveItem.channel.si_id);
                            return videoInfo;
                        }
                    }
                }
            }

            return null;
        } catch (error) {
            console.error(`[FranceTV] Erreur live ${channelId}:`, error.message);
            return null;
        }
    }

    /**
     * Récupère tous les directs des chaînes France TV
     *
     * @returns {Promise<Array>} Liste des chaînes en direct
     */
    async getLiveChannels() {
        return cached('live_channels', async () => {
            console.log(`[FranceTV] Récupération des directs...`);

            const liveChannels = [];
            const channelsToCheck = ['france-2', 'france-3', 'france-4', 'france-5', 'franceinfo'];

            for (const channelId of channelsToCheck) {
                try {
                    const data = await this._fetch(
                        `${API_MOBILE_URL}/apps/channels/${channelId}?platform=apps`
                    );

                    if (data.collections) {
                        for (const collection of data.collections) {
                            if (collection.type === 'live' && collection.items && collection.items[0]) {
                                const liveItem = collection.items[0];
                                const channel = liveItem.channel;

                                if (channel && channel.si_id) {
                                    // Récupère l'image de la chaîne
                                    let image = null;
                                    if (data.item && data.item.images) {
                                        for (const img of data.item.images) {
                                            if (img.type === 'vignette_16x9' && img.urls) {
                                                image = img.urls['w:1024'] || img.urls['w:800'];
                                                break;
                                            }
                                        }
                                    }

                                    // Nom de la chaîne formaté
                                    const channelName = data.label || channelId.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase());

                                    liveChannels.push({
                                        id: `live:${channel.si_id}`,
                                        title: `${channelName} - Direct`,
                                        description: liveItem.title || `En direct sur ${channelName}`,
                                        image: image,
                                        channelId: channelId,
                                        liveId: channel.si_id,
                                        isLive: true
                                    });
                                }
                                break;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[FranceTV] Erreur live ${channelId}:`, error.message);
                }
            }

            console.log(`[FranceTV] ${liveChannels.length} directs trouvés`);
            return liveChannels;
        });
    }

    /**
     * Formate une vidéo ou un programme depuis l'API
     *
     * @param {Object} item - Item de l'API
     * @returns {Object|null} Vidéo/Programme formaté
     * @private
     */
    _formatVideo(item) {
        if (!item) return null;

        // Détecte si c'est un programme (série) ou une vidéo
        const isProgram = item.type === 'program' && item.program_path;

        // Pour les programmes, on utilise program_path, sinon si_id
        if (!isProgram && !item.si_id) return null;

        // Récupère les images
        let image = null;
        let poster = null;
        if (item.images) {
            for (const img of item.images) {
                if (img.type === 'vignette_16x9' && img.urls) {
                    image = img.urls['w:1024'] || img.urls['w:800'];
                }
                if (img.type === 'vignette_3x4' && img.urls) {
                    poster = img.urls['w:800'] || img.urls['w:400'];
                }
            }
        }

        return {
            id: isProgram ? `program:${item.program_path}` : item.si_id,
            title: item.title || item.label,
            description: item.description,
            duration: item.duration,
            image: image,
            poster: poster,
            channel: item.channel?.label,
            type: item.type,
            isProgram: isProgram,
            programPath: item.program_path
        };
    }

    /**
     * Formate un programme depuis l'API
     *
     * @param {Object} item - Item de l'API
     * @returns {Object|null} Programme formaté
     * @private
     */
    _formatProgram(item) {
        if (!item || !item.program_path) return null;

        let image = null;
        if (item.images) {
            for (const img of item.images) {
                if (img.type === 'vignette_3x4' && img.urls) {
                    image = img.urls['w:400'] || img.urls['w:800'];
                    break;
                }
            }
        }

        return {
            id: item.program_path,
            title: item.label || item.title,
            description: item.description,
            image: image
        };
    }
}

module.exports = FranceTVClient;
