/**
 * Client API RugbyPass TV (World Rugby)
 *
 * Utilise l'API DCE/IMG Arena (dce-frontoffice.imggaming.com)
 * pour récupérer le catalogue et les streams vidéo.
 * Nécessite un compte gratuit rugbypass.tv.
 *
 * @module lib/rugbypass
 */

const fetch = require('node-fetch');

/** URL de base de l'API DCE */
const API_URL = 'https://dce-frontoffice.imggaming.com/api';

/** Headers requis pour toutes les requêtes */
const API_HEADERS = {
    'x-api-key': '857a1e5d-e35e-4fdf-805b-a87b6f8364bf',
    'realm': 'dce.worldrugby',
    'x-app-var': '6.0.1.edcc12a',
    'Content-Type': 'application/json',
};

/** Algolia search config */
const ALGOLIA_URL = 'https://h99xldr8mj-dsn.algolia.net/1/indexes/prod-dce.worldrugby-livestreaming-events/query';
const ALGOLIA_APP_ID = 'H99XLDR8MJ';
const ALGOLIA_API_KEY = 'e55ccb3db0399eabe2bfc37a0314c346';

/** Cache en mémoire */
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function cached(key, fn) {
    const now = Date.now();
    const item = cache.get(key);
    if (item && now < item.expiry) {
        return item.value;
    }
    const value = await fn();
    if (value !== null && value !== undefined) {
        cache.set(key, { value, expiry: now + CACHE_TTL });
    }
    return value;
}

class RugbyPassClient {
    constructor(email, password) {
        this.email = email;
        this.password = password;
        this.authToken = null;
        this.refreshToken = null;
        this.tokenExpires = 0;
    }

    /**
     * Effectue une requête authentifiée vers l'API
     */
    async _fetch(path, options = {}) {
        await this._ensureAuth();

        const url = path.startsWith('http') ? path : `${API_URL}${path}`;
        const headers = {
            ...API_HEADERS,
            'Authorization': `Bearer ${this.authToken}`,
            ...options.headers,
        };

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        return response.json();
    }

    /**
     * S'assure que le token d'auth est valide
     */
    async _ensureAuth() {
        const now = Date.now() / 1000;

        if (this.authToken && now < this.tokenExpires) {
            return;
        }

        if (this.refreshToken) {
            try {
                await this._refreshAuth();
                return;
            } catch (e) {
                console.log('[RugbyPass] Refresh token échoué, re-login...');
            }
        }

        await this._login();
    }

    /**
     * Login avec email/password
     */
    async _login() {
        if (!this.email || !this.password) {
            throw new Error('RugbyPass: identifiants non configurés');
        }

        console.log('[RugbyPass] Login...');
        const response = await fetch(`${API_URL}/v2/login`, {
            method: 'POST',
            headers: API_HEADERS,
            body: JSON.stringify({ id: this.email, secret: this.password }),
        });

        const data = await response.json();
        if (!data.authorisationToken) {
            throw new Error(`RugbyPass login échoué: ${data.messages?.join(', ') || 'erreur inconnue'}`);
        }

        this._parseAuth(data);
        console.log('[RugbyPass] Login réussi');
    }

    /**
     * Refresh du token
     */
    async _refreshAuth() {
        console.log('[RugbyPass] Refresh token...');
        const response = await fetch(`${API_URL}/v2/token/refresh`, {
            method: 'POST',
            headers: API_HEADERS,
            body: JSON.stringify({ refreshToken: this.refreshToken }),
        });

        const data = await response.json();
        if (!data.authorisationToken) {
            throw new Error('Refresh échoué');
        }

        this._parseAuth(data);
    }

    /**
     * Parse la réponse d'auth et stocke les tokens
     */
    _parseAuth(data) {
        this.authToken = data.authorisationToken;
        if (data.refreshToken) {
            this.refreshToken = data.refreshToken;
        }

        // Decode JWT pour obtenir l'expiration
        try {
            const payload = JSON.parse(Buffer.from(this.authToken.split('.')[1], 'base64').toString());
            this.tokenExpires = payload.exp - 30; // 30s de marge
        } catch {
            this.tokenExpires = (Date.now() / 1000) + 3500; // fallback ~1h
        }
    }

