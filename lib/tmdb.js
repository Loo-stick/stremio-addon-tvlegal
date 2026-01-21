/**
 * Client TMDB pour Stremio Cataloog Addon
 *
 * @description Gère les appels à l'API TMDB avec cache
 */

const fetch = require('node-fetch');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p';
const METAHUB_URL = 'https://images.metahub.space';

// Mapping des IDs de genre TMDB vers les noms
const GENRE_MAP = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Sci-Fi',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
    // Genres TV
    10759: 'Action & Adventure',
    10762: 'Kids',
    10763: 'News',
    10764: 'Reality',
    10765: 'Sci-Fi & Fantasy',
    10766: 'Soap',
    10767: 'Talk',
    10768: 'War & Politics'
};

// Cache en mémoire (TTL: 30 minutes)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Récupère depuis le cache ou exécute la fonction
 *
 * @param {string} key - Clé de cache
 * @param {Function} fn - Fonction à exécuter si cache miss
 * @returns {Promise<any>}
 */
async function cached(key, fn) {
    const now = Date.now();
    const entry = cache.get(key);

    if (entry && (now - entry.timestamp) < CACHE_TTL) {
        console.log(`[TMDB] Cache hit: ${key}`);
        return entry.data;
    }

    console.log(`[TMDB] Cache miss: ${key}`);
    const data = await fn();
    cache.set(key, { data, timestamp: now });
    return data;
}

/**
 * Client TMDB
 */
class TMDBClient {
    /**
     * @param {string} apiKey - Clé API TMDB
     * @param {string} language - Langue (défaut: fr-FR)
     */
    constructor(apiKey, language = 'fr-FR') {
        this.apiKey = apiKey;
        this.language = language;
        this.imdbCache = new Map(); // Cache des IDs IMDb
    }

