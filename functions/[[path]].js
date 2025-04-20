// functions/[[path]].js - Kod dla Cloudflare Pages Functions

// Import pozostaje taki sam, bo Cloudflare nadal użyje package.json
import { addonBuilder } from 'stremio-addon-sdk';

// --- Konfiguracja Addona (bez zmian) ---
const MDBLIST_MAIN_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3";
const MDBLIST_API_ITEMS_URL = "https://api.mdblist.com/lists";
const MDBLIST_API_USERLISTS_URL = "https://mdblist.com/api/lists/user/";
const ADDON_ID = "community.mdblist.importer.functions"; // Nowe ID dla tej metody

const MANIFEST_TEMPLATE = {
  id: ADDON_ID, version: "1.3.0", name: "MDblist Importer (Functions)",
  description: "Importuj wybrane listy z MDblist.com używając swojego klucza API.",
  resources: ["catalog"], types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "mdblist_movies", name: "MDblist – Movie Lists" },
    { type: "series", id: "mdblist_series", name: "MDblist – Series Lists" }
  ],
};

// --- Funkcje pomocnicze (fetchListItems, getCatalog - bez zmian) ---
async function fetchListItems(slug, apiKey = MDBLIST_MAIN_API_KEY) { /* ... kod bez zmian ... */
    const url = `${MDBLIST_API_ITEMS_URL}/${slug}/items?apiKey=${apiKey}`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.3.0' } });
        if (!res.ok) { throw new Error(`API Error ${res.status}`); }
        const data = await res.json();
        return data.items || [];
    } catch (error) { console.error(`Failed fetch items "${slug}":`, error); return []; }
}
async function getCatalog(type, config) { /* ... kod bez zmian ... */
    const listSlugsString = config.listSlug;
    if (!listSlugsString) { return { metas: [] }; }
    const slugs = [...new Set(listSlugsString.split(',').map(s => s.trim()).filter(s => s))];
    if (slugs.length === 0) { return { metas: [] }; }
    try {
        const promises = slugs.map(slug => fetchListItems(slug, MDBLIST_MAIN_API_KEY));
        const results = await Promise.all(promises);
        const allItems = results.flat();
        const uniqueMetas = new Map();
        allItems.filter(item => item && item.type === type && item.tmdbId)
        .forEach(item => {
            const itemId = item.tmdbId.toString();
            if (!uniqueMetas.has(itemId)) {
            let posterUrl = item.poster;
            if (posterUrl && posterUrl.startsWith('//')) { posterUrl = 'https:' + posterUrl; }
            uniqueMetas.set(itemId, { id: `tmdb:${itemId}`, type: type, name: item.title || `Untitled TMDB ${itemId}`,
                poster: posterUrl, releaseInfo: item.year ? item.year.toString() : undefined, });
            }
        });
        return { metas: Array.from(uniqueMetas.values()) };
    } catch (error) { console.error("Catalog error:", error); return { metas: [] }; }
}
// --- Logika pobierania LIST UŻYTKOWNIKA (nadal potrzebna, ale teraz będzie w głównym handlerze) ---
async function fetchUserLists(userApiKey) { /* ... kod bez zmian ... */
    if (!userApiKey) { throw new Error("User API Key is required"); }
    const url = `${MDBLIST_API_USERLISTS_URL}?apikey=${encodeURIComponent(userApiKey)}`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.3.0 ConfigProxy' } });
        if (!res.ok) {
            const errorBody = await res.text().catch(() => `Status: ${res.status} ${res.statusText}`);
            throw new Error(`Błąd API MDblist (${res.status}) pobierania list: ${errorBody.substring(0,100)}...`);
        }
        const contentType = res.headers.get("content-type");
         if (!contentType || !(contentType.includes("application/json") || contentType.includes("text/javascript")) ) {
            const textBody = await res.text().catch(() => 'Could not read body');
            if (textBody.toLowerCase().includes("invalid api key") || textBody.toLowerCase().includes("invalid apikey")) { throw new Error("Nieprawidłowy klucz API MDblist."); }
             else if (textBody.toLowerCase().includes("no lists found")) { return []; }
            throw new Error(`Nieoczekiwana odpowiedź API MDblist (oczekiwano JSON, otrzymano ${contentType}).`);
        }
        const data = await res.json();
        if (Array.isArray(data.lists)) { return data.lists; }
         else if (Array.isArray(data)) { return data; }
         else if (data.lists === null && data.count === 0) { return []; }
         else { throw new Error("Nieprawidłowy format odpowiedzi API MDblist (listy)."); }
    } catch (error) { console.error(`Failed fetch user lists:`, error); throw error; }
}


