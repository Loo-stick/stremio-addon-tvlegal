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
const FranceTVClient = require('./lib/francetv');
const ArteClient = require('./lib/arte');
const TF1Client = require('./lib/tf1');
const TMDBClient = require('./lib/tmdb');

const PORT = process.env.PORT || 7001;

// Clients
const francetv = new FranceTVClient();
const arte = new ArteClient();
const tf1 = new TF1Client();
const tmdb = process.env.TMDB_API_KEY ? new TMDBClient(process.env.TMDB_API_KEY) : null;

if (tmdb) {
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
    TF1_LIVE: 'tvlegal:tf1:live:'
};

// Configuration des catalogues
const catalogs = [
    // Directs
    { type: 'tv', id: 'tvlegal-live', name: '📺 Directs' },

    // Films
    { type: 'movie', id: 'tvlegal-films', name: '🎬 Films', extra: [{ name: 'skip', isRequired: false }] },

    // Séries France.tv
    {
        type: 'series',
        id: 'tvlegal-series-francetv',
        name: '📺 Séries France.tv',
        extra: [
            { name: 'skip', isRequired: false },
            {
                name: 'genre',
                isRequired: false,
                options: ['Tous', 'Drame', 'Comédie', 'Policier', 'Thriller', 'Historique']
            }
        ]
    },

    // Séries Arte
    {
        type: 'series',
        id: 'tvlegal-series-arte',
        name: '📺 Séries Arte',
        extra: [
            { name: 'skip', isRequired: false },
            {
                name: 'genre',
                isRequired: false,
                options: ['Tous', 'Thriller', 'Policier', 'Comédie', 'Drame', 'Science-fiction', 'Historique']
            }
        ]
    },

    // Documentaires
    { type: 'movie', id: 'tvlegal-docs', name: '🎥 Documentaires', extra: [{ name: 'skip', isRequired: false }] },

    // Émissions TV
    { type: 'movie', id: 'tvlegal-emissions', name: '📡 Émissions TV', extra: [{ name: 'skip', isRequired: false }] },

    // Sport
    { type: 'movie', id: 'tvlegal-sport', name: '⚽ Sport', extra: [{ name: 'skip', isRequired: false }] },

    // Rugby
    { type: 'movie', id: 'tvlegal-rugby', name: '🏉 Rugby', extra: [{ name: 'skip', isRequired: false }] }
];

// Ajoute le catalogue TF1 si configuré
if (tf1.isConfigured()) {
    console.log('[TV Legal] TF1+ configuré (credentials détectés)');
} else {
    console.log('[TV Legal] TF1+ non configuré (TF1_EMAIL/TF1_PASSWORD absents)');
}

