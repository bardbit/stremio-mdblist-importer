// worker.js - Wersja z proxy dla list użytkownika

import { addonBuilder } from 'stremio-addon-sdk';

// --- Konfiguracja Addona ---
// Twój "główny" klucz API - używany do pobierania elementów list wybranych przez użytkownika
const MDBLIST_MAIN_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3";
const MDBLIST_API_URL = "https://api.mdblist.com"; // Bazowy URL API
const ADDON_ID = "community.mdblist.importer.git.v2"; // Nowe ID dla tej wersji

// Definicja manifestu - szablon
const MANIFEST_TEMPLATE = {
  id: ADDON_ID,
  version: "1.2.0", // Nowa wersja
  name: "MDblist Importer (Dynamic Lists)",
  description: "Importuj wybrane listy z MDblist.com używając swojego klucza API.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "mdblist_movies", name: "MDblist – Movie Lists" },
    { type: "series", id: "mdblist_series", name: "MDblist – Series Lists" }
  ],
  // logo: "https://raw.githubusercontent.com/bardbit/stremio-mdblist-importer/main/logo.png"
};

// --- Logika pobierania DANYCH Z WYBRANYCH LIST (używa GŁÓWNEGO klucza API) ---
async function fetchListItems(slug, apiKey = MDBLIST_MAIN_API_KEY) { // Domyślnie główny klucz
  const url = `${MDBLIST_API_URL}/lists/${slug}/items?apiKey=${apiKey}`;
  console.log(`Fetching items for slug: ${slug}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.2' } });
    if (!res.ok) {
      console.error(`MDblist API error for slug "${slug}": ${res.status} ${res.statusText}`);
      const errorBody = await res.text().catch(() => 'Could not read error body');
      console.error(`Error body for ${slug}: ${errorBody}`);
      return [];
    }
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
         console.error(`Unexpected content-type for slug "${slug}": ${contentType}`);
         const textBody = await res.text().catch(() => 'Could not read body');
         console.error(`Body content for ${slug}: ${textBody.substring(0, 200)}...`);
         return [];
    }
    const data = await res.json();
    return data.items || [];
  } catch (error) {
    console.error(`Failed to fetch or parse list "${slug}":`, error);
    return [];
  }
}

// --- Logika pobierania LIST UŻYTKOWNIKA (używa klucza API podanego przez użytkownika) ---
async function fetchUserLists(userApiKey) {
    if (!userApiKey) {
        throw new Error("User API Key is required");
    }
    // Używamy innego endpointu API MDblist do pobrania list użytkownika
    const url = `${MDBLIST_API_URL}/lists/user/?apikey=${encodeURIComponent(userApiKey)}`;
    console.log(`Fetching user lists using provided API key...`);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.2 ConfigProxy' } });
        if (!res.ok) {
            const errorBody = await res.text().catch(() => `Status: ${res.status} ${res.statusText}`);
            console.error(`MDblist API error fetching user lists: ${res.status} ${res.statusText}`, errorBody);
            // Rzucamy błąd, aby strona HTML mogła go wyświetlić
            throw new Error(`Błąd API MDblist (${res.status}): ${errorBody.substring(0,100)}...`);
        }
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const textBody = await res.text().catch(() => 'Could not read body');
            console.error(`Unexpected content-type fetching user lists: ${contentType}`, textBody.substring(0,200));
            throw new Error(`Nieoczekiwana odpowiedź z API MDblist (nie JSON).`);
        }
        const data = await res.json();
        // Sprawdzamy, czy odpowiedź zawiera pole 'lists' lub czy sama jest tablicą
        if (Array.isArray(data.lists)) {
            return data.lists;
        } else if (Array.isArray(data)) {
            return data; // Czasami API może zwrócić samą tablicę
        } else {
             console.error("Invalid format fetching user lists:", data);
             throw new Error("Nieprawidłowy format odpowiedzi z API MDblist.");
        }
    } catch (error) {
        console.error(`Failed to fetch or parse user lists:`, error);
        // Rzucamy błąd dalej, aby strona HTML go obsłużyła
        throw error;
    }
}


// --- Logika katalogu (bez zmian, używa GŁÓWNEGO klucza API) ---
async function getCatalog(type, config) {
    const listSlugsString = config.listSlug;
    console.log(`Catalog request: type=${type}, config=`, JSON.stringify(config));
    if (!listSlugsString) { return { metas: [] }; }
    const slugs = [...new Set(listSlugsString.split(',').map(s => s.trim()).filter(s => s))];
    if (slugs.length === 0) { return { metas: [] }; }
    console.log(`Fetching items for slugs: ${slugs.join(', ')} and type: ${type}`);
    try {
        // Pobieramy elementy używając GŁÓWNEGO klucza API zdefiniowanego w workerze
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
const landingHTML = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MDblist Addon</title>
<style>body{font-family: sans-serif; padding: 2em; background: #222; color: #eee;}</style></head><body>
<h1>MDblist Importer Addon (Dynamic Lists)</h1><p>Ten addon działa.</p>
<p>Skonfiguruj i zainstaluj go używając strony konfiguracyjnej.</p>
</body></html>`;

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const { pathname, searchParams } = url;

        // Zawsze dodawaj nagłówki CORS
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*', // Można zawęzić w przyszłości
            'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS', // Dodano POST dla proxy
            'Access-Control-Allow-Headers': '*', // Lub zawęzić do 'Content-Type' itp.
        };

        // Obsługa preflight CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Strona główna
        if (pathname === "/") {
            return new Response(landingHTML, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // *** NOWY ENDPOINT: Proxy do pobierania list użytkownika ***
        if (pathname === '/api/get-user-lists' && request.method === 'POST') {
            try {
                const body = await request.json();
                const userApiKey = body.apiKey;
                if (!userApiKey) {
                   return new Response(JSON.stringify({ error: "Missing apiKey in request body" }), {
                       status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                }
                // Wywołaj funkcję pobierającą listy z kluczem użytkownika
                const lists = await fetchUserLists(userApiKey);
                // Zwróć listy do strony HTML
                return new Response(JSON.stringify({ lists: lists }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (err) {
                console.error("Error in /api/get-user-lists proxy:", err);
                // Zwróć błąd w formacie JSON, aby strona HTML mogła go wyświetlić
                return new Response(JSON.stringify({ error: err.message || "Błąd podczas pobierania list użytkownika." }), {
                    status: err.message.includes("API MDblist") ? 400 : 500, // Zwróć 400 dla błędów API, 500 dla innych
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
                // Zwróć uwagę: getCatalog używa GŁÓWNEGO klucza API, nie użytkownika
                const result = await getCatalog(type, config);
                return new Response(JSON.stringify(result), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (err) {
                console.error("Error generating catalog:", err);
                return new Response(JSON.stringify({ error: "Internal Server Error generating catalog" }), {
                    status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // Nie znaleziono
        return new Response('Not Found', {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        });
    }
};