// --- Nowy sposób obsługi żądań dla Cloudflare Pages Functions ---
// Funkcja onRequest będzie wywoływana dla każdego żądania pasującego do ścieżki [[path]].js
export async function onRequest(context) {
    // context zawiera informacje o żądaniu, w tym `request` i `params`
    const { request, params, env } = context; // env może być użyte do zmiennych środowiskowych później
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    // *** Pobieramy ścieżkę z `params.path`, która jest tablicą segmentów URL ***
    // Łączymy segmenty, aby uzyskać pełną ścieżkę względną
    const pathSegments = params.path || [];
    const pathname = '/' + pathSegments.join('/');

    // Nagłówki CORS
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    };

    // Globalny try...catch dla bezpieczeństwa
    try {
        // Obsługa preflight CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // --- Routing na podstawie zrekonstruowanej ścieżki ---

        // Strona główna (powinna teraz pasować, gdy pathSegments jest puste)
        if (pathname === "/") {
             const landingHTML = `<!DOCTYPE html><html><head><title>MDblist Addon</title><style>body{font-family: sans-serif; padding: 2em; background: #222; color: #eee;}</style></head><body><h1>MDblist Importer (Functions Mode)</h1><p>Worker Functions działa! Path: '${pathname}'</p></body></html>`;
            return new Response(landingHTML, {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // Endpoint API do ładowania list
        if (pathname === '/api/get-user-lists' && request.method === 'POST') {
            try {
                const body = await request.json();
                const userApiKey = body.apiKey;
                if (!userApiKey) { throw new Error("Brak klucza apiKey w zapytaniu"); }
                const lists = await fetchUserLists(userApiKey);
                return new Response(JSON.stringify({ lists: lists }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (err) {
                const errorMessage = (err instanceof Error && err.message) ? err.message : "Nieznany błąd /api/get-user-lists.";
                let status = (errorMessage.includes("API MDblist") || errorMessage.includes("Nieprawidłowy klucz API")) ? 400 : 500;
                return new Response(JSON.stringify({ error: errorMessage }), {
                    status: status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // Manifest
        if (pathname === '/manifest.json') {
            const config = Object.fromEntries(searchParams.entries());
            const manifest = JSON.parse(JSON.stringify(MANIFEST_TEMPLATE));
            const listSlugParam = config.listSlug ? `?listSlug=${encodeURIComponent(config.listSlug)}` : '';
            manifest.catalogs = manifest.catalogs.map(catalog => ({
                ...catalog,
                id: `${catalog.id}_${(config.listSlug || 'all').replace(/[^a-zA-Z0-9]/g, '_')}`,
                // Ważne: url.origin zawiera pełny adres wdrożenia
                url: `${url.origin}/catalog/${catalog.type}/${catalog.id}.json${listSlugParam}`
            }));
            manifest.catalogs.forEach(cat => delete cat.extra);
            return new Response(JSON.stringify(manifest), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Katalog
        const catalogMatch = pathname.match(/^\/catalog\/(\w+)\/([\w-]+)\.json$/);
        if (catalogMatch) {
            const type = catalogMatch[1];
            const config = Object.fromEntries(searchParams.entries());
            if (!config.listSlug) {
                return new Response(JSON.stringify({ err: "Missing listSlug parameter" }), {
                    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            try {
                const result = await getCatalog(type, config);
                return new Response(JSON.stringify(result), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (err) {
                return new Response(JSON.stringify({ error: "Internal Server Error generating catalog", details: err.message }), {
                    status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // Jeśli żadna ścieżka nie pasuje
        return new Response(`Functions: Path '${pathname}' not handled. Full URL: ${request.url}`, {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        });

    } catch (err) { // Globalny catch dla całego onRequest
        console.error("!!! Global Functions Error !!!:", err); // Nadal niewidoczne bez logów
        return new Response(`Worker Runtime Error:\n${err}\n${err.stack}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}