const manifest = {
    id: 'community.tvlegal.france',
    version: '1.3.0',
    name: 'TV Legal France',
    description: 'Chaînes françaises légales : France.tv, Arte.tv, TF1+ - Films, Séries, Documentaires, Émissions',
    logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/4/43/TNT_France_logo.svg/200px-TNT_France_logo.svg.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv', 'movie', 'series'],
    catalogs,
    idPrefixes: ['tvlegal:', 'tt'],
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

/**
 * Catalog Handler
 */
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`[TV Legal] Catalogue: ${type}/${id}`);
    const skip = parseInt(extra?.skip) || 0;

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

            console.log(`[TV Legal] ${metas.length} directs`);
            return { metas };
        }

        // === FILMS (Arte Cinéma) ===
        if (id === 'tvlegal-films') {
            const metas = [];

            try {
                const videos = await arte.getCategory('CIN');
                for (const video of videos) {
                    metas.push({
                        id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                        type: 'movie',
                        name: video.title,
                        poster: video.imageLarge || video.image,
                        posterShape: 'poster',
                        description: video.description || video.subtitle,
                        background: video.imageLarge,
                        releaseInfo: video.durationLabel
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte Films:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} films`);
            return { metas: metas.slice(skip, skip + 50) };
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
                    // Filtre par genre si demandé
                    if (genreFilter) {
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
            return { metas: unique.slice(skip, skip + 50) };
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

            try {
                const arteVideos = await arte.getCategory('SER');

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
                    // Filtre par genre si demandé
                    if (genreFilter) {
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
                        poster: video.imageLarge || video.image,
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

            console.log(`[TV Legal] ${unique.length} séries Arte (filtre: ${genre || 'aucun'})`);
            return { metas: unique.slice(skip, skip + 50) };
        }

        // === DOCUMENTAIRES (Arte) ===
        if (id === 'tvlegal-docs') {
            const metas = [];

            try {
                const videos = await arte.getCategory('DOR');
                for (const video of videos) {
                    metas.push({
                        id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                        type: 'movie',
                        name: video.title,
                        poster: video.imageLarge || video.image,
                        posterShape: 'poster',
                        description: video.description || video.subtitle,
                        background: video.imageLarge,
                        releaseInfo: video.durationLabel
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte Docs:', e.message);
            }

            console.log(`[TV Legal] ${metas.length} documentaires`);
            return { metas: metas.slice(skip, skip + 50) };
        }

        // === ÉMISSIONS TV (France.tv) ===
        if (id === 'tvlegal-emissions') {
            const metas = [];
            const channels = ['france-2', 'france-3', 'france-5', 'france-4', 'franceinfo'];

            for (const channelId of channels) {
                try {
                    const videos = await francetv.getChannelContent(channelId);
                    for (const video of videos.slice(0, 15)) {
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
                    console.error(`[TV Legal] Erreur FranceTV ${channelId}:`, e.message);
                }
            }

            // Déduplique
            const seen = new Set();
            const unique = metas.filter(m => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
            });

            console.log(`[TV Legal] ${unique.length} émissions`);
            return { metas: unique.slice(skip, skip + 50) };
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
            return { metas: metas.slice(skip, skip + 50) };
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
            return { metas: metas.slice(skip, skip + 50) };
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
                        background: info.image
                    }
                };
            }
        }

        // France.tv Video
        if (id.startsWith(ID_PREFIX.FRANCETV_VIDEO)) {
            const videoId = id.replace(ID_PREFIX.FRANCETV_VIDEO, '');
            const info = await francetv.getVideoInfo(videoId);
            if (info) {
                return {
                    meta: {
                        id,
                        type: 'movie',
                        name: info.title,
                        poster: info.image,
                        description: info.description,
                        background: info.image,
                        runtime: info.duration ? `${Math.round(info.duration / 60)} min` : undefined
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
                        videos
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
                    description: live?.subtitle || 'En direct sur Arte'
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

                const videos = episodes.map((ep, index) => ({
                    id: `${ID_PREFIX.ARTE_VIDEO}${ep.programId}`,
                    title: ep.subtitle || ep.title,
                    season: 1,
                    episode: index + 1,
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
                        videos
                    }
                };
            }

            const info = await arte.getVideoMeta(programId);
            if (info) {
                const image = info.images?.find(i => i.url)?.url?.replace('__SIZE__', '400x225');
                return {
                    meta: {
                        id,
                        type: type === 'series' ? 'series' : 'movie',
                        name: info.title,
                        poster: image,
                        description: info.description,
                        runtime: info.duration ? `${Math.round(info.duration / 60)} min` : undefined
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
                        background: info.preview
                    }
                };
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

// Routes Stremio SDK
app.use(getRouter(builder.getInterface()));

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║           TV Legal France - Stremio v1.1           ║
╠════════════════════════════════════════════════════╣
║  Sources légales :                                 ║
║  ✓ France.tv (direct + replay)                     ║
║  ✓ Arte.tv (direct + replay)                       ║
║  ${tf1.isConfigured() ? '✓' : '○'} TF1+ (direct) ${tf1.isConfigured() ? '' : '- non configuré'}                     ║
╠════════════════════════════════════════════════════╣
║  Catalogues :                                      ║
║  📺 Directs  🎬 Films  📺 Séries  🎥 Docs          ║
║  📡 Émissions  ⚽ Sport  🏉 Rugby                  ║
╠════════════════════════════════════════════════════╣
║  Port: ${PORT}                                          ║
║  Manifest: http://localhost:${PORT}/manifest.json       ║
╚════════════════════════════════════════════════════╝
`);
});
