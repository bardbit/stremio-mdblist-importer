// worker.js - Wersja z uproszczonym routingiem i globalnym try...catch

import { addonBuilder } from 'stremio-addon-sdk';

// --- Konfiguracja Addona ---
const MDBLIST_MAIN_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3";
const MDBLIST_API_ITEMS_URL = "https://api.mdblist.com/lists";
const MDBLIST_API_USERLISTS_URL = "https://mdblist.com/api/lists/user/";
const ADDON_ID = "community.mdblist.importer.git.v3"; // Używamy tego samego ID na razie

// Definicja manifestu - szablon
const MANIFEST_TEMPLATE = {
  id: ADDON_ID, version: "1.2.1", name: "MDblist Importer (Dynamic Lists)",
  description: "Importuj wybrane listy z MDblist.com używając swojego klucza API.",
  resources: ["catalog"], types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "mdblist_movies", name: "MDblist – Movie Lists" },
    { type: "series", id: "mdblist_series", name: "MDblist – Series Lists" }
  ],
};

// --- Logika pobierania DANYCH Z WYBRANYCH LIST ---
async function fetchListItems(slug, apiKey = MDBLIST_MAIN_API_KEY) {
  const url = `${MDBLIST_API_ITEMS_URL}/${slug}/items?apiKey=${apiKey}`;
  console.log(`Fetching items for slug: ${slug}`); // Ten log nie będzie widoczny bez dostępu do logów
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.2.1' } });
    if (!res.ok) { throw new Error(`API Error ${res.status}`); } // Uproszczony błąd
    const data = await res.json();
    return data.items || [];
  } catch (error) {
    console.error(`Failed to fetch or parse items list "${slug}":`, error);
    return [];
  }
}

// --- Logika pobierania LIST UŻYTKOWNIKA (nieużywana w tej wersji) ---
// async function fetchUserLists(userApiKey) { ... } // Zakomentowane na razie


// --- Logika katalogu ---
async function getCatalog(type, config) {
    // ... (reszta logiki katalogu bez zmian) ...
    const listSlugsString = config.listSlug;
    console.log(`Catalog request: type=${type}, config=`, JSON.stringify(config));
    if (!listSlugsString) { return { metas: [] }; }
    const slugs = [...new Set(listSlugsString.split(',').map(s => s.trim()).filter(s => s))];
    if (slugs.length === 0) { return { metas: [] }; }
    console.log(`Fetching items for slugs: ${slugs.join(', ')} and type: ${type}`);
    try {
        const promises = slugs.map(slug => fetchListItems(slug, MDBLIST_MAIN_API_KEY));
        const results = await Promise.all(promises);
        const allItems = results.flat();
        const uniqueMetas = new Map();
        allItems
        .filter(item => item && item.type === type && item.tmdbId)
        .forEach(item => {
            const itemId = item.tmdbId.toString();
            if (!uniqueMetas.has(itemId)) {
            let posterUrl = item.poster;
            if (posterUrl && posterUrl.startsWith('//')) { posterUrl = 'https:' + posterUrl; }
            uniqueMetas.set(itemId, {
                id: `tmdb:${itemId}`, type: type, name: item.title || `Untitled TMDB ${itemId}`,
                poster: posterUrl, releaseInfo: item.year ? item.year.toString() : undefined,
            });
            }
        });
        const metas = Array.from(uniqueMetas.values());
        console.log(`Returning ${metas.length} unique metas for type ${type} from slugs [${slugs.join(', ')}]`);
        return { metas };
    } catch (error) {
        console.error("Error processing catalog request:", error);
        return { metas: [] };
    }
}

// --- Obsługa żądań w Cloudflare Worker ---
const landingHTML = `<!DOCTYPE html><html><head><title>MDblist Addon</title><style>body{font-family: sans-serif; padding: 2em; background: #222; color: #eee;}</style></head><body><h1>MDblist Importer (Test Version)</h1><p>Worker działa. Ścieżka /manifest.json powinna zwracać JSON.</p></body></html>`;

export default {
    async fetch(request) {
        // === Globalny try...catch ===
        try {
            const url = new URL(request.url);
            const { pathname, searchParams } = url;
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': '*',
            };

            if (request.method === 'OPTIONS') {
                return new Response(null, { headers: corsHeaders });
            }

            // Strona główna
            if (pathname === "/") {
                // Używamy prostszego tworzenia odpowiedzi, na wszelki wypadek
                return new Response(landingHTML, {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
                });
            }

            // Endpoint API - Tymczasowo wyłączony
            /*
            if (pathname === '/api/get-user-lists' && request.method === 'POST') {
                // ... logika proxy (zakomentowana) ...
                 return new Response(JSON.stringify({ error: "Endpoint disabled for testing" }), {
                     status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
            }
            */

            // Manifest
            if (pathname === '/manifest.json') {
                const config = Object.fromEntries(searchParams.entries());
                const manifest = JSON.parse(JSON.stringify(MANIFEST_TEMPLATE));
                const listSlugParam = config.listSlug ? `?listSlug=${encodeURIComponent(config.listSlug)}` : '';
                manifest.catalogs = manifest.catalogs.map(catalog => ({
                    ...catalog,
                    id: `${catalog.id}_${(config.listSlug || 'all').replace(/[^a-zA-Z0-9]/g, '_')}`,
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
                } catch (err) { // Łapanie błędów specyficznie z getCatalog
                    console.error("Error generating catalog:", err); // Ten log nie będzie widoczny
                    return new Response(JSON.stringify({ error: "Internal Server Error generating catalog", details: err.message }), {
                        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            }

            // Nie znaleziono - Zwracamy 404
            return new Response('Not Found: '+pathname, {
                status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
            });

        } catch (err) { // === Globalny catch ===
            console.error("!!! Global Worker Error !!!:", err); // Ten log nie będzie widoczny
            // Spróbuj zwrócić błąd jako zwykły tekst
            return new Response(`Worker Error:\n${err}\n${err.stack}`, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' } // Używamy text/plain
            });
        }
    }
};
