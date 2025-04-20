// worker.js - Wersja z POPRAWIONYM URL dla list użytkownika

import { addonBuilder } from 'stremio-addon-sdk';

// --- Konfiguracja Addona ---
const MDBLIST_MAIN_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3"; // Twój główny klucz API
// Ten URL jest używany do pobierania *elementów* listy (może być poprawny)
const MDBLIST_API_ITEMS_URL = "https://api.mdblist.com/lists";
// !!! TEN URL jest używany do pobierania *list* użytkownika (zgodnie z Twoją informacją)
const MDBLIST_API_USERLISTS_URL = "https://mdblist.com/api/lists/user/";
const ADDON_ID = "community.mdblist.importer.git.v3"; // Nowe ID dla tej wersji

// Definicja manifestu - szablon
const MANIFEST_TEMPLATE = {
  id: ADDON_ID,
  version: "1.2.1", // Zwiększona wersja po poprawce
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

// --- Logika pobierania DANYCH Z WYBRANYCH LIST (używa GŁÓWNEGO klucza API i MDBLIST_API_ITEMS_URL) ---
async function fetchListItems(slug, apiKey = MDBLIST_MAIN_API_KEY) {
  // Używamy URL do pobierania elementów
  const url = `${MDBLIST_API_ITEMS_URL}/${slug}/items?apiKey=${apiKey}`;
  console.log(`Fetching items for slug: ${slug}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.2.1' } }); // Zaktualizowany User-Agent
    if (!res.ok) {
      console.error(`MDblist API error for items slug "${slug}": ${res.status} ${res.statusText}`);
      const errorBody = await res.text().catch(() => 'Could not read error body');
      console.error(`Error body for items ${slug}: ${errorBody}`);
      return [];
    }
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
         console.error(`Unexpected content-type for items slug "${slug}": ${contentType}`);
         const textBody = await res.text().catch(() => 'Could not read body');
         console.error(`Body content for items ${slug}: ${textBody.substring(0, 200)}...`);
         return [];
    }
    const data = await res.json();
    return data.items || [];
  } catch (error) {
    console.error(`Failed to fetch or parse items list "${slug}":`, error);
    return [];
  }
}

// --- Logika pobierania LIST UŻYTKOWNIKA (używa klucza API użytkownika i POPRAWIONEGO MDBLIST_API_USERLISTS_URL) ---
async function fetchUserLists(userApiKey) {
    if (!userApiKey) {
        throw new Error("User API Key is required");
    }
    // !!! Używamy POPRAWIONEGO URL do pobierania list użytkownika
    const url = `${MDBLIST_API_USERLISTS_URL}?apikey=${encodeURIComponent(userApiKey)}`;
    console.log(`Fetching user lists from: ${url}`); // Logujemy pełny URL (bez klucza) dla pewności
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.2.1 ConfigProxy' } });
        if (!res.ok) {
            const errorBody = await res.text().catch(() => `Status: ${res.status} ${res.statusText}`);
            console.error(`MDblist API error fetching user lists: ${res.status} ${res.statusText}`, errorBody);
            throw new Error(`Błąd API MDblist (${res.status}) podczas pobierania list: ${errorBody.substring(0,100)}...`);
        }
        const contentType = res.headers.get("content-type");
         // MDblist czasami zwraca text/html przy błędzie, nawet ze statusem 200 OK
        if (!contentType || !(contentType.includes("application/json") || contentType.includes("text/javascript")) ) {
            const textBody = await res.text().catch(() => 'Could not read body');
            console.error(`Unexpected content-type fetching user lists: ${contentType}. Body: ${textBody.substring(0,200)}...`);
             // Sprawdź czy treść nie wskazuje na błąd (np. "Invalid API key")
            if (textBody.toLowerCase().includes("invalid api key") || textBody.toLowerCase().includes("invalid apikey")) {
                 throw new Error("Nieprawidłowy klucz API MDblist.");
            } else if (textBody.toLowerCase().includes("no lists found")) {
                 return []; // Brak list to nie błąd krytyczny
            }
            throw new Error(`Nieoczekiwana odpowiedź z API MDblist (oczekiwano JSON, otrzymano ${contentType}).`);
        }
        const data = await res.json();
        if (Array.isArray(data.lists)) {
            return data.lists;
        } else if (Array.isArray(data)) {
            return data;
        } else if (data.lists === null && data.count === 0) {
            return []; // Poprawna odpowiedź oznaczająca brak list
        }
         else {
             console.error("Invalid format fetching user lists:", JSON.stringify(data));
             throw new Error("Nieprawidłowy format odpowiedzi z API MDblist.");
        }
    } catch (error) {
        console.error(`Failed to fetch or parse user lists:`, error);
        // Jeśli błąd nie jest już Error, opakuj go
        if (!(error instanceof Error)) {
           throw new Error(String(error));
        }
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
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': '*',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (pathname === "/") {
            return new Response(landingHTML, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // Proxy do pobierania list użytkownika
        if (pathname === '/api/get-user-lists' && request.method === 'POST') {
            try {
                const body = await request.json();
                const userApiKey = body.apiKey;
                if (!userApiKey) {
                   return new Response(JSON.stringify({ error: "Brak klucza apiKey w zapytaniu" }), {
                       status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                }
                const lists = await fetchUserLists(userApiKey);
                return new Response(JSON.stringify({ lists: lists }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (err) {
                console.error("Error in /api/get-user-lists proxy:", err);
                // Upewnij się, że err.message istnieje
                const errorMessage = (err instanceof Error && err.message) ? err.message : "Nieznany błąd podczas pobierania list użytkownika.";
                 // Ustal status błędu na podstawie komunikatu
                let status = 500;
                if (errorMessage.includes("API MDblist") || errorMessage.includes("Nieprawidłowy klucz API")) {
                   status = 400; // Błąd użytkownika (zły klucz) lub błąd API MDblist
                }

                return new Response(JSON.stringify({ error: errorMessage }), {
                    status: status,
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