    /**
     * Récupère les événements live
     * @returns {Promise<Array>} Liste des événements live
     */
    async getLiveEvents() {
        return cached('live_events', async () => {
            console.log('[RugbyPass] Récupération événements live...');
            const data = await this._fetch('/v2/event/live?rpp=15');
            return data.events || [];
        });
    }

    /**
     * Récupère le contenu d'une page (home, browse)
     * @param {string} pageId - ID de la page (home, browse)
     * @returns {Promise<Object>} Données de la page avec buckets
     */
    async getPage(pageId) {
        return cached(`page_${pageId}`, async () => {
            console.log(`[RugbyPass] Récupération page ${pageId}...`);
            const params = new URLSearchParams({
                bpp: 10,
                rpp: 1,
                bspp: 1,
                displaySectionLinkBuckets: 'SHOW',
                displayEpgBuckets: 'HIDE',
                displayEmptyBucketShortcuts: 'SHOW',
                displayContentAvailableOnSignIn: 'SHOW',
                displayGeoblocked: 'SHOW',
            });

            const data = await this._fetchAllPages(`/v4/content/${pageId}?${params}`);
            return data;
        });
    }

    /**
     * Gère la pagination récursive des pages
     */
    async _fetchAllPages(url, lastSeen = null) {
        const separator = url.includes('?') ? '&' : '?';
        const fullUrl = lastSeen ? `${url}${separator}lastSeen=${lastSeen}` : url;
        const data = await this._fetch(fullUrl);

        if (data.paging?.moreDataAvailable && data.paging?.lastSeen) {
            const nextData = await this._fetchAllPages(url, data.paging.lastSeen);
            data.buckets = [...(data.buckets || []), ...(nextData.buckets || [])];
        }

        return data;
    }

    /**
     * Récupère le contenu d'un bucket (sous-section)
     * @param {string} contentId - ID du contenu parent
     * @param {string} bucketId - ID du bucket
     * @returns {Promise<Array>} Contenu du bucket
     */
    /**
     * Récupère le contenu d'un bucket avec chargement progressif.
     * Le cache s'étend au fur et à mesure des demandes.
     * @param {string} contentId - ID du contenu parent
     * @param {string} bucketId - ID du bucket
     * @param {number} needAtLeast - Nombre minimum d'items nécessaires (0 = tout charger)
     * @returns {Promise<Array>} Contenu du bucket (peut être partiel si needAtLeast > 0)
     */
    async getBucket(contentId, bucketId, needAtLeast = 0) {
        const stateKey = `_bucket_state_${contentId}_${bucketId}`;

        // Initialise l'état de pagination si nécessaire
        if (!this[stateKey]) {
            this[stateKey] = { items: [], lastSeen: null, complete: false };
        }

        const state = this[stateKey];

        // Si on a déjà assez d'items ou que le bucket est complet, retourne
        if (state.complete || (needAtLeast > 0 && state.items.length >= needAtLeast)) {
            return state.items;
        }

        console.log(`[RugbyPass] Chargement bucket ${bucketId} (déjà ${state.items.length}, besoin ${needAtLeast || 'tout'})...`);

        while (!state.complete && (needAtLeast === 0 || state.items.length < needAtLeast)) {
            const params = new URLSearchParams({
                rpp: 25,
                displayContentAvailableOnSignIn: 'SHOW',
                displayGeoblocked: 'SHOW',
            });
            if (state.lastSeen) params.set('lastSeen', state.lastSeen);

            const data = await this._fetch(`/v4/content/${contentId}/bucket/${bucketId}?${params}`);
            state.items.push(...(data.contentList || []));

            if (data.paging?.moreDataAvailable && data.paging?.lastSeen) {
                state.lastSeen = data.paging.lastSeen;
            } else {
                state.complete = true;
            }
        }

        console.log(`[RugbyPass] Bucket ${bucketId}: ${state.items.length} items (complet: ${state.complete})`);
        return state.items;
    }

