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

// Chemin vers le fichier WVD (dans le dossier du projet)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WVD_PATH = path.join(PROJECT_ROOT, 'device.wvd');

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
 * Extrait les clés Widevine via pywidevine
 * @param {string} pssh - PSSH en base64
 * @param {string} licenseUrl - URL du serveur de licence
 * @param {Object} [headers] - Headers pour la requête de licence
 * @returns {Promise<Array<{kid: string, key: string}>|null>} - Tableau de clés ou null
 */
async function extractKeys(pssh, licenseUrl, headers = {}) {
    if (!WVD_PATH) {
        console.error('[Widevine] WVD_PATH non configuré');
        return null;
    }

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
                console.log(`[Widevine] ${result.keys.length} clé(s) extraite(s)`);
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
    WVD_PATH
};
