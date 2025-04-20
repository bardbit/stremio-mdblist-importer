// worker.js - Wersja z super uproszczoną obsługą roota

import { addonBuilder } from 'stremio-addon-sdk';

// --- Konfiguracja (bez zmian) ---
const MDBLIST_MAIN_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3";
const MDBLIST_API_ITEMS_URL = "https://api.mdblist.com/lists";
const MDBLIST_API_USERLISTS_URL = "https://mdblist.com/api/lists/user/";
const ADDON_ID = "community.mdblist.importer.git.v3"; // ID bez zmian

const MANIFEST_TEMPLATE = {
  id: ADDON_ID, version: "1.2.1", name: "MDblist Importer (Dynamic Lists)",
  description: "Importuj wybrane listy z MDblist.com używając swojego klucza API.",
  resources: ["catalog"], types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "mdblist_movies", name: "MDblist – Movie Lists" },
    { type: "series", id: "mdblist_series", name: "MDblist – Series Lists" }
  ],
};

// --- Funkcje pomocnicze (bez zmian) ---
async function fetchListItems(slug, apiKey = MDBLIST_MAIN_API_KEY) { /* ... kod bez zmian ... */
    const url = `${MDBLIST_API_ITEMS_URL}/${slug}/items?apiKey=${apiKey}`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.2.1' } });
        if (!res.ok) { throw new Error(`API Error ${res.status}`); }
        const data = await res.json();
        return data.items || [];
    } catch (error) {
        console.error(`Failed to fetch or parse items list "${slug}":`, error);
        return [];
    }
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
        return { metas };
    } catch (error) {
        console.error("Error processing catalog request:", error);
        return { metas: [] };
    }
}


// --- Obsługa żądań w Cloudflare Worker ---
export default {
    async fetch(request) {
        try {
            const url = new URL(request.url);
            const { pathname, searchParams } = url;
            // Zostawiamy tylko nagłówek CORS dla testów
            const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

            if (request.method === 'OPTIONS') {
                return new Response(null, { headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                 } });
            }

            // *** SUPER UPROSZCZONA OBSŁUGA ROOTa ***
            if (pathname === "/") {
                // Zwracamy tylko prosty tekst, bez żadnych dodatkowych nagłówków poza CORS
                return new Response("Hello from Root!", {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'text/plain' // Zwracamy jako zwykły tekst
                    }
                });
            }

            // Manifest (bez zmian)
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

            // Katalog (bez zmian)
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

             // Endpoint API - nadal wyłączony
            if (pathname === '/api/get-user-lists') {
                 return new Response(JSON.stringify({ error: "Endpoint disabled for testing" }), {
                     status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
            }


            // Nie znaleziono
            return new Response(`Not Found: Path '${pathname}' was not handled.`, {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
            });

        } catch (err) { // Globalny catch
            console.error("!!! Global Worker Error !!!:", err);
            return new Response(`Worker Error:\n${err}\n${err.stack}`, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }
};
