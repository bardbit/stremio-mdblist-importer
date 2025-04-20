// worker.js - Kod dla Cloudflare Worker (wdrażany z Git)

// Standardowy import - Cloudflare zainstaluje to dzięki package.json
import { addonBuilder } from 'stremio-addon-sdk';

// --- Konfiguracja Addona ---
const MDBLIST_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3"; // Twój klucz API MDblist
const MDBLIST_API_URL = "https://api.mdblist.com/lists";
// Zmień ID, aby odróżnić od poprzednich prób
const ADDON_ID = "community.mdblist.importer.git";

// Definicja manifestu - szablon
const MANIFEST_TEMPLATE = {
  id: ADDON_ID,
  version: "1.1.0", // Nowa wersja dla tej metody wdrożenia
  name: "MDblist Importer (Git Deploy)",
  description: "Importuj listy z MDblist.com jako katalogi w Stremio/Fusion.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "mdblist_movies",
      name: "MDblist – Movie Lists",
    },
    {
      type: "series",
      id: "mdblist_series",
      name: "MDblist – Series Lists",
    }
  ],
  // logo: "https://raw.githubusercontent.com/bardbit/stremio-mdblist-importer/main/logo.png"
};

// --- Logika pobierania danych z MDblist ---
async function fetchListItems(slug, apiKey) {
  const url = `${MDBLIST_API_URL}/${slug}/items?apiKey=${apiKey}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'StremioMDblistAddon/1.1' } });
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

// --- Logika katalogu ---
async function getCatalog(type, config) {
    const listSlugsString = config.listSlug;
    console.log(`Catalog request: type=${type}, config=`, JSON.stringify(config));

    if (!listSlugsString) {
        console.log("No listSlug provided in config.");
        return { metas: [] };
    }
    const slugs = [...new Set(listSlugsString.split(',').map(s => s.trim()).filter(s => s))];
    if (slugs.length === 0) {
        console.log("Empty or invalid slugs provided.");
        return { metas: [] };
    }
    console.log(`Fetching items for slugs: ${slugs.join(', ')} and type: ${type}`);

    try {
        const promises = slugs.map(slug => fetchListItems(slug, MDBLIST_API_KEY));
        const results = await Promise.all(promises);
        const allItems = results.flat();
        const uniqueMetas = new Map();

        allItems
        .filter(item => item && item.type === type && item.tmdbId)
        .forEach(item => {
            const itemId = item.tmdbId.toString();
            if (!uniqueMetas.has(itemId)) {
            let posterUrl = item.poster;
            if (posterUrl && posterUrl.startsWith('//')) {
                posterUrl = 'https:' + posterUrl;
            }
            uniqueMetas.set(itemId, {
                id: `tmdb:${itemId}`,
                type: type,
                name: item.title || `Untitled TMDB ${itemId}`,
                poster: posterUrl,
                releaseInfo: item.year ? item.year.toString() : undefined,
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
// Prosta strona powitalna
const landingHTML = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MDblist Addon</title>
<style>body{font-family: sans-serif; padding: 2em; background: #222; color: #eee;}</style></head><body>
<h1>MDblist Importer Addon (Git Deployed)</h1><p>Ten addon działa.</p>
<p>Skonfiguruj i zainstaluj go używając strony konfiguracyjnej.</p>
</body></html>`;

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const { pathname, searchParams } = url;

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
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

        if (pathname === '/manifest.json') {
            const config = Object.fromEntries(searchParams.entries());
            const manifest = JSON.parse(JSON.stringify(MANIFEST_TEMPLATE));
            const listSlugParam = config.listSlug ? `?listSlug=${encodeURIComponent(config.listSlug)}` : '';

            manifest.catalogs = manifest.catalogs.map(catalog => ({
                ...catalog,
                id: `${catalog.id}_${(config.listSlug || 'all').replace(/[^a-zA-Z0-9]/g, '_')}`, // Bezpieczniejsze ID
                url: `${url.origin}/catalog/${catalog.type}/${catalog.id}.json${listSlugParam}`
            }));
            manifest.catalogs.forEach(cat => delete cat.extra);

            return new Response(JSON.stringify(manifest), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

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

        return new Response('Not Found', {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        });
    }
};
