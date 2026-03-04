/**
 * Module d'extraction de clés Widevine via pywidevine
 *
 * Nécessite :
 * - Python 3 avec pywidevine installé (pip install pywidevine)
 * - Un fichier device.wvd dans le dossier du projet (fourni par l'utilisateur)
 *
 * L'addon ne fournit PAS le fichier device.wvd - l'utilisateur doit le fournir.
 *
 * @module lib/widevine
 */

const { spawn } = require('child_process');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Chemin vers le fichier WVD (dans le dossier du projet)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WVD_PATH = path.join(PROJECT_ROOT, 'device.wvd');

// ============================================================================
// CACHE DES CLÉS WIDEVINE
// Réduit drastiquement les requêtes vers les serveurs de licence
// ============================================================================

// Cache en mémoire : Map<psshHash, {keys, timestamp, licenseUrl}>
const keysCache = new Map();

// TTL du cache : 48 heures (les clés Widevine ne changent pas souvent)
const CACHE_TTL_MS = 48 * 60 * 60 * 1000;

// Fichier de persistance du cache (optionnel)
const CACHE_FILE = path.join(PROJECT_ROOT, '.widevine-keys-cache.json');

// Stats pour monitoring
const cacheStats = {
    hits: 0,
    misses: 0,
    saves: 0
};

/**
 * Génère un hash unique pour identifier un PSSH
 * @param {string} pssh - PSSH en base64
 * @param {string} licenseUrl - URL du serveur de licence (ignoré - les clés dépendent du PSSH uniquement)
 * @returns {string} - Hash SHA256 tronqué
 */
function getCacheKey(pssh, licenseUrl) {
    // On utilise SEULEMENT le PSSH car :
    // - Le PSSH identifie le contenu de façon unique
    // - Les clés Widevine sont les mêmes quel que soit le serveur de licence
    // - Le licenseUrl contient souvent des tokens dynamiques (timestamps, sessions)
    //   qui changeraient la clé de cache pour le même contenu
    return crypto.createHash('sha256').update(pssh).digest('hex').substring(0, 16);
}

/**
 * Charge le cache depuis le fichier de persistance
 */
function loadCacheFromDisk() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            let loaded = 0;
            let expired = 0;
            const now = Date.now();

            for (const [key, entry] of Object.entries(data)) {
                // Ne charger que les entrées non expirées
                if (now - entry.timestamp < CACHE_TTL_MS) {
                    keysCache.set(key, entry);
                    loaded++;
                } else {
                    expired++;
                }
            }

            if (loaded > 0 || expired > 0) {
                console.log(`[Widevine Cache] Chargé depuis disque: ${loaded} entrées (${expired} expirées ignorées)`);
            }
        }
    } catch (e) {
        console.warn('[Widevine Cache] Erreur chargement cache:', e.message);
    }
}

/**
 * Sauvegarde le cache sur disque
 */
function saveCacheToDisk() {
    try {
        const data = {};
        const now = Date.now();

        for (const [key, entry] of keysCache.entries()) {
            // Ne sauvegarder que les entrées non expirées
            if (now - entry.timestamp < CACHE_TTL_MS) {
                data[key] = entry;
            }
        }

        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
        cacheStats.saves++;
    } catch (e) {
        console.warn('[Widevine Cache] Erreur sauvegarde cache:', e.message);
    }
}

/**
 * Récupère les clés depuis le cache si disponibles et non expirées
 * @param {string} pssh - PSSH en base64
 * @param {string} licenseUrl - URL du serveur de licence
 * @returns {Array<{kid: string, key: string}>|null}
 */
function getFromCache(pssh, licenseUrl) {
    const cacheKey = getCacheKey(pssh, licenseUrl);
    const entry = keysCache.get(cacheKey);

    if (!entry) {
        return null;
    }

    // Vérifier expiration
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        keysCache.delete(cacheKey);
        return null;
    }

    return entry.keys;
}

/**
 * Stocke les clés dans le cache
 * @param {string} pssh - PSSH en base64
 * @param {string} licenseUrl - URL du serveur de licence
 * @param {Array<{kid: string, key: string}>} keys - Clés extraites
 */
function storeInCache(pssh, licenseUrl, keys) {
    const cacheKey = getCacheKey(pssh, licenseUrl);
    keysCache.set(cacheKey, {
        keys,
        timestamp: Date.now(),
        licenseUrl,
        psshPreview: pssh.substring(0, 20) + '...'
    });

    // Sauvegarder sur disque de façon asynchrone
    setImmediate(saveCacheToDisk);
}

/**
 * Retourne les statistiques du cache
 * @returns {{hits: number, misses: number, saves: number, size: number, hitRate: string}}
 */