    /**
     * Récupère une playlist VOD
     * @param {string} playlistId - ID de la playlist
     * @returns {Promise<Object>} Playlist avec vidéos
     */
    async getPlaylist(playlistId) {
        return cached(`playlist_${playlistId}`, async () => {
            console.log(`[RugbyPass] Récupération playlist ${playlistId}...`);
            const allVods = [];
            let page = 1;
            let totalPages = 1;
            let title = null;
            let coverUrl = null;

            while (page <= totalPages) {
                const data = await this._fetch(`/v2/vod/playlist/${playlistId}?rpp=25&p=${page}&displayGeoblocked=SHOW`);
                if (page === 1) {
                    title = data.title || null;
                    coverUrl = data.coverUrl || data.smallCoverUrl || null;
                }
                allVods.push(...(data.videos?.vods || []));
                totalPages = data.videos?.totalPages || 1;
                page++;
            }

            return { title, coverUrl, vods: allVods };
        });
    }

    /**
     * Recherche des vidéos via Algolia
     * @param {string} query - Terme de recherche
     * @returns {Promise<Array>} Résultats
     */
    async search(query) {
        return cached(`search_${query}`, async () => {
            console.log(`[RugbyPass] Recherche "${query}"...`);
            const url = `${ALGOLIA_URL}?x-algolia-agent=${encodeURIComponent('Algolia for JavaScript (3.35.1); React Native')}&x-algolia-application-id=${ALGOLIA_APP_ID}&x-algolia-api-key=${ALGOLIA_API_KEY}`;

            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    params: `query=${encodeURIComponent(query)}&hitsPerPage=20&page=0&filters=type%3AVOD_VIDEO&facets=%5B%5D`,
                }),
            });

            const data = await resp.json();
            return data.hits || [];
        });
    }

    /**
     * Récupère l'URL de stream pour un événement live
     * @param {string} eventId - ID de l'événement
     * @returns {Promise<Object>} Données de playback
     */
    async getEventStream(eventId) {
        console.log(`[RugbyPass] Récupération stream événement ${eventId}...`);
        // Force refresh du token pour le playback
        if (this.refreshToken) {
            try { await this._refreshAuth(); } catch {}
        }

        const eventData = await this._fetch(`/v2/event/${eventId}`);
        const streamData = await this._fetch(`/v2/stream/event/${eventId}`);
        const playbackData = await this._fetch(streamData.playerUrlCallback);

        return {
            playback: playbackData,
            event: eventData,
            ...this._extractStream(playbackData),
        };
    }

    /**
     * Récupère l'URL de stream pour une VOD
     * @param {string} vodId - ID de la VOD
     * @returns {Promise<Object>} Données de playback
     */
    async getVodStream(vodId) {
        console.log(`[RugbyPass] Récupération stream VOD ${vodId}...`);
        // Force refresh du token pour le playback
        if (this.refreshToken) {
            try { await this._refreshAuth(); } catch {}
        }

        const vodData = await this._fetch(`/v2/vod/${vodId}`);
        const streamData = await this._fetch(`/v3/stream/vod/${vodId}`);
        const playbackData = await this._fetch(streamData.playerUrlCallback);

        return {
            playback: playbackData,
            vod: vodData,
            ...this._extractStream(playbackData),
        };
    }

    /**
     * Extrait le meilleur stream des données de playback
     * Préfère HLS sans DRM > HLS avec DRM > DASH
     */
    _extractStream(playbackData) {
        const streams = [];

        for (const type of ['hls', 'dash']) {
            let items = playbackData[type];
            if (!items) continue;
            if (!Array.isArray(items)) items = [items];
            for (const item of items) {
                streams.push({ ...item, type });
            }
        }

        // Trie : HLS sans DRM > HLS avec DRM > DASH
        streams.sort((a, b) => {
            const aScore = (a.type === 'hls' && !a.drm ? 3 : 0) + (a.type === 'hls' ? 1 : 0) + (a.type === 'dash' ? 0 : 0);
            const bScore = (b.type === 'hls' && !b.drm ? 3 : 0) + (b.type === 'hls' ? 1 : 0) + (b.type === 'dash' ? 0 : 0);
            return bScore - aScore;
        });

        if (streams.length === 0) {
            return { streamUrl: null, hasDrm: false };
        }

        const best = streams[0];

        // Récupère les sous-titres (dédupliqués par langue+format)
        const subsMap = new Map();
        for (const s of streams) {
            for (const sub of (s.subtitles || [])) {
                if (sub.url && sub.language) {
                    const key = `${sub.language}:${sub.format}`;
                    if (!subsMap.has(key)) {
                        subsMap.set(key, { url: sub.url, lang: sub.language, format: sub.format });
                    }
                }
            }
        }
        const subtitles = [...subsMap.values()];

        return {
            streamUrl: best.url,
            hasDrm: !!best.drm,
            streamType: best.type,
            drm: best.drm || null,
            subtitles,
        };
    }

    /**
     * Récupère le catalogue complet pour l'addon Stremio
     * Parcourt les buckets de la page home pour récupérer tout le contenu
     * @returns {Promise<Array>} Liste de contenus formatés (dédupliqués)
     */
    /**
     * Récupère la structure des buckets de la page home (cache les exid)
     * @returns {Promise<Array>} Liste des buckets avec name et exid
     */
    async getHomeBuckets() {
        return cached('home_buckets', async () => {
            console.log('[RugbyPass] Découverte des catégories...');
            const home = await this.getPage('home');
            const skipTypes = ['VOD_RESUME', 'UPCOMING', 'VOD_RECOMMENDATIONS', 'EPG_NOW_NEXT', 'SECTION_LINK'];
            const buckets = [];
            for (const b of (home.buckets || [])) {
                if (!b.exid || skipTypes.includes(b.type)) continue;
                buckets.push({
                    name: b.name || b.title || '?',
                    exid: b.exid,
                    type: b.type,
                });
            }
            console.log(`[RugbyPass] ${buckets.length} catégories trouvées`);
            return buckets;
        });
    }

    /**
     * Récupère le contenu d'un genre (= bucket) avec chargement progressif
     * @param {string} genre - Nom du genre (= nom du bucket) ou null/Tous pour "Latest"
     * @param {number} skip - Nombre d'items à sauter
     * @param {number} limit - Nombre d'items à retourner
     * @returns {Promise<Array>} Liste de contenus formatés
     */
    /**
     * Construit un index vodId → playlist pour regrouper les VOD en playlists
     * @returns {Promise<Map>} vodId → { playlistId, title, poster }
     */
    async _getVodToPlaylistIndex() {
        return cached('vod_to_playlist_index', async () => {
            console.log('[RugbyPass] Construction index VOD→playlist...');
            const buckets = await this.getHomeBuckets();
            const seriesBucket = buckets.find(b => b.name === 'Series');
            if (!seriesBucket) return new Map();

            const seriesContent = await this.getBucket('home', seriesBucket.exid, 500);
            const index = new Map();

            for (const item of seriesContent) {
                if (item.type !== 'PLAYLIST') continue;
                try {
                    const playlist = await this.getPlaylist(item.id);
                    for (const vod of playlist.vods) {
                        index.set(String(vod.id), {
                            playlistId: String(item.id),
                            title: playlist.title || item.title,
                            poster: item.coverUrl || item.smallCoverUrl || playlist.coverUrl || vod.thumbnailUrl,
                        });
                    }
                } catch(e) {
                    // skip
                }
            }
            console.log(`[RugbyPass] Index: ${index.size} VOD rattachées à des playlists`);
            return index;
        });
    }

    async getCatalogByGenre(genre, skip = 0, limit = 50) {
        // Sections (pays) : genre commence par 🏴
        if (genre && genre.startsWith('🏴 ')) {
            const sectionTitle = genre.replace('🏴 ', '').toUpperCase();
            const sections = await this.getSections();
            const section = sections.find(s => s.title.toUpperCase() === sectionTitle);
            if (!section) {
                console.log(`[RugbyPass] Section "${sectionTitle}" non trouvée`);
                return [];
            }
            return this.getSectionContent(section.sectionName, skip, limit);
        }

        const buckets = await this.getHomeBuckets();

        let targetBucket;
        if (!genre || genre === 'Tous') {
            targetBucket = buckets.find(b => b.name === 'Latest');
            if (!targetBucket) targetBucket = buckets[buckets.length - 1];
        } else {
            // Remap "-" → "&" pour les noms de buckets (Stremio ne gère pas le & dans les genres)
            const genreLookup = genre.replace(' - ', ' & ');
            targetBucket = buckets.find(b => b.name === genreLookup);
            if (!targetBucket) {
                console.log(`[RugbyPass] Genre "${genre}" non trouvé`);
                return [];
            }
        }

        // Charge assez d'items pour couvrir skip + limit (avec marge)
        const needAtLeast = skip + limit + 10;
        const content = await this.getBucket('home', targetBucket.exid, needAtLeast);

        // Construit l'index VOD→playlist pour regrouper
        const vodIndex = (targetBucket.name !== 'Series') ? await this._getVodToPlaylistIndex() : new Map();

        // Formate, déduplique et regroupe les VOD en playlists
        const items = [];
        const seen = new Set();
        for (const item of content) {
            const formatted = this._formatItem(item);

            // Si la VOD appartient à une playlist connue, remplacer par la playlist
            if (formatted.type === 'vod' && vodIndex.has(formatted.id)) {
                const pl = vodIndex.get(formatted.id);
                const plKey = `playlist:${pl.playlistId}`;
                if (!seen.has(plKey)) {
                    seen.add(plKey);
                    items.push({
                        id: pl.playlistId,
                        type: 'playlist',
                        title: pl.title,
                        poster: pl.poster,
                        thumbnail: pl.poster,
                    });
                }
                continue;
            }

            if (!seen.has(formatted.id)) {
                seen.add(formatted.id);
                items.push(formatted);
            }
        }

        console.log(`[RugbyPass] Genre "${targetBucket.name}": ${items.length} items chargés, retour ${skip}-${skip + limit}`);
        return items.slice(skip, skip + limit);
    }

    /**
     * Retourne la liste des genres disponibles (noms de buckets)
     * @returns {Promise<Array<string>>} Liste des noms de genres
     */
    async getGenres() {
        const buckets = await this.getHomeBuckets();
        const sections = await this.getSections();
        return ['Tous', ...buckets.map(b => b.name), ...sections.map(s => `🏴 ${s.title}`)];
    }

    /**
     * Découvre les sections (pays) depuis la page browse
     * @returns {Promise<Array>} Liste des sections {title, sectionName}
     */
    async getSections() {
        return cached('sections', async () => {
            const browse = await this._fetch('/v4/content/browse?displayGeoblocked=SHOW');
            const navBucket = (browse.buckets || []).find(b => b.type === 'SECTION_LINK');
            if (!navBucket) return [];
            const data = await this._fetch(`/v4/content/browse/bucket/${navBucket.exid}?rpp=25&displayGeoblocked=SHOW`);
            return (data.contentList || []).map(item => ({
                title: item.title || item.sectionName,
                sectionName: item.sectionName || item.title,
            }));
        });
    }

    /**
     * Récupère le contenu d'une section (pays) avec tous ses buckets
     * @param {string} sectionName - Nom de la section (ex: "FRANCE")
     * @param {number} skip
     * @param {number} limit
     * @returns {Promise<Array>} Liste de contenus formatés
     */
    async getSectionContent(sectionName, skip = 0, limit = 50) {
        const cacheKey = `section_content_${sectionName}`;
        const allItems = await cached(cacheKey, async () => {
            console.log(`[RugbyPass] Chargement section "${sectionName}"...`);
            const page = await this._fetch(`/v4/content/${sectionName}?displayGeoblocked=SHOW`);
            const items = [];
            for (const b of (page.buckets || [])) {
                if (b.type === 'SECTION_LINK') continue;
                const bgUrl = b.rowTypeData?.background?.imageUrl || null;
                items.push({
                    id: `sb:${sectionName}:${b.exid}`,
                    type: 'section_bucket',
                    title: b.name || b.title || '?',
                    sectionName,
                    exid: b.exid,
                    thumbnail: bgUrl,
                    poster: bgUrl,
                });
            }
            console.log(`[RugbyPass] Section "${sectionName}": ${items.length} playlists`);
            return items;
        });
        return allItems.slice(skip, skip + limit);
    }

    /**
     * Récupère les VOD d'un bucket de section (pour les épisodes)
     * @param {string} sectionName - Nom de la section
     * @param {string} bucketExid - Exid du bucket
     * @returns {Promise<Object>} { title, vods }
     */
    async getSectionBucketContent(sectionName, bucketExid) {
        return cached(`sb_${sectionName}_${bucketExid}`, async () => {
            console.log(`[RugbyPass] Chargement bucket section ${sectionName}/${bucketExid}...`);
            const allVods = [];
            let lastSeen = null;
            let moreData = true;
            let title = null;
            while (moreData) {
                let url = `/v4/content/${sectionName}/bucket/${bucketExid}?rpp=25&displayGeoblocked=SHOW`;
                if (lastSeen) url += `&lastSeen=${lastSeen}`;
                const data = await this._fetch(url);
                if (!title) title = data.name || data.title || sectionName;
                allVods.push(...(data.contentList || []));
                moreData = data.paging?.moreDataAvailable || false;
                lastSeen = data.paging?.lastSeen || null;
            }
            console.log(`[RugbyPass] Bucket section: ${allVods.length} vidéos`);
            return { title, vods: allVods };
        });
    }

    /**
     * Formate un item de l'API en format interne
     */
    _formatItem(item) {
        if (item.type === 'VOD' || item.type === 'VOD_VIDEO') {
            return {
                id: String(item.id),
                type: 'vod',
                title: item.title || item.name,
                description: item.description || '',
                duration: item.duration || 0,
                thumbnail: item.thumbnailUrl || null,
                poster: item.smallCoverUrl || item.thumbnailUrl || null,
            };
        } else if (item.type === 'LIVE') {
            return {
                id: String(item.id),
                type: 'live',
                title: item.title,
                description: item.description || '',
                thumbnail: item.thumbnailUrl || null,
                live: item.live || false,
                startDate: item.startDate || null,
            };
        } else if (item.type === 'PLAYLIST') {
            return {
                id: String(item.id),
                type: 'playlist',
                title: item.title,
                thumbnail: item.smallCoverUrl ? item.smallCoverUrl.replace('/original/', '/346x380/') : null,
                poster: item.coverUrl ? item.coverUrl.replace('/original/', '/1920x1080/') : null,
            };
        }

        return {
            id: String(item.id || item.exid || ''),
            type: item.type?.toLowerCase() || 'unknown',
            title: item.title || item.name || '',
            thumbnail: item.thumbnailUrl || null,
        };
    }

    /**
     * Teste la connexion
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this._ensureAuth();
            const events = await this.getLiveEvents();
            console.log(`[RugbyPass] Connexion OK, ${events.length} événements live`);
            return true;
        } catch (error) {
            console.error('[RugbyPass] Erreur connexion:', error.message);
            return false;
        }
    }
}

module.exports = RugbyPassClient;
