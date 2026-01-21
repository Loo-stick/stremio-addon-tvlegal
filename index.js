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

const PORT = process.env.PORT || 7001;

// Clients
const francetv = new FranceTVClient();
const arte = new ArteClient();
const tf1 = new TF1Client();

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

    // Séries
    { type: 'series', id: 'tvlegal-series', name: '📺 Séries', extra: [{ name: 'skip', isRequired: false }] },

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
    version: '1.2.0',
    name: 'TV Legal France',
    description: 'Chaînes françaises légales : France.tv, Arte.tv, TF1+ - Films, Séries, Documentaires, Émissions',
    logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/4/43/TNT_France_logo.svg/200px-TNT_France_logo.svg.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv', 'movie', 'series'],
    catalogs,
    idPrefixes: ['tvlegal:'],
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

        // === SÉRIES (Arte + France.tv) ===
        if (id === 'tvlegal-series') {
            const metas = [];

            // Arte Séries
            try {
                const arteVideos = await arte.getCategory('SER');
                for (const video of arteVideos) {
                    metas.push({
                        id: `${ID_PREFIX.ARTE_VIDEO}${video.programId}`,
                        type: 'series',
                        name: video.title,
                        poster: video.imageLarge || video.image,
                        posterShape: 'poster',
                        description: video.description || video.subtitle,
                        background: video.imageLarge,
                        releaseInfo: video.durationLabel
                    });
                }
            } catch (e) {
                console.error('[TV Legal] Erreur Arte Séries:', e.message);
            }

            // France.tv Séries & Fictions
            try {
                const ftvVideos = await francetv.getChannelContent('series-et-fictions');
                for (const video of ftvVideos) {
                    if (video.isProgram) {
                        metas.push({
                            id: `${ID_PREFIX.FRANCETV_PROGRAM}${video.programPath}`,
                            type: 'series',
                            name: video.title,
                            poster: video.poster || video.image,
                            posterShape: 'poster',
                            description: video.description,
                            background: video.image
                        });
                    }
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

            console.log(`[TV Legal] ${unique.length} séries`);
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