function getCacheStats() {
    const total = cacheStats.hits + cacheStats.misses;
    const hitRate = total > 0 ? ((cacheStats.hits / total) * 100).toFixed(1) + '%' : 'N/A';
    return {
        ...cacheStats,
        size: keysCache.size,
        hitRate
    };
}

/**
 * Vide le cache (utile pour debug)
 */
function clearCache() {
    keysCache.clear();
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.saves = 0;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            fs.unlinkSync(CACHE_FILE);
        }
    } catch (e) {
        // Ignorer
    }
    console.log('[Widevine Cache] Cache vidé');
}

// Charger le cache au démarrage du module
loadCacheFromDisk();

/**
 * Vérifie si le fichier device.wvd existe et est valide
 * @returns {{available: boolean, error: string|null}}
 */
function checkAvailability() {
    // Vérifier que le fichier existe
    if (!fs.existsSync(WVD_PATH)) {
        return {
            available: false,
            error: `Fichier device.wvd non trouvé dans ${PROJECT_ROOT}`
        };
    }

    // Vérifier la taille minimale (un WVD valide fait au moins 1KB)
    const stats = fs.statSync(WVD_PATH);
    if (stats.size < 1000) {
        return {
            available: false,
            error: 'Fichier device.wvd trop petit, probablement invalide'
        };
    }

    // Vérifier le magic header WVD (commence par "WVD")
    const fd = fs.openSync(WVD_PATH, 'r');
    const buffer = Buffer.alloc(3);
    fs.readSync(fd, buffer, 0, 3, 0);
    fs.closeSync(fd);

    if (buffer.toString() !== 'WVD') {
        return {
            available: false,
            error: 'Fichier device.wvd invalide (mauvais format)'
        };
    }

    return { available: true, error: null };
}

/**
 * Vérifie si pywidevine est disponible
 * @returns {boolean}
 */
function isAvailable() {
    return checkAvailability().available;
}

/**
 * Extrait le PSSH depuis un manifest MPD
 * @param {string} mpdUrl - URL du manifest MPD
 * @param {string} [authToken] - Token d'authentification optionnel
 * @returns {Promise<string|null>} - PSSH en base64 ou null
 */
async function extractPsshFromMpd(mpdUrl, authToken = null) {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(mpdUrl, { headers });
        if (!response.ok) {
            console.error('[Widevine] Erreur fetch MPD:', response.status);
            return null;
        }

        const mpd = await response.text();

        // UUID Widevine en bytes pour identification
        const WIDEVINE_UUID = 'edef8ba979d64acea3c827dcd51d21ed';

        // Méthode 1: Chercher dans ContentProtection avec schemeIdUri Widevine
        const widevineSection = mpd.match(
            /<ContentProtection[^>]*schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"[^>]*>[\s\S]*?<\/ContentProtection>/i
        );
        if (widevineSection) {
            const psshInSection = widevineSection[0].match(/<(?:cenc:)?pssh[^>]*>([A-Za-z0-9+/=]+)<\/(?:cenc:)?pssh>/i);
            if (psshInSection) {
                console.log('[Widevine] PSSH extrait de ContentProtection Widevine');
                return psshInSection[1];
            }
        }

        // Méthode 2: Trouver tous les PSSH et identifier celui de Widevine
        const allPsshs = mpd.match(/<cenc:pssh[^>]*>([A-Za-z0-9+/=]+)<\/cenc:pssh>/g) || [];
        for (const psshTag of allPsshs) {
            const psshMatch = psshTag.match(/>([A-Za-z0-9+/=]+)</);
            if (psshMatch) {
                const psshB64 = psshMatch[1];
                try {
                    // Décoder le PSSH et vérifier l'UUID
                    const psshBytes = Buffer.from(psshB64, 'base64');
                    const psshHex = psshBytes.toString('hex');
                    if (psshHex.includes(WIDEVINE_UUID)) {
                        console.log('[Widevine] PSSH Widevine identifié parmi', allPsshs.length, 'PSSH(s)');
                        return psshB64;
                    }
                } catch (e) {
                    // Ignorer les erreurs de décodage
                }
            }
        }

        console.warn('[Widevine] PSSH Widevine non trouvé dans le MPD');
        return null;
    } catch (e) {
        console.error('[Widevine] Erreur extraction PSSH:', e.message);
        return null;
    }
}

/**
 * Extrait les clés Widevine via pywidevine (avec cache)
 * @param {string} pssh - PSSH en base64
 * @param {string} licenseUrl - URL du serveur de licence
 * @param {Object} [headers] - Headers pour la requête de licence
 * @param {Object} [options] - Options supplémentaires
 * @param {boolean} [options.skipCache=false] - Ignorer le cache (forcer refresh)
 * @returns {Promise<Array<{kid: string, key: string}>|null>} - Tableau de clés ou null
 */
