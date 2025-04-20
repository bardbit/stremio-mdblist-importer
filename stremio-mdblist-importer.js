import { addonBuilder } from "https://cdn.jsdelivr.net/npm/stremio-addon-sdk@latest/index.vanilla.js";
import fetch from "https://cdn.jsdelivr.net/npm/node-fetch@2.6.7/lib/index.js";

// Manifest add‑ona
const manifest = {
  id: "community.mdblist.importer",
  version: "1.0.0",
  name: "MDblist Importer",
  description: "Import dowolne listy z MDblist.com jako katalogi w Stremio",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "mdblist_movies",
      name: "MDblist – My Movie Lists",
      extra: [{ name: "listSlug", isRequired: true }]
    },
    {
      type: "series",
      id: "mdblist_series",
      name: "MDblist – My Series Lists",
      extra: [{ name: "listSlug", isRequired: true }]
    }
  ]
};

const builder = new addonBuilder(manifest);

// Handler katalogu
builder.defineCatalogHandler(async ({ type, extra }) => {
  const slug = extra.listSlug;
  if (!slug) return { metas: [] };

  const apiKey = "w0ys7vrr14k2obu5ar6rsvvq3";  // Twój MDblist API Key
  const url = `https://api.mdblist.com/lists/${slug}/items?apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("MDblist error:", await res.text());
    return { metas: [] };
  }
  const data = await res.json();
  const items = data.items || [];

  const metas = items
    .filter(item => item.type === type)
    .map(item => ({
      id: item.tmdbId.toString(),
      type,
      name: item.title,
      poster: item.poster,
      releaseInfo: item.year ? item.year.toString() : undefined
    }));

  return { metas };
});

// Eksport interfejsu
export default builder.getInterface();
