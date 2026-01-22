/**
 * Client API Arte.tv
 *
 * Gère les interactions avec l'API Arte.tv pour récupérer
 * le catalogue et les streams vidéo.
 *
 * @module lib/arte
 */

const fetch = require('node-fetch');

/** URL de base pour l'API EMAC (catalogue) */
const EMAC_BASE_URL = 'https://www.arte.tv/api/rproxy/emac/v4';

/** URL de base pour l'API Player (streams) */
const PLAYER_BASE_URL = 'https://api.arte.tv/api/player/v2';

/** Langue par défaut */
const DEFAULT_LANG = 'fr';

/** Pays autorisé (pour contourner le géoblocage) */
const AUTHORIZED_COUNTRY = 'FR';

/** Cache en mémoire pour éviter les appels répétés */
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
        console.log(`[Arte] Cache hit: ${key}`);
        return item.value;
    }

    console.log(`[Arte] Cache miss: ${key}`);
    const value = await fn();
    cache.set(key, { value, expiry: now + CACHE_TTL });
    return value;
}

/**
 * Classe client pour l'API Arte.tv
 */
class ArteClient {
    constructor() {
        this.lang = DEFAULT_LANG;
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
                    'User-Agent': 'Stremio-Arte-Addon/1.0'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`[Arte] Erreur requête ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Récupère la page d'accueil avec les contenus mis en avant
     *
     * @returns {Promise<Array>} Liste des vidéos
     */
    async getHomepage() {
        return cached('homepage', async () => {
            console.log('[Arte] Récupération page d\'accueil...');

            const data = await this._fetch(
                `${EMAC_BASE_URL}/${this.lang}/web/pages/HOME/?authorizedCountry=${AUTHORIZED_COUNTRY}`
            );

            const videos = [];

            if (data.value && data.value.zones) {
                for (const zone of data.value.zones) {
                    if (zone.content && zone.content.data) {
                        for (const item of zone.content.data) {
                            // Accepte tout contenu avec un programId et une image
                            if (item.programId && item.mainImage) {
                                // Vérifie que le contenu a des streams disponibles
                                const hasStreams = item.availability?.hasVideoStreams !== false;
                                if (hasStreams) {
                                    videos.push(this._formatVideo(item));
                                }
                            }
                        }
                    }
                }
            }

            // Déduplique par programId
            const unique = [];
            const seen = new Set();
            for (const video of videos) {
                if (!seen.has(video.programId)) {
                    seen.add(video.programId);
                    unique.push(video);
                }
            }

            console.log(`[Arte] ${unique.length} vidéos trouvées sur la page d'accueil`);
            return unique;
        });
    }

    /**
     * Récupère les vidéos d'une catégorie avec pagination à la demande
     *
     * @param {string} category - Code de la catégorie (ex: CIN, SER, DOC)
     * @param {number} page - Numéro de page (1-based)
     * @returns {Promise<Array>} Liste des vidéos
     */
    async getCategory(category, page = 1) {
        return cached(`category_${category}_p${page}`, async () => {
            console.log(`[Arte] Récupération catégorie ${category} page ${page}...`);

            const videos = [];

            if (page === 1) {
                // Première page : récupère depuis la page catégorie
                const data = await this._fetch(
                    `${EMAC_BASE_URL}/${this.lang}/web/pages/${category}/?authorizedCountry=${AUTHORIZED_COUNTRY}`
                );

                if (data.value && data.value.zones) {
                    // Trouve la zone principale avec pagination
                    for (const zone of data.value.zones) {
                        if (zone.content && zone.content.data) {
                            for (const item of zone.content.data) {
                                if (item.programId && item.mainImage) {
                                    const hasStreams = item.availability?.hasVideoStreams !== false;
                                    if (hasStreams) {
                                        videos.push(this._formatVideo(item));
                                    }
                                }
                            }
                            // Stocke le code de la zone principale pour les pages suivantes
                            if (zone.content.pagination && zone.content.pagination.pages > 1) {
                                this._categoryZones = this._categoryZones || {};
                                this._categoryZones[category] = zone.code;
                            }
                        }
                    }
                }
            } else {
                // Pages suivantes : utilise la zone principale
                const zoneCode = this._categoryZones?.[category];
                if (zoneCode) {
                    try {
                        const zoneData = await this._fetch(
                            `${EMAC_BASE_URL}/${this.lang}/web/zones/${zoneCode}/content?page=${page}&pageId=${category}&authorizedCountry=${AUTHORIZED_COUNTRY}`
                        );

                        if (zoneData.value && zoneData.value.data) {
                            for (const item of zoneData.value.data) {
                                if (item.programId && item.mainImage) {
                                    const hasStreams = item.availability?.hasVideoStreams !== false;
                                    if (hasStreams) {
                                        videos.push(this._formatVideo(item));
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[Arte] Erreur page ${page}:`, err.message);
                    }
                }
            }

            // Déduplique
            const unique = [];
            const seen = new Set();
            for (const video of videos) {
                if (!seen.has(video.programId)) {
                    seen.add(video.programId);
                    unique.push(video);
                }
            }

            console.log(`[Arte] ${unique.length} vidéos trouvées dans ${category} page ${page}`);
            return unique;
        });
    }

    /**
     * Récupère les vidéos d'une zone spécifique (sous-catégorie) avec pagination
     *
     * @param {string} zoneId - ID de la zone Arte
     * @param {string} pageId - ID de la page parente (ex: DOR pour documentaires)
     * @param {number} page - Numéro de page (1-based)
     * @returns {Promise<Array>} Liste des vidéos
     */
    async getZone(zoneId, pageId = 'DOR', page = 1) {
        return cached(`zone_${zoneId}_p${page}`, async () => {
            console.log(`[Arte] Récupération zone ${zoneId} page ${page}...`);
            const videos = [];

            try {
                const url = `${EMAC_BASE_URL}/${this.lang}/web/zones/${zoneId}/content?page=${page}&pageId=${pageId}&authorizedCountry=${AUTHORIZED_COUNTRY}`;
                const data = await this._fetch(url);

                if (data.value && data.value.data) {
                    for (const item of data.value.data) {
                        if (item.programId && item.mainImage) {
                            const hasStreams = item.availability?.hasVideoStreams !== false;
                            if (hasStreams) {
                                videos.push(this._formatVideo(item));
                            }
                        }
                    }
                }

                console.log(`[Arte] ${videos.length} vidéos trouvées dans zone ${zoneId} page ${page}`);
                return videos;
            } catch (error) {
                console.error(`[Arte] Erreur zone ${zoneId}:`, error.message);
                return [];
            }
        });
    }

    /**
     * Récupère les métadonnées d'une vidéo
     *
     * @param {string} programId - ID du programme (ex: 120387-000-A)
     * @returns {Promise<Object|null>} Métadonnées ou null
     */
    async getVideoMeta(programId) {
        return cached(`meta_${programId}`, async () => {
            console.log(`[Arte] Récupération meta pour ${programId}...`);

            try {
                const data = await this._fetch(
                    `${PLAYER_BASE_URL}/config/${this.lang}/${programId}`
                );

                if (!data.data || !data.data.attributes) {
                    return null;
                }

                const attrs = data.data.attributes;
                const meta = attrs.metadata;

                return {
                    programId,
                    title: meta.title,
                    subtitle: meta.subtitle,
                    description: meta.description,
                    duration: meta.duration?.seconds || 0,
                    images: meta.images || [],
                    rights: attrs.rights,
                    streams: attrs.streams || []
                };
            } catch (error) {
                console.error(`[Arte] Erreur meta ${programId}:`, error.message);
                return null;
            }
        });
    }

    /**
     * Récupère les épisodes d'une collection (série)
     *
     * @param {string} collectionId - ID de la collection (ex: RC-019724)
     * @returns {Promise<Array>} Liste des épisodes
     */
    async getCollectionEpisodes(collectionId) {
        return cached(`collection_${collectionId}`, async () => {
            console.log(`[Arte] Récupération épisodes pour ${collectionId}...`);

            try {
                const data = await this._fetch(
                    `${EMAC_BASE_URL}/${this.lang}/web/collections/${collectionId}/?authorizedCountry=${AUTHORIZED_COUNTRY}`
                );

                const episodes = [];

                if (data.value && data.value.zones) {
                    for (const zone of data.value.zones) {
                        if (zone.content && zone.content.data) {
                            for (const item of zone.content.data) {
                                if (item.programId && !item.programId.startsWith('RC-')) {
                                    const epImgUrl = item.mainImage?.url;
                                    let epImage = null;
                                    if (epImgUrl) {
                                        epImage = epImgUrl.includes('__SIZE__')
                                            ? epImgUrl.replace('__SIZE__', '400x225')
                                            : epImgUrl;
                                    }
                                    episodes.push({
                                        programId: item.programId,
                                        title: item.title,
                                        subtitle: item.subtitle,
                                        description: item.shortDescription || item.teaserText,
                                        duration: item.duration || 0,
                                        durationLabel: item.durationLabel,
                                        image: epImage,
                                        availability: item.availability
                                    });
                                }
                            }
                        }
                    }
                }

                console.log(`[Arte] ${episodes.length} épisode(s) trouvé(s) pour ${collectionId}`);
                return episodes;
            } catch (error) {
                console.error(`[Arte] Erreur collection ${collectionId}:`, error.message);
                return [];
            }
        });
    }

    /**
     * Récupère l'URL du stream HLS pour une vidéo
     *
     * @param {string} programId - ID du programme
     * @returns {Promise<string|null>} URL du stream HLS ou null
     */
    async getStreamUrl(programId) {
        console.log(`[Arte] Récupération stream pour ${programId}...`);

        try {
            const data = await this._fetch(
                `${PLAYER_BASE_URL}/config/${this.lang}/${programId}`
            );

            if (!data.data || !data.data.attributes || !data.data.attributes.streams) {
                console.log(`[Arte] Aucun stream trouvé pour ${programId}`);
                return null;
            }

            const streams = data.data.attributes.streams;

            // Cherche le stream HLS français en priorité
            for (const stream of streams) {
                if (stream.protocol === 'HLS') {
                    // Préfère la version française
                    const versions = stream.versions || [];
                    const frVersion = versions.find(v =>
                        v.code?.includes('FR') ||
                        v.label?.toLowerCase().includes('français') ||
                        v.shortLabel === 'VF'
                    );

                    if (frVersion || versions.length > 0) {
                        console.log(`[Arte] Stream HLS trouvé: ${stream.url}`);
                        return stream.url;
                    }
                }
            }

            // Fallback: premier stream disponible
            if (streams.length > 0 && streams[0].url) {
                console.log(`[Arte] Fallback stream: ${streams[0].url}`);
                return streams[0].url;
            }

            return null;
        } catch (error) {
            console.error(`[Arte] Erreur stream ${programId}:`, error.message);
            return null;
        }
    }

    /**
     * Récupère le stream live
     *
     * @returns {Promise<Object|null>} Infos du live
     */
    async getLiveStream() {
        return cached('live', async () => {
            console.log('[Arte] Récupération stream live...');

            try {
                const data = await this._fetch(
                    `${PLAYER_BASE_URL}/config/${this.lang}/LIVE`
                );

                if (!data.data || !data.data.attributes) {
                    return null;
                }

                const attrs = data.data.attributes;
                const meta = attrs.metadata;

                // Cherche le stream HLS français
                let streamUrl = null;
                for (const stream of attrs.streams || []) {
                    if (stream.protocol === 'HLS') {
                        const versions = stream.versions || [];
                        const frVersion = versions.find(v =>
                            v.code?.includes('FR') || v.label?.includes('Français')
                        );
                        if (frVersion) {
                            streamUrl = stream.url;
                            break;
                        }
                    }
                }

                // Fallback
                if (!streamUrl && attrs.streams && attrs.streams[0]) {
                    streamUrl = attrs.streams[0].url;
                }

                return {
                    title: meta.title,
                    subtitle: meta.subtitle,
                    description: meta.description,
                    streamUrl,
                    currentProgram: meta.link?.url
                };
            } catch (error) {
                console.error('[Arte] Erreur live:', error.message);
                return null;
            }
        });
    }

    /**
     * Formate une vidéo depuis l'API EMAC
     *
     * @param {Object} item - Item de l'API
     * @returns {Object} Vidéo formatée
     * @private
     */
    _formatVideo(item) {
        const imgUrl = item.mainImage?.url;
        let poster = null;
        let background = null;

        if (imgUrl) {
            // Nettoie l'URL de base (enlève les paramètres existants)
            const baseUrl = imgUrl.split('?')[0];
            if (baseUrl.includes('__SIZE__')) {
                poster = baseUrl.replace('__SIZE__', '500x750') + '?type=TEXT';
                background = baseUrl.replace('__SIZE__', '1920x1080');
            } else {
                poster = baseUrl;
                background = baseUrl;
            }
        }

        return {
            programId: item.programId,
            title: item.title,
            subtitle: item.subtitle,
            description: item.shortDescription || item.teaserText,
            duration: item.duration || 0,
            durationLabel: item.durationLabel,
            genre: item.genre?.label,
            genreCode: item.genre?.id,
            image: poster,
            imageLarge: background,
            availability: item.availability,
            url: item.url
        };
    }
}

module.exports = ArteClient;
