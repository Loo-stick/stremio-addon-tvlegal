/**
 * TV Legal - Addon Stremio pour la TV française légale
 *
 * Sources :
 * - France.tv (France 2, 3, 4, 5, franceinfo) - Direct + Replay
 * - Arte.tv - Direct + Replay
 * - TF1+ (TF1, TMC, TFX, LCI + FAST) - Direct uniquement (compte requis)
 *
 * @version 1.2.0
 * @license MIT
 */

require('dotenv').config();

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const path = require('path');
const FranceTVClient = require('./lib/francetv');
const ArteClient = require('./lib/arte');
const TF1Client = require('./lib/tf1');
const TMDBClient = require('./lib/tmdb');
const RugbyPassClient = require('./lib/rugbypass');

const PORT = process.env.PORT || 7001;

// Clients par défaut (utilisent les variables d'environnement)
const francetv = new FranceTVClient();
const arte = new ArteClient();
const tf1Default = new TF1Client();
const tmdbDefault = process.env.TMDB_API_KEY ? new TMDBClient(process.env.TMDB_API_KEY) : null;
const rugbypassDefault = (process.env.RUGBYPASS_EMAIL && process.env.RUGBYPASS_PASSWORD)
    ? new RugbyPassClient(process.env.RUGBYPASS_EMAIL, process.env.RUGBYPASS_PASSWORD)
    : null;

// Cache des clients TF1/TMDB/RugbyPass par config
const tf1Clients = new Map();
const tmdbClients = new Map();
const rugbypassClients = new Map();

/**
 * Parse la configuration depuis l'URL encodée en base64
 */
function parseConfig(encodedConfig) {
    try {
        const json = Buffer.from(encodedConfig, 'base64').toString('utf-8');
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

/**
 * Récupère ou crée un client TF1 pour une config
 */
function getTF1Client(config) {
    if (!config?.tf1Email || !config?.tf1Password) {
        return tf1Default;
    }
    const key = `${config.tf1Email}:${config.tf1Password}`;
    if (!tf1Clients.has(key)) {
        tf1Clients.set(key, new TF1Client(config.tf1Email, config.tf1Password));
    }
    return tf1Clients.get(key);
}

/**
 * Récupère ou crée un client TMDB pour une config
 */
/**
 * Récupère ou crée un client RugbyPass pour une config
 */
function getRugbyPassClient(config) {
    if (!config?.rugbypassEmail || !config?.rugbypassPassword) {
        return rugbypassDefault;
    }
    const key = `${config.rugbypassEmail}:${config.rugbypassPassword}`;
    if (!rugbypassClients.has(key)) {
        rugbypassClients.set(key, new RugbyPassClient(config.rugbypassEmail, config.rugbypassPassword));
    }
    return rugbypassClients.get(key);
}

function getTMDBClient(config) {
    if (!config?.tmdbKey) {
        return tmdbDefault;
    }
    if (!tmdbClients.has(config.tmdbKey)) {
        tmdbClients.set(config.tmdbKey, new TMDBClient(config.tmdbKey));
    }
    return tmdbClients.get(config.tmdbKey);
}

if (tmdbDefault) {
    console.log('[TV Legal] TMDB configuré (genres disponibles)');
} else {
    console.log('[TV Legal] TMDB non configuré (pas de filtrage par genre)');
}

// Préfixes d'ID
const ID_PREFIX = {
    FRANCETV_LIVE: 'tvlegal:ftv:live:',
    FRANCETV_VIDEO: 'tvlegal:ftv:video:',
    FRANCETV_PROGRAM: 'tvlegal:ftv:program:',
    ARTE_LIVE: 'tvlegal:arte:live',
    ARTE_VIDEO: 'tvlegal:arte:video:',
    TF1_LIVE: 'tvlegal:tf1:live:',
    RUGBYPASS_LIVE: 'tvlegal:rugbypass:live:',
    RUGBYPASS_VOD: 'tvlegal:rugbypass:vod:',
    RUGBYPASS_PLAYLIST: 'tvlegal:rugbypass:playlist:',
    RUGBYPASS_SECTION_BUCKET: 'tvlegal:rugbypass:sb:'
};

/**
 * Génère le lien vers la source originale
 * @param {string} id - ID du contenu
 * @returns {Array} Array de liens pour Stremio
 */
function getShareLinks(id) {
    // Arte video
    if (id.startsWith(ID_PREFIX.ARTE_VIDEO)) {
        const programId = id.replace(ID_PREFIX.ARTE_VIDEO, '');
        return [
            { name: 'Voir sur Arte', category: 'share', url: `https://www.arte.tv/fr/videos/${programId}/` }
        ];
    }
    // France.tv video
    if (id.startsWith(ID_PREFIX.FRANCETV_VIDEO)) {
        const videoId = id.replace(ID_PREFIX.FRANCETV_VIDEO, '');
        return [
            { name: 'Voir sur France.tv', category: 'share', url: `https://www.france.tv/redirect/video/${videoId}` }
        ];
    }
    // France.tv program (série)
    if (id.startsWith(ID_PREFIX.FRANCETV_PROGRAM)) {
        const programPath = id.replace(ID_PREFIX.FRANCETV_PROGRAM, '');
        return [
            { name: 'Voir sur France.tv', category: 'share', url: `https://www.france.tv/${programPath.replace(/_/g, '/')}/` }
        ];
    }
    // RugbyPass
    if (id.startsWith(ID_PREFIX.RUGBYPASS_VOD) || id.startsWith(ID_PREFIX.RUGBYPASS_LIVE) || id.startsWith(ID_PREFIX.RUGBYPASS_PLAYLIST) || id.startsWith(ID_PREFIX.RUGBYPASS_SECTION_BUCKET)) {
        return [
            { name: 'Voir sur RugbyPass TV', category: 'share', url: 'https://rugbypass.tv' }
        ];
    }
    return [];
}

/**
 * Ajoute les liens de partage Stremio aux metas
 * @param {Array} metas - Liste des metas
 * @returns {Array} Metas avec liens de partage
 */
function addShareLinks(metas) {
    return metas.map(meta => ({
        ...meta,
        links: getShareLinks(meta.id)
    }));
}

// Tous les catalogues disponibles (clé = valeur dans config.catalogs)
const ALL_CATALOGS = {
    'live': { type: 'tv', id: 'tvlegal-live', name: '📺 Directs' },
    'films': {
        type: 'movie',
        id: 'tvlegal-films',
        name: '🎬 Films',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Drame', 'Comédie', 'Thriller', 'Action', 'Science-fiction', 'Historique', 'Romance'] }
        ]
    },
    'series-francetv': {
        type: 'series',
        id: 'tvlegal-series-francetv',
        name: '📺 Séries France.tv',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Drame', 'Comédie', 'Policier', 'Thriller', 'Historique'] }
        ]
    },
    'series-arte': {
        type: 'series',
        id: 'tvlegal-series-arte',
        name: '📺 Séries Arte',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Thriller', 'Policier', 'Comédie', 'Drame', 'Science-fiction', 'Historique'] }
        ]
    },
    'docs-arte-films': {
        type: 'movie',
        id: 'tvlegal-docs-arte-films',
        name: '🎥 Docs Arte',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Histoire', 'Société', 'Culture', 'Nature', 'Sciences'] }
        ]
    },
    'docs-arte-series': {
        type: 'series',
        id: 'tvlegal-docs-arte-series',
        name: '🎥 Docs Arte Séries',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Histoire', 'Société', 'Culture', 'Nature', 'Sciences'] }
        ]
    },
    'docs-francetv-films': {
        type: 'movie',
        id: 'tvlegal-docs-francetv-films',
        name: '📺 Docs France.tv',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Histoire', 'Société', 'Nature', 'Culture'] }
        ]
    },
    'docs-francetv-series': {
        type: 'series',
        id: 'tvlegal-docs-francetv-series',
        name: '📺 Docs France.tv Séries',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Tous', 'Histoire', 'Société', 'Nature', 'Culture'] }
        ]
    },
    'emissions-francetv': { type: 'series', id: 'tvlegal-emissions-francetv', name: '📡 Émissions France.tv', extra: [{ name: 'skip', isRequired: false }] },
    'emissions-arte': { type: 'series', id: 'tvlegal-emissions-arte', name: '📡 Émissions Arte', extra: [{ name: 'skip', isRequired: false }] },
    'sport': { type: 'movie', id: 'tvlegal-sport', name: '⚽ Sport', extra: [{ name: 'skip', isRequired: false }] },
    'rugby': { type: 'movie', id: 'tvlegal-rugby', name: '🏉 Rugby', extra: [{ name: 'skip', isRequired: false }] },
    'rugbypass-replay': {
        type: 'series',
        id: 'tvlegal-rugbypass-replay',
        name: '🏉 RugbyPass TV',
        extra: [
            { name: 'skip', isRequired: false },
            { name: 'genre', isRequired: false, options: [
                'Tous', 'Trending', 'Highlights - Replays', 'Latest Shows', 'Documentaries',
                'Series', 'Tournaments', 'Rugby World Cup Archive', 'NZR+', 'Latest',
                '🏴 France', '🏴 Springboks', '🏴 England', '🏴 Ireland', '🏴 Scotland', '🏴 Wales'
            ]}
        ]
    }
};

