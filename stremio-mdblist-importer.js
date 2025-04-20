// Zmień import fetch, jeśli używasz Node.js v18+ (fetch jest globalny)
// Jeśli nie, zostaw import z CDN, ale upewnij się, że środowisko go obsłuży
// import fetch from "node-fetch"; // Jeśli używasz Node.js < 18 i instalujesz przez npm
import { addonBuilder } from "https://cdn.jsdelivr.net/npm/stremio-addon-sdk@latest/index.vanilla.js";
// Jeśli fetch jest globalny (Node 18+, Deno, Workers), nie potrzebujesz importu node-fetch
// W przeciwnym razie upewnij się, że ten import z CDN działa w Twoim środowisku docelowym
// Jeśli ten import z CDN dla node-fetch nie działa, musisz dostosować go do swojego środowiska.
import fetch from "https://cdn.jsdelivr.net/npm/node-fetch@2.6.7/lib/index.js"; // Zachowujemy na razie

// Manifest add-ona - powinien być taki sam jak w manifest.json
const manifest = {
  id: "community.mdblist.importer",
  version: "1.0.0", // Zaktualizuj wersję, jeśli wprowadzasz istotne zmiany
  name: "MDblist Importer",
  description: "Importuj listy z MDblist.com jako katalogi w Stremio/Fusion.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "mdblist_movies",
      name: "MDblist – Movie Lists", // Nazwa może być bardziej ogólna
      // `extra` definiuje, jakie dane konfiguracyjne są potrzebne
      extra: [{ name: "listSlug", isRequired: true }]
    },
    {
      type: "series",
      id: "mdblist_series",
      name: "MDblist – Series Lists", // Nazwa może być bardziej ogólna
      extra: [{ name: "listSlug", isRequired: true }]
    }
  ],
  // Usunięto behaviorHints, bo konfiguracja odbywa się przez URL instalacyjny
  // Można zostawić, jeśli jest potrzebne dla specyficznych zachowań Fusion/Stremio
  // behaviorHints: {
  //  configurationRequired": true // Może być nadal przydatne
  // }
};

const builder = new addonBuilder(manifest);

// Twój stały API Key (upewnij się, że jest poprawny i aktywny)
const MDBLIST_API_KEY = "w0ys7vrr14k2obu5ar6rsvvq3";
// Bazowy URL API MDblist (sprawdź poprawność)
const MDBLIST_API_URL = "https://api.mdblist.com/lists";

// Funkcja pomocnicza do pobierania i parsowania jednej listy
async function fetchListItems(slug, apiKey) {
  const url = `${MDBLIST_API_URL}/${slug}/items?apiKey=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`MDblist API error for slug "${slug}": ${res.status} ${res.statusText}`);
      // Zwróć pustą tablicę lub rzuć błąd, zależnie jak chcesz obsługiwać błędy pojedynczych list
      return [];
    }
    const data = await res.json();
    return data.items || []; // Zwróć elementy listy lub pustą tablicę
  } catch (error) {
    console.error(`Failed to fetch or parse list "${slug}":`, error);
    return []; // Zwróć pustą tablicę w razie błędu sieciowego/parsowania
  }
}

// Handler katalogu
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log(`Catalog request: type=${type}, id=${id}, extra=`, extra);

  const listSlugsString = extra.listSlug;
  if (!listSlugsString) {
    console.log("No listSlug provided.");
    return Promise.resolve({ metas: [] });
  }

  // Podziel string ze slugami na tablicę unikalnych slugów
  const slugs = [...new Set(listSlugsString.split(',').map(s => s.trim()).filter(s => s))];

  if (slugs.length === 0) {
    console.log("Empty or invalid slugs provided.");
    return Promise.resolve({ metas: [] });
  }

  console.log(`Fetching items for slugs: ${slugs.join(', ')} and type: ${type}`);

  try {
    // Pobierz elementy dla wszystkich list równolegle
    const promises = slugs.map(slug => fetchListItems(slug, MDBLIST_API_KEY));
    const results = await Promise.all(promises);

    // Połącz wszystkie elementy z różnych list w jedną tablicę
    const allItems = results.flat(); // results to tablica tablic [ [...items1], [...items2], ...]

    // Użyj Map, aby usunąć duplikaty (jeśli ten sam film/serial jest na wielu listach)
    const uniqueMetas = new Map();

    allItems
      .filter(item => item.type === type) // Filtruj po typie (movie/series)
      .forEach(item => {
        // Używamy TMDB ID jako klucza do deduplikacji
        const itemId = item.tmdbId ? item.tmdbId.toString() : null;
        if (!itemId) return; // Pomiń elementy bez TMDB ID

        // Jeśli jeszcze nie mamy tego ID, dodaj meta obiekt
        if (!uniqueMetas.has(itemId)) {
            // Sprawdź czy poster istnieje i dodaj 'https:' jeśli jest to konieczne (jeśli API zwraca //...)
            let posterUrl = item.poster;
            if (posterUrl && posterUrl.startsWith('//')) {
                posterUrl = 'https:' + posterUrl;
            }

            uniqueMetas.set(itemId, {
                id: `tmdb:${itemId}`, // Zalecany format ID dla Stremio to prefix:id
                type: type,
                name: item.title,
                poster: posterUrl, // Użyj poprawionego URL
                // Dodaj więcej metadanych, jeśli są dostępne i potrzebne
                // np. description: item.overview,
                releaseInfo: item.year ? item.year.toString() : undefined,
                // Możesz dodać inne pola jak imdbRating, genres itp. jeśli API je zwraca
            });
        }
      });

    // Konwertuj Mapę z powrotem na tablicę meta obiektów
    const metas = Array.from(uniqueMetas.values());

    console.log(`Returning ${metas.length} unique metas for type ${type}`);
    return Promise.resolve({ metas });

  } catch (error) {
    console.error("Error processing catalog request:", error);
    return Promise.resolve({ metas: [] }); // Zwróć pusty katalog w razie ogólnego błędu
  }
});

// Eksport interfejsu dla serwera addona
// Upewnij się, że serwer, na którym to uruchomisz, poprawnie to obsłuży
export default builder.getInterface();

// Jeśli uruchamiasz to jako prosty serwer Node.js (potrzebujesz `npm install express`):
/*
import express from 'express';
import cors from 'cors'; // npm install cors

const app = express();
const port = process.env.PORT || 3000; // Użyj portu z env lub domyślnie 3000

app.use(cors()); // Włącz CORS dla wszystkich domen
app.use((req, res, next) => {
  const handler = builder.getInterface();
  handler(req, res, next);
});

app.listen(port, () => {
  console.log(`MDblist addon server running on http://localhost:${port}`);
});
*/
// Pamiętaj, że ten kod serwera Node.js wymagałby zmiany importów na początku pliku
// (np. import fetch from 'node-fetch'; import { addonBuilder } from 'stremio-addon-sdk';)
// i instalacji zależności przez `npm install`.