async function extractKeys(pssh, licenseUrl, headers = {}, options = {}) {
    if (!WVD_PATH) {
        console.error('[Widevine] WVD_PATH non configuré');
        return null;
    }

    // Vérifier le cache d'abord (sauf si skipCache)
    if (!options.skipCache) {
        const cachedKeys = getFromCache(pssh, licenseUrl);
        if (cachedKeys) {
            cacheStats.hits++;
            console.log(`[Widevine Cache] HIT - ${cachedKeys.length} clé(s) depuis cache (stats: ${cacheStats.hits} hits, ${cacheStats.misses} misses)`);
            return cachedKeys;
        }
    }
    cacheStats.misses++;
    console.log(`[Widevine Cache] MISS - extraction via pywidevine...`);

    return new Promise((resolve) => {
        // Script Python inline pour extraire les clés
        const pythonScript = `
import sys
import json
import base64
from pywidevine.cdm import Cdm
from pywidevine.device import Device
from pywidevine.pssh import PSSH
import requests

try:
    wvd_path = sys.argv[1]
    pssh_b64 = sys.argv[2]
    license_url = sys.argv[3]
    headers_json = sys.argv[4] if len(sys.argv) > 4 else '{}'

    headers = json.loads(headers_json)

    # Charger le device
    device = Device.load(wvd_path)
    cdm = Cdm.from_device(device)

    # Parser le PSSH
    pssh = PSSH(pssh_b64)

    # Ouvrir une session et générer le challenge
    session_id = cdm.open()
    challenge = cdm.get_license_challenge(session_id, pssh)

    # Envoyer le challenge au serveur de licence
    response = requests.post(
        license_url,
        data=challenge,
        headers={
            'Content-Type': 'application/octet-stream',
            **headers
        }
    )

    if response.status_code != 200:
        print(json.dumps({'error': f'License request failed: {response.status_code}'}))
        sys.exit(1)

    # Parser la licence
    cdm.parse_license(session_id, response.content)

    # Extraire les clés
    keys = []
    for key in cdm.get_keys(session_id):
        if key.type == 'CONTENT':
            keys.append({
                'kid': key.kid.hex,
                'key': key.key.hex()
            })

    cdm.close(session_id)

    print(json.dumps({'keys': keys}))

except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
`;

        const headersJson = JSON.stringify(headers);

        const python = spawn('python3', ['-c', pythonScript, WVD_PATH, pssh, licenseUrl, headersJson], {
            timeout: 30000
        });

        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        python.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        python.on('close', (code) => {
            if (code !== 0) {
                console.error('[Widevine] Python exit code:', code);
                console.error('[Widevine] stderr:', stderr);
                console.error('[Widevine] stdout:', stdout);
                resolve(null);
                return;
            }

            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) {
                    console.error('[Widevine] Erreur:', result.error);
                    resolve(null);
                    return;
                }
                console.log(`[Widevine] ${result.keys.length} clé(s) extraite(s) via pywidevine`);

                // Stocker dans le cache pour les prochaines requêtes
                if (result.keys && result.keys.length > 0) {
                    storeInCache(pssh, licenseUrl, result.keys);
                    console.log(`[Widevine Cache] Clés stockées (taille cache: ${keysCache.size})`);
                }

                resolve(result.keys);
            } catch (e) {
                console.error('[Widevine] Erreur parsing JSON:', e.message);
                console.error('[Widevine] stdout:', stdout);
                resolve(null);
            }
        });

        python.on('error', (err) => {
            console.error('[Widevine] Erreur spawn python:', err.message);
            resolve(null);
        });
    });
}

/**
 * Extrait les clés depuis un MPD et une URL de licence
 * Combine extractPsshFromMpd + extractKeys
 *
 * @param {string} mpdUrl - URL du manifest MPD
 * @param {string} licenseUrl - URL du serveur de licence
 * @param {string} [authToken] - Token d'authentification
 * @returns {Promise<Array<{kid: string, key: string}>|null>}
 */
async function extractKeysFromMpd(mpdUrl, licenseUrl, authToken = null) {
    const pssh = await extractPsshFromMpd(mpdUrl, authToken);
    if (!pssh) {
        return null;
    }

    const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
    return extractKeys(pssh, licenseUrl, headers);
}

module.exports = {
    isAvailable,
    checkAvailability,
    extractPsshFromMpd,
    extractKeys,
    extractKeysFromMpd,
    WVD_PATH,
    // Fonctions de gestion du cache
    getCacheStats,
    clearCache
};