// Ordre par défaut des catalogues
const DEFAULT_CATALOG_ORDER = ['live', 'films', 'series-francetv', 'series-arte', 'docs-arte-films', 'docs-arte-series', 'docs-francetv-films', 'docs-francetv-series', 'emissions-francetv', 'emissions-arte', 'sport', 'rugby', 'rugbypass-replay'];

/**
 * Génère la liste des catalogues selon la configuration
 */
function getCatalogs(config) {
    // Si pas de config, retourne tous les catalogues
    if (!config) {
        return DEFAULT_CATALOG_ORDER.map(key => ALL_CATALOGS[key]);
    }

    const catalogs = [];

    // Ajoute les directs si activé
    if (config.live !== false) {
        catalogs.push(ALL_CATALOGS['live']);
    }

    // Ajoute les catalogues sélectionnés
    if (config.catalogs && Array.isArray(config.catalogs)) {
        for (const key of config.catalogs) {
            if (ALL_CATALOGS[key]) {
                catalogs.push(ALL_CATALOGS[key]);
            }
        }
    } else {
        // Par défaut, tous les catalogues sauf live (déjà ajouté)
        for (const key of DEFAULT_CATALOG_ORDER) {
            if (key !== 'live' && ALL_CATALOGS[key]) {
                catalogs.push(ALL_CATALOGS[key]);
            }
        }
    }

    return catalogs;
}

/**
 * Vérifie si TMDB est disponible (via config ou env)
 */
function hasTMDB(config) {
    return !!(config?.tmdbKey || process.env.TMDB_API_KEY);
}

/**
 * Mapping des IDs de catalogues vers les clés de config genres
 */
const CATALOG_GENRE_CONFIG_KEYS = {
    'tvlegal-films': 'genres_films',
    'tvlegal-series-francetv': 'genres_series_francetv',
    'tvlegal-series-arte': 'genres_series_arte',
    'tvlegal-docs-arte-films': 'genres_docs_arte_films',
    'tvlegal-docs-arte-series': 'genres_docs_arte_series',
    'tvlegal-docs-francetv-films': 'genres_docs_francetv_films',
    'tvlegal-docs-francetv-series': 'genres_docs_francetv_series'
};

/**
 * Génère le manifest selon la configuration
 */
function getManifest(config) {
    const tmdbAvailable = hasTMDB(config);
    const catalogs = getCatalogs(config).map(catalog => {
        // Clone le catalogue pour ne pas modifier l'original
        let result = { ...catalog };

        // Traite les extras avec genres
        if (result.extra) {
            const needsTMDB = ['tvlegal-films', 'tvlegal-series-francetv', 'tvlegal-series-arte'];
            const configKey = CATALOG_GENRE_CONFIG_KEYS[catalog.id];

            // Retire l'option genre des Films/Séries si pas de TMDB
            if (!tmdbAvailable && needsTMDB.includes(catalog.id)) {
                result = {
                    ...result,
                    extra: result.extra.filter(e => e.name !== 'genre')
                };
            }
            // Filtre les genres selon la config utilisateur
            else if (configKey && config && config[configKey]) {
                result = {
                    ...result,
                    extra: result.extra.map(e => {
                        if (e.name === 'genre' && e.options) {
                            // Garde "Tous" + les genres sélectionnés
                            const selectedGenres = config[configKey];
                            return {
                                ...e,
                                options: e.options.filter(opt =>
                                    opt === 'Tous' || selectedGenres.includes(opt)
                                )
                            };
                        }
                        return e;
                    })
                };
            }
        }

        return result;
    });

    return {
        id: 'community.tvlegal.france',
        version: '1.4.0',
        name: 'TV Legal France',
        description: 'Chaînes françaises légales : France.tv, Arte.tv, TF1+ - Films, Séries, Documentaires, Émissions',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/4/43/TNT_France_logo.svg/200px-TNT_France_logo.svg.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv', 'movie', 'series'],
        catalogs: catalogs,
        idPrefixes: ['tvlegal:', 'tt'],
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        }
    };
}

// Ajoute le catalogue TF1 si configuré
if (tf1Default.isConfigured()) {
    console.log('[TV Legal] TF1+ configuré (credentials détectés)');
} else {
    console.log('[TV Legal] TF1+ non configuré (TF1_EMAIL/TF1_PASSWORD absents)');
}

if (rugbypassDefault) {
    console.log('[TV Legal] RugbyPass TV configuré (credentials détectés)');
} else {
    console.log('[TV Legal] RugbyPass TV non configuré (RUGBYPASS_EMAIL/RUGBYPASS_PASSWORD absents)');
}

// Builder par défaut (sans config)
const builder = new addonBuilder(getManifest(null));