    /**
     * Effectue une requête à l'API TMDB
     *
     * @param {string} endpoint - Endpoint API
     * @param {Object} params - Paramètres additionnels
     * @returns {Promise<Object>}
     * @private
     */
    async _fetch(endpoint, params = {}) {
        const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
        url.searchParams.set('api_key', this.apiKey);
        url.searchParams.set('language', this.language);

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, value);
            }
        }

        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Récupère l'ID IMDb d'un film
     *
     * @param {number} tmdbId - ID TMDB
     * @returns {Promise<string|null>} ID IMDb ou null
     * @private
     */
    async _getMovieImdbId(tmdbId) {
        if (this.imdbCache.has(`movie_${tmdbId}`)) {
            return this.imdbCache.get(`movie_${tmdbId}`);
        }

        try {
            const data = await this._fetch(`/movie/${tmdbId}/external_ids`);
            const imdbId = data.imdb_id || null;
            this.imdbCache.set(`movie_${tmdbId}`, imdbId);
            return imdbId;
        } catch (error) {
            return null;
        }
    }

    /**
     * Récupère l'ID IMDb d'une série
     *
     * @param {number} tmdbId - ID TMDB
     * @returns {Promise<string|null>} ID IMDb ou null
     * @private
     */
    async _getSeriesImdbId(tmdbId) {
        if (this.imdbCache.has(`series_${tmdbId}`)) {
            return this.imdbCache.get(`series_${tmdbId}`);
        }

        try {
            const data = await this._fetch(`/tv/${tmdbId}/external_ids`);
            const imdbId = data.imdb_id || null;
            this.imdbCache.set(`series_${tmdbId}`, imdbId);
            return imdbId;
        } catch (error) {
            return null;
        }
    }

    /**
     * Formate un film pour Stremio (avec récupération ID IMDb)
     *
     * @param {Object} movie - Film TMDB
     * @returns {Promise<Object|null>} Meta Stremio
     * @private
     */
    async _formatMovie(movie) {
        if (!movie || !movie.id) return null;

        // Récupère l'ID IMDb
        const imdbId = await this._getMovieImdbId(movie.id);

        // Skip si pas d'ID IMDb (nécessaire pour Stremio)
        if (!imdbId) return null;

        // Convertir les IDs de genre en noms
        const genreNames = (movie.genre_ids || [])
            .map(id => GENRE_MAP[id])
            .filter(Boolean);

        return {
            id: imdbId,
            imdb_id: imdbId,
            type: 'movie',
            name: movie.title || movie.original_title,
            poster: `${METAHUB_URL}/poster/medium/${imdbId}/img`,
            background: `${METAHUB_URL}/background/medium/${imdbId}/img`,
            logo: `${METAHUB_URL}/logo/medium/${imdbId}/img`,
            description: movie.overview,
            releaseInfo: movie.release_date?.substring(0, 4),
            imdbRating: movie.vote_average?.toFixed(1),
            year: movie.release_date?.substring(0, 4),
            genres: genreNames
        };
    }

    /**
     * Formate une série pour Stremio (avec récupération ID IMDb)
     *
     * @param {Object} series - Série TMDB
     * @returns {Promise<Object|null>} Meta Stremio
     * @private
     */
    async _formatSeries(series) {
        if (!series || !series.id) return null;

        // Récupère l'ID IMDb
        const imdbId = await this._getSeriesImdbId(series.id);

        // Skip si pas d'ID IMDb (nécessaire pour Stremio)
        if (!imdbId) return null;

        // Convertir les IDs de genre en noms
        const genreNames = (series.genre_ids || [])
            .map(id => GENRE_MAP[id])
            .filter(Boolean);

        return {
            id: imdbId,
            imdb_id: imdbId,
            type: 'series',
            name: series.name || series.original_name,
            poster: `${METAHUB_URL}/poster/medium/${imdbId}/img`,
            background: `${METAHUB_URL}/background/medium/${imdbId}/img`,
            logo: `${METAHUB_URL}/logo/medium/${imdbId}/img`,
            description: series.overview,
            releaseInfo: series.first_air_date?.substring(0, 4),
            imdbRating: series.vote_average?.toFixed(1),
            year: series.first_air_date?.substring(0, 4),
            genres: genreNames
        };
    }

    // ==================== TENDANCES ====================

    /**
     * Films tendances du jour
     */
    async getTrendingMoviesDay(page = 1) {
        return cached(`trending_movies_day_${page}`, async () => {
            const data = await this._fetch('/trending/movie/day', { page });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films tendances de la semaine
     */
    async getTrendingMoviesWeek(page = 1) {
        return cached(`trending_movies_week_${page}`, async () => {
            const data = await this._fetch('/trending/movie/week', { page });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Séries tendances du jour
     */
    async getTrendingSeriesDay(page = 1) {
        return cached(`trending_series_day_${page}`, async () => {
            const data = await this._fetch('/trending/tv/day', { page });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    /**
     * Séries tendances de la semaine
     */
    async getTrendingSeriesWeek(page = 1) {
        return cached(`trending_series_week_${page}`, async () => {
            const data = await this._fetch('/trending/tv/week', { page });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    // ==================== TOP & CLASSEMENTS ====================

    /**
     * Films les mieux notés
     */
    async getTopRatedMovies(page = 1) {
        return cached(`top_rated_movies_${page}`, async () => {
            const data = await this._fetch('/movie/top_rated', { page });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Séries les mieux notées
     */
    async getTopRatedSeries(page = 1) {
        return cached(`top_rated_series_${page}`, async () => {
            const data = await this._fetch('/tv/top_rated', { page });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films populaires
     */
    async getPopularMovies(page = 1) {
        return cached(`popular_movies_${page}`, async () => {
            const data = await this._fetch('/movie/popular', { page });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Pépites cachées (bien notés mais peu connus)
     */
    async getHiddenGems(page = 1) {
        return cached(`hidden_gems_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                sort_by: 'vote_average.desc',
                'vote_count.gte': 100,
                'vote_count.lte': 1000,
                'vote_average.gte': 7.5
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    // ==================== SORTIES ====================

    /**
     * Films actuellement au cinéma
     */
    async getNowPlayingMovies(page = 1) {
        return cached(`now_playing_${page}`, async () => {
            const data = await this._fetch('/movie/now_playing', { page, region: 'FR' });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films à venir
     */
    async getUpcomingMovies(page = 1) {
        return cached(`upcoming_${page}`, async () => {
            const data = await this._fetch('/movie/upcoming', { page, region: 'FR' });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    // ==================== PAR GENRE ====================

    /**
     * Films par genre
     *
     * @param {number} genreId - ID du genre TMDB
     */
    async getMoviesByGenre(genreId, page = 1) {
        return cached(`movies_genre_${genreId}_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_genres: genreId,
                sort_by: 'popularity.desc',
                'vote_count.gte': 50
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Séries par genre
     */
    async getSeriesByGenre(genreId, page = 1) {
        return cached(`series_genre_${genreId}_${page}`, async () => {
            const data = await this._fetch('/discover/tv', {
                page,
                with_genres: genreId,
                sort_by: 'popularity.desc',
                'vote_count.gte': 50
            });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    // ==================== SÉRIES SPÉCIALES ====================

    /**
     * Mini-séries (séries limitées) - triées par note
     */
    async getMiniSeries(page = 1) {
        return cached(`miniseries_${page}`, async () => {
            const data = await this._fetch('/discover/tv', {
                page,
                with_keywords: 11162, // Miniseries keyword
                sort_by: 'vote_average.desc',
                'vote_count.gte': 100
            });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    /**
     * K-Dramas (séries coréennes) - triées par note
     */
    async getKDramas(page = 1) {
        return cached(`kdramas_${page}`, async () => {
            const data = await this._fetch('/discover/tv', {
                page,
                with_origin_country: 'KR',
                sort_by: 'vote_average.desc',
                'vote_count.gte': 100
            });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    /**
     * Anime - triées par note
     */
    async getAnime(page = 1) {
        return cached(`anime_${page}`, async () => {
            const data = await this._fetch('/discover/tv', {
                page,
                with_genres: 16, // Animation
                with_origin_country: 'JP',
                sort_by: 'vote_average.desc',
                'vote_count.gte': 100
            });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    /**
     * Docu-séries - triées par note
     */
    async getDocuSeries(page = 1) {
        return cached(`docuseries_${page}`, async () => {
            const data = await this._fetch('/discover/tv', {
                page,
                with_genres: 99, // Documentary
                sort_by: 'vote_average.desc',
                'vote_count.gte': 50
            });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    // ==================== PAR PLATEFORME ====================

    /**
     * Films par plateforme de streaming
     *
     * @param {number} providerId - ID du provider TMDB
     * @param {string} region - Région (défaut: FR)
     */
    async getMoviesByProvider(providerId, page = 1, region = 'FR') {
        return cached(`movies_provider_${providerId}_${region}_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_watch_providers: providerId,
                watch_region: region,
                sort_by: 'popularity.desc'
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Séries par plateforme de streaming
     *
     * @param {number} providerId - ID du provider TMDB
     * @param {string} region - Région (défaut: FR)
     */
    async getSeriesByProvider(providerId, page = 1, region = 'FR') {
        return cached(`series_provider_${providerId}_${region}_${page}`, async () => {
            const data = await this._fetch('/discover/tv', {
                page,
                with_watch_providers: providerId,
                watch_region: region,
                sort_by: 'popularity.desc'
            });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    // ==================== PAR PAYS ====================

    /**
     * Films par pays d'origine
     *
     * @param {string} countryCode - Code pays ISO (FR, KR, JP, etc.)
     */
    async getMoviesByCountry(countryCode, page = 1) {
        return cached(`movies_country_${countryCode}_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_origin_country: countryCode,
                sort_by: 'popularity.desc',
                'vote_count.gte': 30
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    // ==================== THÉMATIQUES (KEYWORDS) ====================

    /**
     * Films par mot-clé/thématique
     *
     * @param {number} keywordId - ID du keyword TMDB
     */
    async getMoviesByKeyword(keywordId, page = 1) {
        return cached(`movies_keyword_${keywordId}_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_keywords: keywordId,
                sort_by: 'popularity.desc'
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films de Noël
     */
    async getChristmasMovies(page = 1) {
        // Keywords: christmas (207317), christmas eve (13082)
        return cached(`christmas_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_keywords: '207317|13082',
                sort_by: 'popularity.desc'
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films d'Halloween / Horreur
     */
    async getHalloweenMovies(page = 1) {
        // Keywords: halloween (4565)
        return cached(`halloween_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_keywords: '4565',
                with_genres: 27, // Horror
                sort_by: 'popularity.desc'
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films Feel Good
     */
    async getFeelGoodMovies(page = 1) {
        return cached(`feelgood_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_genres: '35,10751', // Comédie, Famille
                'vote_average.gte': 6.5,
                sort_by: 'popularity.desc'
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films Mind-Bending / Plot Twist
     */
    async getMindBendingMovies(page = 1) {
        // Keywords: twist ending (4344), mind bending (256741)
        return cached(`mindbending_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_keywords: '4344|256741|310',
                sort_by: 'vote_average.desc',
                'vote_count.gte': 100
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films Cultes
     */
    async getCultMovies(page = 1) {
        // Keyword: cult film (818)
        return cached(`cult_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_keywords: '818',
                sort_by: 'vote_count.desc'
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Films pour la famille
     */
    async getFamilyMovies(page = 1) {
        return cached(`family_${page}`, async () => {
            const data = await this._fetch('/discover/movie', {
                page,
                with_genres: 10751, // Family
                sort_by: 'popularity.desc',
                'vote_average.gte': 6
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    // ==================== RÉCOMPENSES ====================

    /**
     * Gagnants des Oscars (via collection/liste)
     * Note: TMDB n'a pas d'endpoint direct, on utilise une liste populaire
     */
    async getOscarWinners(page = 1) {
        return cached(`oscars_${page}`, async () => {
            // On utilise discover avec des films très bien notés et populaires
            const data = await this._fetch('/discover/movie', {
                page,
                sort_by: 'vote_average.desc',
                'vote_count.gte': 5000,
                'vote_average.gte': 8
            });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    // ==================== RECHERCHE ====================

    /**
     * Recherche de films (avec cache)
     */
    async searchMovies(query, page = 1) {
        return cached(`search_movie_${query}_${page}`, async () => {
            const data = await this._fetch('/search/movie', { query, page });
            const results = await Promise.all(data.results.map(m => this._formatMovie(m)));
            return results.filter(Boolean);
        });
    }

    /**
     * Recherche de séries (avec cache)
     */
    async searchSeries(query, page = 1) {
        return cached(`search_series_${query}_${page}`, async () => {
            const data = await this._fetch('/search/tv', { query, page });
            const results = await Promise.all(data.results.map(s => this._formatSeries(s)));
            return results.filter(Boolean);
        });
    }

    // ==================== DÉTAILS ====================

    /**
     * Détails d'un film
     */
    async getMovieDetails(movieId) {
        return cached(`movie_details_${movieId}`, async () => {
            const data = await this._fetch(`/movie/${movieId}`, {
                append_to_response: 'credits,external_ids'
            });

            const meta = this._formatMovie(data);
            if (!meta) return null;

            // Enrichir avec les détails
            meta.genres = data.genres?.map(g => g.name) || [];
            meta.runtime = data.runtime ? `${data.runtime} min` : null;
            meta.director = data.credits?.crew?.find(c => c.job === 'Director')?.name;
            meta.cast = data.credits?.cast?.slice(0, 5).map(c => c.name) || [];
            meta.imdb_id = data.external_ids?.imdb_id;

            // Convertir l'ID pour Stremio si on a l'IMDB ID
            if (meta.imdb_id) {
                meta.id = meta.imdb_id;
            }

            return meta;
        });
    }

    /**
     * Détails d'une série
     */
    async getSeriesDetails(seriesId) {
        return cached(`series_details_${seriesId}`, async () => {
            const data = await this._fetch(`/tv/${seriesId}`, {
                append_to_response: 'credits,external_ids'
            });

            const meta = this._formatSeries(data);
            if (!meta) return null;

            // Enrichir avec les détails
            meta.genres = data.genres?.map(g => g.name) || [];
            meta.runtime = data.episode_run_time?.[0] ? `${data.episode_run_time[0]} min/ep` : null;
            meta.cast = data.credits?.cast?.slice(0, 5).map(c => c.name) || [];
            meta.imdb_id = data.external_ids?.imdb_id;

            // Convertir l'ID pour Stremio si on a l'IMDB ID
            if (meta.imdb_id) {
                meta.id = meta.imdb_id;
            }

            return meta;
        });
    }

    // ==================== RECHERCHE PAR ID IMDB ====================

    /**
     * Trouve un contenu par son ID IMDB
     *
     * @param {string} imdbId - ID IMDB (ex: tt1234567)
     * @returns {Promise<Object|null>} Infos du contenu (title, type)
     */
    async findByImdbId(imdbId) {
        return cached(`imdb_${imdbId}`, async () => {
            try {
                const data = await this._fetch(`/find/${imdbId}`, {
                    external_source: 'imdb_id'
                });

                // Cherche dans les résultats TV d'abord, puis films
                if (data.tv_results && data.tv_results.length > 0) {
                    const tv = data.tv_results[0];
                    return {
                        title: tv.name || tv.original_name,
                        type: 'series',
                        tmdbId: tv.id,
                        year: tv.first_air_date?.substring(0, 4)
                    };
                }

                if (data.movie_results && data.movie_results.length > 0) {
                    const movie = data.movie_results[0];
                    return {
                        title: movie.title || movie.original_title,
                        type: 'movie',
                        tmdbId: movie.id,
                        year: movie.release_date?.substring(0, 4)
                    };
                }

                return null;
            } catch (error) {
                console.error(`[TMDB] Erreur findByImdbId ${imdbId}:`, error.message);
                return null;
            }
        });
    }
}

module.exports = TMDBClient;
