/**
 * Proxy DRM pour Stremio
 *
 * Permet la lecture de contenus Widevine dans Stremio en:
 * 1. Proxifiant vers le serveur Python de décryptage (port 8888)
 * 2. Le serveur Python extrait les clés Widevine et décrypte les segments
 *
 * 100% légal - utilise un compte TF1+ valide
 *
 * @module lib/drm-proxy
 */

const fetch = require('node-fetch');
const { URL } = require('url');

// URL du serveur Python de décryptage (local)
const DECRYPT_PROXY_URL = process.env.DECRYPT_PROXY_URL || 'http://localhost:8888';

/**
 * Configure les routes du proxy DRM sur une app Express
 * @param {Express.Application} app - L'app Express
 */
function setupDrmProxy(app) {

    /**
     * Endpoint /drm/mpd
     *
     * Fetch le MPD original et injecte dashif:Laurl pour la licence
     *
     * Query params:
     * - stream: URL du MPD original (encodé)
     * - license: URL du serveur de licence (encodé)
     * - token: Token d'authentification (encodé)
     */
    app.get('/drm/mpd', async (req, res) => {
        try {
            const { stream, license, token } = req.query;

            if (!stream || !license || !token) {
                return res.status(400).json({
                    error: 'Missing params: stream, license, token required'
                });
            }

            console.log('[DRM Proxy] Fetching MPD:', stream);

            // Fetch le MPD original
            const mpdResponse = await fetch(stream, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!mpdResponse.ok) {
                console.error('[DRM Proxy] MPD fetch failed:', mpdResponse.status);
                return res.status(502).json({ error: 'Failed to fetch MPD' });
            }

            let mpd = await mpdResponse.text();

            // Construire l'URL du proxy licence (forcer HTTPS pour Android)
            const host = req.get('host');
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const baseUrl = `${protocol}://${host}`;
            const proxyLicenseUrl = `${baseUrl}/drm/license?` +
                `token=${encodeURIComponent(token)}&` +
                `target=${encodeURIComponent(license)}`;

            console.log('[DRM Proxy] Injecting license URL:', proxyLicenseUrl);

            // Ajouter le namespace dashif si pas présent
            if (!mpd.includes('xmlns:dashif')) {
                mpd = mpd.replace(
                    '<MPD',
                    '<MPD xmlns:dashif="https://dashif.org/"'
                );
            }

            // Injecter dashif:Laurl dans ContentProtection Widevine
            // UUID Widevine: edef8ba9-79d6-4ace-a3c8-27dcd51d21ed
            const widevineUUID = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';

            // Pattern pour trouver ContentProtection Widevine (avec ou sans contenu)
            const cpRegex = new RegExp(
                `(<ContentProtection[^>]*schemeIdUri=["']urn:uuid:${widevineUUID}["'][^>]*)(/>|>([\\s\\S]*?)</ContentProtection>)`,
                'gi'
            );

            mpd = mpd.replace(cpRegex, (match, openTag, closeTag, content) => {
                // Si déjà un dashif:Laurl, ne pas dupliquer
                if (match.includes('dashif:Laurl')) {
                    return match;
                }

                // Format conforme DASH-IF avec licenseType="EME-1.0"
                const laurlTag = `<dashif:Laurl licenseType="EME-1.0">${proxyLicenseUrl}</dashif:Laurl>`;

                if (closeTag === '/>') {
                    // Self-closing tag, on l'ouvre
                    return `${openTag}>${laurlTag}</ContentProtection>`;
                } else {
                    // Tag avec contenu, on ajoute dashif:Laurl
                    return `${openTag}>${laurlTag}${content || ''}</ContentProtection>`;
                }
            });

            // Log pour debug
            if (mpd.includes('dashif:Laurl')) {
                console.log('[DRM Proxy] dashif:Laurl injected successfully');
            } else {
                console.warn('[DRM Proxy] Warning: dashif:Laurl may not have been injected');
            }

            // Retourner le MPD modifié
            res.set('Content-Type', 'application/dash+xml');
            res.set('Access-Control-Allow-Origin', '*');
            res.send(mpd);

        } catch (error) {
            console.error('[DRM Proxy] MPD error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Endpoint /drm/license
     *
     * Proxy la requête de licence vers le serveur DRM avec le token
     *
     * Query params:
     * - token: Token d'authentification
     * - target: URL du serveur de licence original
     *
     * Body: Challenge Widevine (binary)
     */
    app.post('/drm/license', async (req, res) => {
        try {
            const { token, target } = req.query;

            if (!token || !target) {
                return res.status(400).json({
                    error: 'Missing params: token, target required'
                });
            }

            console.log('[DRM Proxy] License request to:', target);

            // Collecter le body (challenge Widevine)
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks);

            console.log('[DRM Proxy] Challenge size:', body.length, 'bytes');

            // Forward vers le serveur de licence avec auth
            const licenseResponse = await fetch(target, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/octet-stream',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                body: body
            });

            if (!licenseResponse.ok) {
                const errorText = await licenseResponse.text();
                console.error('[DRM Proxy] License request failed:', licenseResponse.status, errorText);
                return res.status(licenseResponse.status).json({
                    error: 'License request failed',
                    details: errorText
                });
            }

            const licenseData = await licenseResponse.buffer();
            console.log('[DRM Proxy] License received:', licenseData.length, 'bytes');

            // Headers CORS pour que ExoPlayer puisse lire la réponse
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.set('Content-Type', 'application/octet-stream');

            res.send(licenseData);

        } catch (error) {
            console.error('[DRM Proxy] License error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // Preflight CORS pour /drm/license
    app.options('/drm/license', (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.sendStatus(204);
    });

    // ============================================================
    // Routes de proxy vers le serveur Python de décryptage
    // Le serveur Python (port 8888) fait l'extraction des clés
    // Widevine et le décryptage des segments en temps réel
    // ============================================================

    /**
     * Health check du serveur de décryptage
     */
    app.get('/decrypt/health', async (req, res) => {
        try {
            const response = await fetch(`${DECRYPT_PROXY_URL}/health`);
            const data = await response.text();
            res.set('Content-Type', 'application/json');
            res.send(data);
        } catch (error) {
            res.status(503).json({
                status: 'error',
                message: 'Decrypt server unavailable',
                error: error.message
            });
        }
    });

    /**
     * Proxy vers /stream/:videoId
     * Récupère le MPD modifié (sans DRM) avec les segments pointant vers notre proxy
     *
     * Query params passés au serveur Python:
     * - token: Token TF1
     * - mpd_url: URL du MPD original
     * - license_url: URL du serveur de licence Widevine
     */
    app.get('/decrypt/stream/:videoId', async (req, res) => {
        try {
            const { videoId } = req.params;
            const { token, mpd_url, license_url } = req.query;

            if (!token || !mpd_url || !license_url) {
                return res.status(400).json({
                    error: 'Missing params: token, mpd_url, license_url required'
                });
            }

            console.log(`[DRM Decrypt] Stream request for: ${videoId}`);

            // Construire l'URL du serveur Python
            const pythonUrl = `${DECRYPT_PROXY_URL}/stream/${videoId}?` +
                `token=${encodeURIComponent(token)}&` +
                `mpd_url=${encodeURIComponent(mpd_url)}&` +
                `license_url=${encodeURIComponent(license_url)}`;

            const response = await fetch(pythonUrl, { timeout: 60000 });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[DRM Decrypt] Python proxy error: ${response.status}`, errorText);
                return res.status(response.status).send(errorText);
            }

            let mpd = await response.text();

            // Le serveur Python retourne un MPD avec des URLs vers localhost:8888
            // On doit les remplacer par des URLs vers notre proxy Node.js (ce serveur)
            const host = req.get('host');
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const publicBaseUrl = `${protocol}://${host}`;

            // Remplacer http://localhost:8888/segment par notre /decrypt/segment
            // et http://192.168.x.x:8888/segment aussi
            mpd = mpd.replace(/http:\/\/(localhost|192\.168\.[0-9.]+):8888\/segment/g,
                `${publicBaseUrl}/decrypt/segment`);

            console.log(`[DRM Decrypt] MPD received, length: ${mpd.length}`);

            res.set('Content-Type', 'application/dash+xml');
            res.set('Access-Control-Allow-Origin', '*');
            res.send(mpd);

        } catch (error) {
            console.error('[DRM Decrypt] Stream error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Proxy vers /segment
     * Télécharge et décrypte un segment vidéo/audio
     *
     * Query params (passés par le serveur Python):
     * - video_id: ID de la vidéo TF1
     * - token: Token TF1 pour régénérer l'URL CDN
     * - keys: Clés de décryptage encodées en base64 (JSON)
     * - path: Chemin du segment (ajouté par ExoPlayer)
     */
    app.get('/decrypt/segment', async (req, res) => {
        try {
            const { video_id, token, keys, path } = req.query;

            if (!video_id || !token || !keys) {
                return res.status(400).json({
                    error: 'Missing params: video_id, token, keys required'
                });
            }

            // Forward vers le serveur Python avec tous les params
            const pythonUrl = `${DECRYPT_PROXY_URL}/segment?` +
                `video_id=${encodeURIComponent(video_id)}&` +
                `token=${encodeURIComponent(token)}&` +
                `keys=${encodeURIComponent(keys)}&` +
                `path=${encodeURIComponent(path || '')}`;

            const response = await fetch(pythonUrl, { timeout: 60000 });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[DRM Decrypt] Segment error: ${response.status}`, errorText);
                return res.status(response.status).send(errorText);
            }

            // Stream la réponse directement
            res.set('Content-Type', 'video/mp4');
            res.set('Access-Control-Allow-Origin', '*');

            // Pipe le contenu décrypté
            response.body.pipe(res);

        } catch (error) {
            console.error('[DRM Decrypt] Segment error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================
    // Routes MediaFlow Proxy (décryptage DASH → HLS)
    // MediaFlow tourne sur le port 8787 en local
    // ============================================================

    const MEDIAFLOW_URL = process.env.MEDIAFLOW_URL || 'http://localhost:8787';

    /**
     * Proxy vers MediaFlow /proxy/mpd/*
     * Permet d'accéder à MediaFlow via Cloudflare
     */
    app.get('/mediaflow/proxy/mpd/*', async (req, res) => {
        try {
            const subPath = req.params[0]; // manifest.m3u8, playlist.m3u8, segment.mp4
            const queryString = require('url').parse(req.url).query || '';

            const mediaflowUrl = `${MEDIAFLOW_URL}/proxy/mpd/${subPath}?${queryString}`;
            console.log(`[MediaFlow] Proxying: ${subPath}`);

            const response = await fetch(mediaflowUrl, { timeout: 60000 });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[MediaFlow] Error: ${response.status}`, errorText.substring(0, 200));
                return res.status(response.status).send(errorText);
            }

            // Copier les headers pertinents
            const contentType = response.headers.get('content-type');
            if (contentType) {
                res.set('Content-Type', contentType);
            }
            res.set('Access-Control-Allow-Origin', '*');

            // Si c'est un manifest HLS, réécrire les URLs localhost vers notre proxy
            if (subPath.endsWith('.m3u8')) {
                let content = await response.text();
                const host = req.get('host');
                const protocol = host.includes('localhost') ? 'http' : 'https';
                const publicBase = `${protocol}://${host}`;

                // Remplacer localhost:8787 par notre URL publique
                content = content.replace(/http:\/\/localhost:8787\/proxy\/mpd\//g,
                    `${publicBase}/mediaflow/proxy/mpd/`);

                res.send(content);
            } else {
                // Pour les segments, streamer directement
                response.body.pipe(res);
            }

        } catch (error) {
            console.error('[MediaFlow] Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/mediaflow/health', async (req, res) => {
        try {
            const response = await fetch(`${MEDIAFLOW_URL}/health`);
            const data = await response.json();
            res.json(data);
        } catch (error) {
            res.status(503).json({ status: 'error', message: error.message });
        }
    });

    console.log('[DRM Proxy] Routes configured: /drm/mpd, /drm/license, /decrypt/*, /mediaflow/*');
}

/**
 * Génère l'URL du proxy DRM pour un stream
 *
 * @param {string} baseUrl - URL de base du serveur (ex: https://tvlegal.loostick.ovh)
 * @param {string} streamUrl - URL du MPD original
 * @param {string} licenseUrl - URL du serveur de licence
 * @param {string} token - Token d'authentification
 * @returns {string} URL du proxy MPD
 */
function getDrmProxyUrl(baseUrl, streamUrl, licenseUrl, token) {
    return `${baseUrl}/drm/mpd?` +
        `stream=${encodeURIComponent(streamUrl)}&` +
        `license=${encodeURIComponent(licenseUrl)}&` +
        `token=${encodeURIComponent(token)}`;
}

/**
 * Génère l'URL MediaFlow pour un stream DASH décrypté en HLS
 *
 * @param {string} baseUrl - URL de base du serveur (ex: https://tvlegal.loostick.ovh)
 * @param {string} mpdUrl - URL du MPD original
 * @param {string} keyId - Key ID en hex
 * @param {string} key - Clé de décryptage en hex
 * @returns {string} URL du HLS décrypté via MediaFlow
 */
function getMediaFlowUrl(baseUrl, mpdUrl, keyId, key) {
    // Convertir hex en base64 URL-safe
    const kidB64 = Buffer.from(keyId, 'hex').toString('base64url');
    const keyB64 = Buffer.from(key, 'hex').toString('base64url');

    return `${baseUrl}/mediaflow/proxy/mpd/manifest.m3u8?` +
        `d=${encodeURIComponent(mpdUrl)}&` +
        `key_id=${kidB64}&` +
        `key=${keyB64}`;
}

module.exports = {
    setupDrmProxy,
    getDrmProxyUrl,
    getMediaFlowUrl
};