/**
 * Catalog Handler
 */
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`[TV Legal] Catalogue: ${type}/${id}`);
    const skip = parseInt(extra?.skip) || 0;

    // Récupère les clients selon la config (utilise currentConfig défini par le middleware)
    const tmdb = getTMDBClient(currentConfig);
    const tf1 = getTF1Client(currentConfig);

    try {
        // === DIRECTS ===
        if (id === 'tvlegal-live') {
            const metas = [];

            // France.tv Directs
            try {
                const ftvLives = await francetv.getLiveChannels();
                for (const live of ftvLives) {
                    metas.push({
                        id: `${ID_PREFIX.FRANCETV_LIVE}${live.liveId}`,
                        type: 'tv',
                        name: live.title,
                        poster: live.image,
                        posterShape: 'landscape',
                        description: live.description,
                        background: live.image
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur FranceTV lives:', e.message);
            }

            // Arte Direct
            try {
                const arteLive = await arte.getLiveStream();
                if (arteLive && arteLive.streamUrl) {
                    metas.push({
                        id: ID_PREFIX.ARTE_LIVE,
                        type: 'tv',
                        name: 'Arte - Direct',
                        poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Arte_Logo_2017.svg/400px-Arte_Logo_2017.svg.png',
                        posterShape: 'landscape',
                        description: arteLive.subtitle || 'En direct sur Arte'
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte live:', e.message);
            }

            // TF1+ Directs (si configuré)
            if (tf1.isConfigured()) {
                try {
                    const tf1Lives = await tf1.getLiveChannels();
                    for (const live of tf1Lives) {
                        metas.push({
                            id: `${ID_PREFIX.TF1_LIVE}${live.id}`,
                            type: 'tv',
                            name: live.title,
                            poster: live.image || live.logo,
                            posterShape: 'landscape',
                            description: live.description,
                            logo: live.logo
                        });
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur TF1+ lives:', e.message);
                }
            }

            // RugbyPass TV Live (si configuré)
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const events = await rugbypass.getLiveEvents();
                    for (const event of events) {
                        if (event.live) {
                            metas.push({
                                id: `${ID_PREFIX.RUGBYPASS_LIVE}${event.id}`,
                                type: 'tv',
                                name: `RugbyPass - ${event.title}`,
                                poster: event.thumbnailUrl,
                                posterShape: 'landscape',
                                description: event.description || '🏉 En direct sur RugbyPass TV'
                            });
                        }
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur RugbyPass lives:', e.message);
                }
            }

            console.log(`[TV Legal] ${metas.length} directs`);
            return { metas: addShareLinks(metas) };
        }

        // === FILMS (Arte Cinéma) ===
        if (id === 'tvlegal-films') {
            const metas = [];
            const genre = extra?.genre;
            const genreFilter = genre && genre !== 'Tous' ? genre : null;

            // Mapping des genres français vers anglais (TMDB)
            const genreMapping = {
                'Thriller': ['Thriller', 'Mystery', 'Crime'],
                'Action': ['Action', 'Adventure'],
                'Comédie': ['Comedy'],
                'Drame': ['Drama'],
                'Science-fiction': ['Science Fiction', 'Sci-Fi'],
                'Historique': ['History', 'War'],
                'Romance': ['Romance']
            };

            // Calcul de la page Arte depuis skip (50 items par page Stremio)
            const artePage = Math.floor(skip / 50) + 1;

            try {
                const videos = await arte.getCategory('CIN', artePage);

                // Sans filtre ou sans TMDB, on retourne directement
                if (!genreFilter || !tmdb) {
                    for (const video of videos) {
                        metas.push({
                            id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                            type: 'movie',
                            name: video.title,
                            poster: video.image || video.imageLarge,
                            posterShape: 'poster',
                            description: video.description || video.subtitle,
                            background: video.imageLarge,
                            releaseInfo: video.durationLabel
                        });
                    }
                } else {
                    // Avec filtre: traiter par lots de 5 pour éviter trop de requêtes simultanées
                    const BATCH_SIZE = 5;
                    const tmdbGenres = genreMapping[genreFilter] || [genreFilter];

                    for (let i = 0; i < videos.length; i += BATCH_SIZE) {
                        const batch = videos.slice(i, i + BATCH_SIZE);
                        const results = await Promise.all(
                            batch.map(async (video) => {
                                try {
                                    const tmdbResults = await tmdb.searchMovies(video.title);
                                    const genres = tmdbResults?.[0]?.genres || [];
                                    const hasGenre = genres.some(g =>
                                        tmdbGenres.some(tg =>
                                            g.toLowerCase().includes(tg.toLowerCase()) ||
                                            tg.toLowerCase().includes(g.toLowerCase())
                                        )
                                    );
                                    return hasGenre ? { video, genres } : null;
                                } catch (e) {
                                    return null;
                                }
                            })
                        );

                        for (const result of results) {
                            if (result) {
                                metas.push({
                                    id: `${ID_PREFIX.ARTE_VIDEO}${result.video.programId}`,
                                    type: 'movie',
                                    name: result.video.title,
                                    poster: result.video.imageLarge || result.video.image,
                                    posterShape: 'poster',
                                    description: result.video.description || result.video.subtitle,
                                    background: result.video.imageLarge,
                                    releaseInfo: result.video.durationLabel,
                                    genre: result.genres
                                });
                            }
                        }

                        // Stop si on a assez de résultats
                        if (metas.length >= 50) break;
                    }
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte Films:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} films (filtre: ${genre || 'aucun'}, page: ${artePage})`);
            return { metas: addShareLinks(metas) };
        }

        // === SÉRIES FRANCE.TV ===
        if (id === 'tvlegal-series-francetv') {
            const metas = [];
            const genre = extra?.genre;
            const genreFilter = genre && genre !== 'Tous' ? genre : null;

            // Mapping des genres français vers anglais (TMDB)
            const genreMapping = {
                'Thriller': ['Thriller', 'Mystery', 'Crime'],
                'Policier': ['Crime', 'Mystery'],
                'Comédie': ['Comedy'],
                'Drame': ['Drama'],
                'Historique': ['History', 'War', 'War & Politics']
            };

            try {
                const ftvVideos = await francetv.getChannelContent('series-et-fictions');
                const programs = ftvVideos.filter(v => v.isProgram);

                // Enrichir avec TMDB en parallèle (max 10 simultanés)
                const enrichedPrograms = await Promise.all(
                    programs.map(async (video) => {
                        let genres = [];
                        if (tmdb) {
                            try {
                                const tmdbResults = await tmdb.searchSeries(video.title);
                                if (tmdbResults && tmdbResults.length > 0) {
                                    genres = tmdbResults[0].genres || [];
                                }
                            } catch (e) {}
                        }
                        return { video, genres };
                    })
                );

                for (const { video, genres } of enrichedPrograms) {
                    // Filtre par genre si demandé (et TMDB disponible)
                    if (genreFilter && tmdb) {
                        const tmdbGenres = genreMapping[genreFilter] || [genreFilter];
                        const hasGenre = genres.some(g =>
                            tmdbGenres.some(tg =>
                                g.toLowerCase().includes(tg.toLowerCase()) ||
                                tg.toLowerCase().includes(g.toLowerCase())
                            )
                        );
                        if (!hasGenre) continue;
                    }

                    metas.push({
                        id: `${ID_PREFIX.FRANCETV_PROGRAM}${video.programPath}`,
                        type: 'series',
                        name: video.title,
                        poster: video.poster || video.image,
                        posterShape: 'poster',
                        description: video.description,
                        background: video.image,
                        genre: genres
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur FranceTV Séries:', e.message);
            }

            // Déduplique
            const seen = new Set();
            const unique = metas.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
            });

            console.log(`[TV Legal] ${unique.length} séries France.tv (filtre: ${genre || 'aucun'})`);
            return { metas: addShareLinks(unique.slice(skip, skip + 50)) };
        }

        // === SÉRIES ARTE ===
        if (id === 'tvlegal-series-arte') {
            const metas = [];
            const genre = extra?.genre;
            const genreFilter = genre && genre !== 'Tous' ? genre : null;

            // Mapping des genres français vers anglais (TMDB) - peut matcher plusieurs genres
            const genreMapping = {
                'Thriller': ['Thriller', 'Mystery', 'Crime'],
                'Policier': ['Crime', 'Mystery'],
                'Comédie': ['Comedy'],
                'Drame': ['Drama'],
                'Science-fiction': ['Sci-Fi', 'Sci-Fi & Fantasy', 'Science Fiction'],
                'Historique': ['History', 'War', 'War & Politics']
            };

            // Pagination à la demande
            const artePage = Math.floor(skip / 50) + 1;

            try {
                const arteVideos = await arte.getCategory('SER', artePage);

                // Enrichir avec TMDB en parallèle
                const enrichedVideos = await Promise.all(
                    arteVideos.map(async (video) => {
                        let genres = [];
                        if (tmdb) {
                            try {
                                const tmdbResults = await tmdb.searchSeries(video.title);
                                if (tmdbResults && tmdbResults.length > 0) {
                                    genres = tmdbResults[0].genres || [];
                                }
                            } catch (e) {}
                        }
                        return { video, genres };
                    })
                );

                for (const { video, genres } of enrichedVideos) {
                    // Filtre par genre si demandé (et TMDB disponible)
                    if (genreFilter && tmdb) {
                        const tmdbGenres = genreMapping[genreFilter] || [genreFilter];
                        const hasGenre = genres.some(g =>
                            tmdbGenres.some(tg =>
                                g.toLowerCase().includes(tg.toLowerCase()) ||
                                tg.toLowerCase().includes(g.toLowerCase())
                            )
                        );
                        if (!hasGenre) continue;
                    }

                    metas.push({
                        id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                        type: 'series',
                        name: video.title,
                        poster: video.image || video.imageLarge,
                        posterShape: 'poster',
                        description: video.description || video.subtitle,
                        background: video.imageLarge,
                        releaseInfo: video.durationLabel,
                        genre: genres
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte Séries:', e.message);
            }

            // Déduplique
            const seen = new Set();
            const unique = metas.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
            });

            console.log(`[TV Legal] ${unique.length} séries Arte (filtre: ${genre || 'aucun'}, page: ${artePage})`);
            return { metas: addShareLinks(unique) };
        }

        // === DOCUMENTAIRES ARTE (Films) ===
        if (id === 'tvlegal-docs-arte-films' || id === 'tvlegal-docs-arte-series') {
            const isSeriesMode = id === 'tvlegal-docs-arte-series';
            const filterType = isSeriesMode ? 'series' : 'films';
            const metas = [];
            const genre = extra?.genre;
            const genreFilter = genre && genre !== 'Tous' ? genre : null;

            // Mapping des genres vers les zones Arte
            const arteZones = {
                'Histoire': ['06478610-af88-4495-afeb-bd6e58b46524'],
                'Société': ['7f707109-8033-4984-bfa6-28cc4afd35d6'],
                'Culture': ['5d00159c-8d93-46b6-9c98-0fdbf968c165'],
                'Nature': ['f5cec907-b485-489b-ab8e-ace8082f631c', '37c9c803-6e7d-40a1-8392-cf45d8f1b4c9'],
                'Sciences': ['83e3dc30-3233-47e9-b916-394ab1535b19']
            };

            // Pagination à la demande
            const artePage = Math.floor(skip / 50) + 1;

            try {
                let videos = [];

                // Pour séries: ratio 1:4, donc plus de pages. Pour films: 5 pages suffit
                const pagesPerRequest = isSeriesMode ? 10 : 5;
                const arteStartPage = (artePage - 1) * pagesPerRequest + 1;

                // Toujours utiliser les zones (plus de contenu que la catégorie)
                const zoneIds = genreFilter ? (arteZones[genreFilter] || []) : Object.values(arteZones).flat();

                const allPromises = [];
                for (const zoneId of zoneIds) {
                    for (let p = arteStartPage; p < arteStartPage + pagesPerRequest; p++) {
                        allPromises.push(arte.getZone(zoneId, 'DOR', p, filterType).catch(() => []));
                    }
                }
                const results = await Promise.all(allPromises);
                for (const zoneVideos of results) {
                    videos.push(...zoneVideos);
                }

                // Déduplique par programId
                const seen = new Set();
                for (const video of videos) {
                    if (seen.has(video.programId)) continue;
                    seen.add(video.programId);

                    metas.push({
                        id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                        type: isSeriesMode ? 'series' : 'movie',
                        name: video.title,
                        poster: video.image || video.imageLarge,
                        posterShape: 'poster',
                        description: video.description || video.subtitle,
                        background: video.imageLarge,
                        releaseInfo: video.durationLabel
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte Docs:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} docs Arte ${filterType} (filtre: ${genre || 'aucun'}, page: ${artePage})`);
            return { metas: addShareLinks(metas) };
        }

        // === DOCUMENTAIRES FRANCE.TV (Films & Séries) ===
        if (id === 'tvlegal-docs-francetv-films' || id === 'tvlegal-docs-francetv-series') {
            const isSeriesMode = id === 'tvlegal-docs-francetv-series';
            const filterType = isSeriesMode ? 'series' : 'films';
            const metas = [];
            const genre = extra?.genre;
            const genreFilter = genre && genre !== 'Tous' ? genre : null;

            // Mapping des genres vers les IDs de collections France.tv
            const ftvCollections = {
                'Histoire': [18139269, 18279141],      // "Ils ont marqué l'histoire", "Il y a fort longtemps"
                'Société': [18627612, 18847962],       // "Comprendre la marche du monde", "Une fenêtre sur le monde"
                'Nature': [18847980, 18304116],        // "Merveilleuse planète", "Au cœur de la vie sauvage"
                'Culture': [18504090, 18506901]        // "Figures du 7e art", "Figures musicales"
            };

            try {
                const collectionIds = genreFilter ? ftvCollections[genreFilter] : null;
                const videos = await francetv.getDocumentaries(collectionIds, filterType);

                for (const video of videos) {
                    const metaId = video.isProgram
                        ? `${ID_PREFIX.FRANCETV_PROGRAM}${video.programPath}`
                        : `${ID_PREFIX.FRANCETV_VIDEO}${video.id}`;

                    metas.push({
                        id: metaId,
                        type: isSeriesMode ? 'series' : 'movie',
                        name: video.title,
                        poster: video.poster || video.image,
                        posterShape: video.poster ? 'poster' : 'landscape',
                        description: video.description,
                        background: video.image
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur FranceTV Docs:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} docs France.tv ${filterType} (filtre: ${genre || 'aucun'})`);
            return { metas: addShareLinks(metas.slice(skip, skip + 50)) };
        }

        // === ÉMISSIONS TV (France.tv) ===
        // === ÉMISSIONS FRANCE.TV ===
        if (id === 'tvlegal-emissions-francetv') {
            const metas = [];
            const channels = ['france-2', 'france-3', 'france-5', 'france-4', 'franceinfo'];

            for (const channelId of channels) {
                try {
                    const videos = await francetv.getEmissions(channelId);
                    for (const video of videos.slice(0, 15)) {
                        // Privilégie les programmes (avec épisodes) aux vidéos simples
                        if (video.isProgram && video.programPath) {
                            metas.push({
                                id: `${ID_PREFIX.FRANCETV_PROGRAM}${video.programPath}`,
                                type: 'series',
                                name: video.title,
                                poster: video.poster || video.image,
                                posterShape: video.poster ? 'poster' : 'landscape',
                                description: video.description,
                                background: video.image
                            });
                        } else {
                            metas.push({
                                id: `${ID_PREFIX.FRANCETV_VIDEO}${video.id}`,
                                type: 'series',
                                name: video.title,
                                poster: video.poster || video.image,
                                posterShape: video.poster ? 'poster' : 'landscape',
                                description: video.description,
                                background: video.image
                            });
                        }
                    }
                } catch (e) {
                    console.error(`[TV Legal] Erreur FranceTV ${channelId}:`, e.message);
                }
            }

            // Déduplique par nom (garde le premier = souvent le programme)
            const seen = new Set();
            const unique = metas.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
            });

            console.log(`[TV Legal] ${unique.length} émissions France.tv`);
            return { metas: addShareLinks(unique.slice(skip, skip + 50)) };
        }

        // === ÉMISSIONS ARTE ===
        if (id === 'tvlegal-emissions-arte') {
            const metas = [];

            try {
                const arteVideos = await arte.getCategory('EMI', 1);
                for (const video of arteVideos) {
                    metas.push({
                        id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                        type: 'series',
                        name: video.title,
                        poster: video.poster || video.image,
                        posterShape: 'poster',
                        description: video.description || video.subtitle,
                        background: video.imageLarge
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte émissions:', e.message);
            }

            // Déduplique par nom
            const seen = new Set();
            const unique = metas.filter(m => {
                if (seen.has(m.name)) return false;
                seen.add(m.name);
                return true;
            });

            console.log(`[TV Legal] ${unique.length} émissions Arte`);
            return { metas: addShareLinks(unique.slice(skip, skip + 50)) };
        }

        // === SPORT (France.tv) ===
        if (id === 'tvlegal-sport') {
            const metas = [];

            try {
                const videos = await francetv.getChannelContent('sport');
                for (const video of videos) {
                    const metaId = video.isProgram
                        ? `${ID_PREFIX.FRANCETV_PROGRAM}${video.programPath}`
                        : `${ID_PREFIX.FRANCETV_VIDEO}${video.id}`;

                    metas.push({
                        id: metaId,
                        type: 'movie',
                        name: video.title,
                        poster: video.poster || video.image,
                        posterShape: video.poster ? 'poster' : 'landscape',
                        description: video.description,
                        background: video.image
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur FranceTV Sport:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} vidéos sport`);
            return { metas: addShareLinks(metas.slice(skip, skip + 50)) };
        }

        // === RUGBY (France.tv) ===
        if (id === 'tvlegal-rugby') {
            const metas = [];

            try {
                const videos = await francetv.getRugbyContent();
                for (const video of videos) {
                    metas.push({
                        id: `${ID_PREFIX.FRANCETV_VIDEO}${video.id}`,
                        type: 'movie',
                        name: video.title,
                        poster: video.poster || video.image,
                        posterShape: video.poster ? 'poster' : 'landscape',
                        description: video.description,
                        background: video.image
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur FranceTV Rugby:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} vidéos rugby`);
            return { metas: addShareLinks(metas.slice(skip, skip + 50)) };
        }

        // === RUGBYPASS TV (Replays) ===
        if (id === 'tvlegal-rugbypass-replay') {
            const rugbypass = getRugbyPassClient(currentConfig);
            if (!rugbypass) {
                console.log('[TV Legal] RugbyPass non configuré');
                return { metas: [] };
            }

            const metas = [];
            const genre = extra?.genre;
            const genreFilter = genre && genre !== 'Tous' ? genre : null;

            try {
                const catalog = await rugbypass.getCatalogByGenre(genreFilter, skip, 50);
                for (const item of catalog) {
                    if (item.type === 'vod') {
                        metas.push({
                            id: `${ID_PREFIX.RUGBYPASS_VOD}${item.id}`,
                            type: 'series',
                            name: item.title,
                            poster: item.poster || item.thumbnail,
                            posterShape: 'landscape',
                            description: item.description,
                        });
                    } else if (item.type === 'playlist') {
                        metas.push({
                            id: `${ID_PREFIX.RUGBYPASS_PLAYLIST}${item.id}`,
                            type: 'series',
                            name: item.title,
                            poster: item.poster || item.thumbnail,
                            posterShape: 'landscape',
                        });
                    } else if (item.type === 'section_bucket') {
                        metas.push({
                            id: `${ID_PREFIX.RUGBYPASS_SECTION_BUCKET}${item.sectionName}:${item.exid}`,
                            type: 'series',
                            name: item.title,
                            poster: item.poster || item.thumbnail,
                            posterShape: 'landscape',
                        });
                    }
                }
            } catch (e) {
                console.error('[TV Legal] Erreur RugbyPass catalogue:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} vidéos RugbyPass (genre: ${genre || 'Tous'}, skip: ${skip})`);
            return { metas: addShareLinks(metas) };
        }

        return { metas: [] };

    } catch (error) {
        console.error('[TV Legal] Erreur catalogue:', error.message);
        return { metas: [] };
    }
});

/**
 * Meta Handler
 */
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[TV Legal] Meta: ${id}`);

    // Récupère le client TF1 selon la config
    const tf1 = getTF1Client(currentConfig);

    try {
        // France.tv Live
        if (id.startsWith(ID_PREFIX.FRANCETV_LIVE)) {
            const liveId = id.replace(ID_PREFIX.FRANCETV_LIVE, '');
            const info = await francetv.getVideoInfo(liveId);
            if (info) {
                return {
                    meta: {
                        id,
                        type: 'tv',
                        name: info.title || 'Direct France.tv',
                        poster: info.image,
                        description: info.description,
                        background: info.image,
                        links: getShareLinks(id)
                    }
                };
            }
        }

        // France.tv Video
        if (id.startsWith(ID_PREFIX.FRANCETV_VIDEO)) {
            const videoId = id.replace(ID_PREFIX.FRANCETV_VIDEO, '');
            const info = await francetv.getVideoInfo(videoId);
            if (info) {
                // Si demandé comme série (ex: émissions), créer un épisode unique
                if (type === 'series') {
                    return {
                        meta: {
                            id,
                            type: 'series',
                            name: info.title,
                            poster: info.image,
                            description: info.description,
                            background: info.image,
                            videos: [{
                                id: id,
                                title: info.title,
                                season: 1,
                                episode: 1,
                                thumbnail: info.image,
                                overview: info.description
                            }],
                            links: getShareLinks(id)
                        }
                    };
                }
                return {
                    meta: {
                        id,
                        type: 'movie',
                        name: info.title,
                        poster: info.image,
                        description: info.description,
                        background: info.image,
                        runtime: info.duration ? `${Math.round(info.duration / 60)} min` : undefined,
                        links: getShareLinks(id)
                    }
                };
            }
        }

        // France.tv Program (série)
        if (id.startsWith(ID_PREFIX.FRANCETV_PROGRAM)) {
            const programPath = id.replace(ID_PREFIX.FRANCETV_PROGRAM, '');
            const info = await francetv.getProgramInfo(programPath);
            if (info) {
                // Formate les épisodes pour Stremio
                const videos = (info.episodes || []).map((ep, index) => ({
                    id: `${ID_PREFIX.FRANCETV_VIDEO}${ep.id}`,
                    title: ep.title,
                    season: ep.season || 1,
                    episode: ep.episode || index + 1,
                    thumbnail: ep.thumbnail,
                    overview: ep.description
                }));

                return {
                    meta: {
                        id,
                        type: 'series',
                        name: info.title,
                        poster: info.poster || info.image,
                        description: info.description,
                        background: info.background,
                        videos,
                        links: getShareLinks(id)
                    }
                };
            }
        }

        // Arte Live
        if (id === ID_PREFIX.ARTE_LIVE) {
            const live = await arte.getLiveStream();
            return {
                meta: {
                    id,
                    type: 'tv',
                    name: 'Arte - Direct',
                    poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Arte_Logo_2017.svg/400px-Arte_Logo_2017.svg.png',
                    description: live?.subtitle || 'En direct sur Arte',
                    links: getShareLinks(id)
                }
            };
        }

        // Arte Video
        if (id.startsWith(ID_PREFIX.ARTE_VIDEO)) {
            const programId = id.replace(ID_PREFIX.ARTE_VIDEO, '');

            // Collection (série Arte)
            if (programId.startsWith('RC-')) {
                const episodes = await arte.getCollectionEpisodes(programId);
                const meta = await arte.getVideoMeta(programId);

                const videos = episodes.map((ep) => ({
                    id: `${ID_PREFIX.ARTE_VIDEO}${ep.programId}`,
                    title: ep.subtitle || ep.title,
                    season: ep.season || 1,
                    episode: ep.episode || 1,
                    thumbnail: ep.image,
                    overview: ep.description
                }));

                const image = meta?.images?.[0]?.url || episodes[0]?.image;

                return {
                    meta: {
                        id,
                        type: 'series',
                        name: meta?.title?.split(' - ')[0] || 'Série Arte',
                        poster: image,
                        description: meta?.description,
                        background: image,
                        videos,
                        links: getShareLinks(id)
                    }
                };
            }

            const info = await arte.getVideoMeta(programId);
            if (info) {
                const image = info.images?.find(i => i.url)?.url?.replace('__SIZE__', '400x225');
                const metaType = type === 'series' ? 'series' : 'movie';
                return {
                    meta: {
                        id,
                        type: metaType,
                        name: info.title,
                        poster: image,
                        description: info.description,
                        runtime: info.duration ? `${Math.round(info.duration / 60)} min` : undefined,
                        links: getShareLinks(id)
                    }
                };
            }
        }

        // TF1 Live
        if (id.startsWith(ID_PREFIX.TF1_LIVE)) {
            const mediaId = id.replace(ID_PREFIX.TF1_LIVE, '');
            const info = await tf1.getMediaInfo(mediaId);
            if (info) {
                return {
                    meta: {
                        id,
                        type: 'tv',
                        name: info.title || info.channel,
                        poster: info.preview,
                        description: `Direct ${info.channel}`,
                        background: info.preview,
                        links: getShareLinks(id)
                    }
                };
            }
        }

        // RugbyPass Live
        if (id.startsWith(ID_PREFIX.RUGBYPASS_LIVE)) {
            const eventId = id.replace(ID_PREFIX.RUGBYPASS_LIVE, '');
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const events = await rugbypass.getLiveEvents();
                    const event = events.find(e => String(e.id) === eventId);
                    if (event) {
                        return {
                            meta: {
                                id,
                                type: 'tv',
                                name: event.title,
                                poster: event.thumbnailUrl,
                                description: event.description || 'En direct sur RugbyPass TV',
                                links: getShareLinks(id)
                            }
                        };
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur meta RugbyPass live:', e.message);
                }
            }
        }

        // RugbyPass VOD (vidéo unique → série avec 1 épisode)
        if (id.startsWith(ID_PREFIX.RUGBYPASS_VOD)) {
            const vodId = id.replace(ID_PREFIX.RUGBYPASS_VOD, '');
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const vodData = await rugbypass._fetch(`/v2/vod/${vodId}`);
                    return {
                        meta: {
                            id,
                            type: 'series',
                            name: vodData.title || 'RugbyPass TV',
                            poster: vodData.thumbnailUrl,
                            description: vodData.description || '',
                            videos: [{
                                id: `${id}:1:1`,
                                title: vodData.title || 'Regarder',
                                season: 1,
                                episode: 1,
                                overview: vodData.description || '',
                                thumbnail: vodData.thumbnailUrl,
                            }],
                            links: getShareLinks(id)
                        }
                    };
                } catch (e) {
                    console.error('[TV Legal] Erreur meta RugbyPass VOD:', e.message);
                }
            }
        }

        // RugbyPass Playlist (liste de vidéos → série avec épisodes)
        if (id.startsWith(ID_PREFIX.RUGBYPASS_PLAYLIST)) {
            const playlistId = id.replace(ID_PREFIX.RUGBYPASS_PLAYLIST, '');
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const playlist = await rugbypass.getPlaylist(playlistId);
                    const videos = playlist.vods.map((vod, i) => ({
                        id: `${id}:1:${i + 1}`,
                        title: vod.title || vod.name || `Vidéo ${i + 1}`,
                        season: 1,
                        episode: i + 1,
                        overview: vod.description || '',
                        thumbnail: vod.thumbnailUrl,
                    }));

                    return {
                        meta: {
                            id,
                            type: 'series',
                            name: playlist.title || playlist.vods[0]?.title || 'RugbyPass TV',
                            poster: playlist.coverUrl || playlist.vods[0]?.thumbnailUrl,
                            description: `${videos.length} vidéos`,
                            videos,
                            links: getShareLinks(id)
                        }
                    };
                } catch (e) {
                    console.error('[TV Legal] Erreur meta RugbyPass playlist:', e.message);
                }
            }
        }

        // RugbyPass Section Bucket (playlist de section pays → série avec épisodes)
        if (id.startsWith(ID_PREFIX.RUGBYPASS_SECTION_BUCKET)) {
            const rest = id.replace(ID_PREFIX.RUGBYPASS_SECTION_BUCKET, '');
            const colonIdx = rest.indexOf(':');
            const sectionName = rest.substring(0, colonIdx);
            const bucketExid = rest.substring(colonIdx + 1);
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const bucket = await rugbypass.getSectionBucketContent(sectionName, bucketExid);
                    const videos = bucket.vods.map((vod, i) => ({
                        id: `${id}:1:${i + 1}`,
                        title: vod.title || vod.name || `Vidéo ${i + 1}`,
                        season: 1,
                        episode: i + 1,
                        overview: vod.description || '',
                        thumbnail: vod.thumbnailUrl,
                    }));

                    return {
                        meta: {
                            id,
                            type: 'series',
                            name: bucket.title,
                            poster: bucket.vods[0]?.thumbnailUrl,
                            description: `${videos.length} vidéos`,
                            videos,
                            links: getShareLinks(id)
                        }
                    };
                } catch (e) {
                    console.error('[TV Legal] Erreur meta RugbyPass section bucket:', e.message);
                }
            }
        }

        return { meta: null };

    } catch (error) {
        console.error('[TV Legal] Erreur meta:', error.message);
        return { meta: null };
    }
});

/**
 * Stream Handler
 */
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[TV Legal] Stream: ${id}`);

    // Récupère les clients selon la config
    const tmdb = getTMDBClient(currentConfig);
    const tf1 = getTF1Client(currentConfig);

    try {
        // France.tv Live
        if (id.startsWith(ID_PREFIX.FRANCETV_LIVE)) {
            const liveId = id.replace(ID_PREFIX.FRANCETV_LIVE, '');
            const info = await francetv.getVideoInfo(liveId);

            if (info?.drm) {
                return {
                    streams: [{
                        name: 'France.tv',
                        title: 'Contenu protégé (DRM)',
                        externalUrl: 'https://www.france.tv/'
                    }]
                };
            }

            if (info?.streamUrl) {
                return {
                    streams: [{
                        name: 'France.tv',
                        title: `🔴 ${info.title || 'Direct'}`,
                        url: info.streamUrl,
                        behaviorHints: { notWebReady: false }
                    }]
                };
            }
        }

        // France.tv Video
        if (id.startsWith(ID_PREFIX.FRANCETV_VIDEO)) {
            const videoId = id.replace(ID_PREFIX.FRANCETV_VIDEO, '');
            const info = await francetv.getVideoInfo(videoId);

            if (info?.drm) {
                return {
                    streams: [{
                        name: 'France.tv',
                        title: 'Contenu protégé (DRM)',
                        externalUrl: 'https://www.france.tv/'
                    }]
                };
            }

            if (info?.streamUrl) {
                return {
                    streams: [{
                        name: 'France.tv',
                        title: `${info.title || 'Replay'}\n🇫🇷 Français`,
                        url: info.streamUrl,
                        behaviorHints: { notWebReady: false }
                    }]
                };
            }
        }

        // France.tv Program (premier épisode)
        if (id.startsWith(ID_PREFIX.FRANCETV_PROGRAM)) {
            const programPath = id.replace(ID_PREFIX.FRANCETV_PROGRAM, '');
            const program = await francetv.getProgramInfo(programPath);

            if (program?.episodes?.length > 0) {
                const episode = program.episodes[0];
                const info = await francetv.getVideoInfo(episode.id);

                if (info?.drm) {
                    return {
                        streams: [{
                            name: 'France.tv',
                            title: 'Contenu protégé (DRM)',
                            externalUrl: 'https://www.france.tv/'
                        }]
                    };
                }

                if (info?.streamUrl) {
                    return {
                        streams: [{
                            name: 'France.tv',
                            title: `${episode.title || program.title}\n🇫🇷 Français`,
                            url: info.streamUrl,
                            behaviorHints: { notWebReady: false }
                        }]
                    };
                }
            }
        }

        // Arte Live
        if (id === ID_PREFIX.ARTE_LIVE) {
            const live = await arte.getLiveStream();
            if (live?.streamUrl) {
                return {
                    streams: [{
                        name: 'Arte',
                        title: `🔴 ${live.title || 'Direct Arte'}`,
                        url: live.streamUrl,
                        behaviorHints: { notWebReady: false }
                    }]
                };
            }
        }

        // Arte Video
        if (id.startsWith(ID_PREFIX.ARTE_VIDEO)) {
            const programId = id.replace(ID_PREFIX.ARTE_VIDEO, '');
            const streamUrl = await arte.getStreamUrl(programId);

            if (streamUrl) {
                const meta = await arte.getVideoMeta(programId);
                return {
                    streams: [{
                        name: 'Arte',
                        title: `${meta?.title || 'Arte'}\n🇫🇷 Français - HD`,
                        url: streamUrl,
                        behaviorHints: { notWebReady: false }
                    }]
                };
            }
        }

        // TF1 Live
        if (id.startsWith(ID_PREFIX.TF1_LIVE)) {
            const mediaId = id.replace(ID_PREFIX.TF1_LIVE, '');
            const info = await tf1.getMediaInfo(mediaId);

            if (info?.error) {
                return {
                    streams: [{
                        name: 'TF1+',
                        title: info.errorDesc || 'Non disponible',
                        externalUrl: 'https://www.tf1.fr/'
                    }]
                };
            }

            if (info?.streamUrl) {
                return {
                    streams: [{
                        name: 'TF1+',
                        title: `🔴 ${info.title || info.channel}`,
                        url: info.streamUrl,
                        behaviorHints: { notWebReady: false }
                    }]
                };
            }
        }

        // === IMDB ID (depuis autres catalogues) ===
        if (id.startsWith('tt') && tmdb) {
            console.log(`[TV Legal] Recherche IMDB: ${id}`);
            const streams = [];

            // Parse l'ID (peut être tt1234567 ou tt1234567:1:1 pour séries)
            const parts = id.split(':');
            const imdbId = parts[0];
            const season = parts[1] ? parseInt(parts[1]) : null;
            const episode = parts[2] ? parseInt(parts[2]) : null;

            // Récupère le titre depuis TMDB
            const tmdbInfo = await tmdb.findByImdbId(imdbId);
            if (!tmdbInfo || !tmdbInfo.title) {
                console.log(`[TV Legal] IMDB ${imdbId} non trouvé sur TMDB`);
                return { streams: [] };
            }

            console.log(`[TV Legal] IMDB ${imdbId} → "${tmdbInfo.title}" (${tmdbInfo.type}) S${season || '?'}E${episode || '?'}`);

            // Cherche sur Arte
            try {
                const arteCategory = tmdbInfo.type === 'series' ? 'SER' : 'CIN';
                const arteVideos = await arte.getCategory(arteCategory);
                const arteMatch = arteVideos.find(v =>
                    v.title.toLowerCase() === tmdbInfo.title.toLowerCase() ||
                    v.title.toLowerCase().includes(tmdbInfo.title.toLowerCase()) ||
                    tmdbInfo.title.toLowerCase().includes(v.title.toLowerCase())
                );

                if (arteMatch) {
                    console.log(`[TV Legal] Trouvé sur Arte: ${arteMatch.title} (${arteMatch.programId})`);

                    // Si c'est une série avec saison/épisode, cherche l'épisode
                    if (season && episode && arteMatch.programId.startsWith('RC-')) {
                        const episodes = await arte.getCollectionEpisodes(arteMatch.programId);
                        // Cherche l'épisode correspondant (index = episode - 1 pour saison 1)
                        const epIndex = (season === 1) ? episode - 1 : episode - 1;
                        if (episodes[epIndex]) {
                            const streamUrl = await arte.getStreamUrl(episodes[epIndex].programId);
                            if (streamUrl) {
                                streams.push({
                                    name: 'Arte',
                                    title: `S${season}E${episode} - ${episodes[epIndex].title || arteMatch.title}\n🇫🇷 Arte - HD`,
                                    url: streamUrl,
                                    behaviorHints: { notWebReady: false }
                                });
                            }
                        }
                    } else {
                        // Film ou série sans épisode spécifique
                        const streamUrl = await arte.getStreamUrl(arteMatch.programId);
                        if (streamUrl) {
                            streams.push({
                                name: 'Arte',
                                title: `${arteMatch.title}\n🇫🇷 Arte - HD`,
                                url: streamUrl,
                                behaviorHints: { notWebReady: false }
                            });
                        }
                    }
                }
            } catch (e) {
                console.error('[TV Legal] Erreur recherche Arte:', e.message);
            }

            // Cherche sur France.tv (séries)
            if (tmdbInfo.type === 'series') {
                try {
                    const ftvVideos = await francetv.getChannelContent('series-et-fictions');
                    const ftvMatch = ftvVideos.find(v =>
                        v.isProgram && (
                            v.title.toLowerCase() === tmdbInfo.title.toLowerCase() ||
                            v.title.toLowerCase().includes(tmdbInfo.title.toLowerCase()) ||
                            tmdbInfo.title.toLowerCase().includes(v.title.toLowerCase())
                        )
                    );

                    if (ftvMatch) {
                        console.log(`[TV Legal] Trouvé sur France.tv: ${ftvMatch.title}`);
                        const programInfo = await francetv.getProgramInfo(ftvMatch.programPath);
                        if (programInfo?.episodes?.length > 0) {
                            // Cherche l'épisode correspondant ou prend le premier
                            let targetEp = programInfo.episodes[0];
                            if (season && episode) {
                                const matchingEp = programInfo.episodes.find(ep =>
                                    ep.season === season && ep.episode === episode
                                );
                                if (matchingEp) targetEp = matchingEp;
                                // Sinon essaie par index
                                else if (programInfo.episodes[episode - 1]) {
                                    targetEp = programInfo.episodes[episode - 1];
                                }
                            }

                            const videoInfo = await francetv.getVideoInfo(targetEp.id);
                            if (videoInfo?.streamUrl && !videoInfo.drm) {
                                const epTitle = season && episode ? `S${season}E${episode} - ` : '';
                                streams.push({
                                    name: 'France.tv',
                                    title: `${epTitle}${targetEp.title || ftvMatch.title}\n🇫🇷 France.tv`,
                                    url: videoInfo.streamUrl,
                                    behaviorHints: { notWebReady: false }
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur recherche France.tv:', e.message);
                }
            }

            if (streams.length > 0) {
                return { streams };
            }
        }

        // RugbyPass Live
        if (id.startsWith(ID_PREFIX.RUGBYPASS_LIVE)) {
            const eventId = id.replace(ID_PREFIX.RUGBYPASS_LIVE, '');
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const result = await rugbypass.getEventStream(eventId);
                    if (result.hasDrm) {
                        return {
                            streams: [{
                                name: 'RugbyPass TV',
                                title: 'Contenu protégé (DRM)',
                                externalUrl: 'https://rugbypass.tv'
                            }]
                        };
                    }
                    if (result.streamUrl) {
                        const stream = {
                            name: 'RugbyPass TV',
                            title: `🔴 ${result.event?.title || 'Live Rugby'}`,
                            url: result.streamUrl,
                            behaviorHints: { notWebReady: false }
                        };
                        if (result.subtitles?.length) {
                            stream.subtitles = result.subtitles
                                .filter(s => s.format === 'vtt' || s.format === 'srt')
                                .map(s => ({ id: s.lang, url: s.url, lang: s.lang }));
                        }
                        return { streams: [stream] };
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur stream RugbyPass live:', e.message);
                }
            }
        }

        // RugbyPass VOD (format: tvlegal:rugbypass:vod:ID:season:episode)
        if (id.startsWith(ID_PREFIX.RUGBYPASS_VOD)) {
            const rest = id.replace(ID_PREFIX.RUGBYPASS_VOD, '');
            const vodId = rest.split(':')[0];
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const result = await rugbypass.getVodStream(vodId);
                    if (result.hasDrm) {
                        return {
                            streams: [{
                                name: 'RugbyPass TV',
                                title: 'Contenu protégé (DRM)',
                                externalUrl: 'https://rugbypass.tv'
                            }]
                        };
                    }
                    if (result.streamUrl) {
                        const stream = {
                            name: 'RugbyPass TV',
                            title: `${result.vod?.title || 'Replay Rugby'}\n🏉 RugbyPass TV`,
                            url: result.streamUrl,
                            behaviorHints: { notWebReady: false }
                        };
                        if (result.subtitles?.length) {
                            stream.subtitles = result.subtitles
                                .filter(s => s.format === 'vtt' || s.format === 'srt')
                                .map(s => ({ id: s.lang, url: s.url, lang: s.lang }));
                        }
                        return { streams: [stream] };
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur stream RugbyPass VOD:', e.message);
                }
            }
        }

        // RugbyPass Playlist (format: tvlegal:rugbypass:playlist:ID:season:episode)
        if (id.startsWith(ID_PREFIX.RUGBYPASS_PLAYLIST)) {
            const rest = id.replace(ID_PREFIX.RUGBYPASS_PLAYLIST, '');
            const parts = rest.split(':');
            const playlistId = parts[0];
            const episodeNum = parts[2] ? parseInt(parts[2]) : 1;
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const playlist = await rugbypass.getPlaylist(playlistId);
                    const vodIndex = episodeNum - 1;
                    if (playlist.vods.length > vodIndex) {
                        const vod = playlist.vods[vodIndex];
                        const result = await rugbypass.getVodStream(vod.id);
                        if (result.hasDrm) {
                            return {
                                streams: [{
                                    name: 'RugbyPass TV',
                                    title: 'Contenu protégé (DRM)',
                                    externalUrl: 'https://rugbypass.tv'
                                }]
                            };
                        }
                        if (result.streamUrl) {
                            const stream = {
                                name: 'RugbyPass TV',
                                title: `${vod.title || 'Rugby'}\n🏉 RugbyPass TV`,
                                url: result.streamUrl,
                                behaviorHints: { notWebReady: false }
                            };
                            if (result.subtitles?.length) {
                                stream.subtitles = result.subtitles
                                    .filter(s => s.format === 'vtt' || s.format === 'srt')
                                    .map(s => ({ id: s.lang, url: s.url, lang: s.lang }));
                            }
                            return { streams: [stream] };
                        }
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur stream RugbyPass playlist:', e.message);
                }
            }
        }

        // RugbyPass Section Bucket (format: tvlegal:rugbypass:sb:SECTION:EXID:season:episode)
        if (id.startsWith(ID_PREFIX.RUGBYPASS_SECTION_BUCKET)) {
            const rest = id.replace(ID_PREFIX.RUGBYPASS_SECTION_BUCKET, '');
            const parts = rest.split(':');
            const sectionName = parts[0];
            const bucketExid = parts[1];
            const episodeNum = parts[3] ? parseInt(parts[3]) : 1;
            const rugbypass = getRugbyPassClient(currentConfig);
            if (rugbypass) {
                try {
                    const bucket = await rugbypass.getSectionBucketContent(sectionName, bucketExid);
                    const vodIndex = episodeNum - 1;
                    if (bucket.vods.length > vodIndex) {
                        const vod = bucket.vods[vodIndex];
                        const result = await rugbypass.getVodStream(vod.id);
                        if (result.hasDrm) {
                            return {
                                streams: [{
                                    name: 'RugbyPass TV',
                                    title: 'Contenu protégé (DRM)',
                                    externalUrl: 'https://rugbypass.tv'
                                }]
                            };
                        }
                        if (result.streamUrl) {
                            const stream = {
                                name: 'RugbyPass TV',
                                title: `${vod.title || 'Rugby'}\n🏉 RugbyPass TV`,
                                url: result.streamUrl,
                                behaviorHints: { notWebReady: false }
                            };
                            if (result.subtitles?.length) {
                                stream.subtitles = result.subtitles
                                    .filter(s => s.format === 'vtt' || s.format === 'srt')
                                    .map(s => ({ id: s.lang, url: s.url, lang: s.lang }));
                            }
                            return { streams: [stream] };
                        }
                    }
                } catch (e) {
                    console.error('[TV Legal] Erreur stream RugbyPass section bucket:', e.message);
                }
            }
        }

        return { streams: [] };

    } catch (error) {
        console.error('[TV Legal] Erreur stream:', error.message);
        return { streams: [] };
    }
});

// Serveur Express avec CORS
const app = express();

// CORS pour Stremio (important pour Stremio Web)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Page de configuration
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'configure.html'));
});

// Page de configuration avec config existante (pour reconfigurer depuis Stremio)
app.get('/:config/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'configure.html'));
});

// Redirection racine vers configure
app.get('/', (req, res) => {
    res.redirect('/configure');
});

// Manifest par défaut (sans config) - DOIT être avant /:config
app.get('/manifest.json', (req, res) => {
    res.json(getManifest(null));
});

// Routes avec configuration encodée
app.get('/:config/manifest.json', (req, res) => {
    const config = parseConfig(req.params.config);
    if (!config) {
        return res.status(400).json({ error: 'Invalid configuration' });
    }
    res.json(getManifest(config));
});

// Stockage temporaire de la config pour les handlers
let currentConfig = null;

// Routes Stremio SDK par défaut (sans config) - gère /catalog, /meta, /stream
app.use(getRouter(builder.getInterface()));

// Middleware pour parser la config des routes Stremio (/:config/catalog, etc.)
app.use('/:config', (req, res, next) => {
    const config = parseConfig(req.params.config);
    if (!config) {
        // Config invalide - pas une route avec config
        return next('route');
    }
    req.userConfig = config;
    currentConfig = config;
    next();
});

// Routes Stremio SDK avec config (/:config/catalog, /:config/meta, /:config/stream)
app.use('/:config', getRouter(builder.getInterface()));

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║         TV Legal France - Stremio v1.4.0           ║
╠════════════════════════════════════════════════════╣
║  Sources légales :                                 ║
║  ✓ France.tv (direct + replay)                     ║
║  ✓ Arte.tv (direct + replay)                       ║
║  ${tf1Default.isConfigured() ? '✓' : '○'} TF1+ (direct) ${tf1Default.isConfigured() ? '' : '- non configuré'}                     ║
║  ${rugbypassDefault ? '✓' : '○'} RugbyPass TV (live + replay) ${rugbypassDefault ? '' : '- non configuré'}       ║
╠════════════════════════════════════════════════════╣
║  Catalogues :                                      ║
║  📺 Directs  🎬 Films  📺 Séries  🎥 Docs          ║
║  📡 Émissions  ⚽ Sport  🏉 Rugby                  ║
╠════════════════════════════════════════════════════╣
║  Configuration: http://localhost:${PORT}/configure      ║
║  Manifest: http://localhost:${PORT}/manifest.json       ║
╚════════════════════════════════════════════════════╝
`);
});
