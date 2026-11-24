/**
 * Ingestion : annonces → documents LangChain → embeddings Azure OpenAI → index Azure AI Search.
 * L'index (champs, profil HNSW, config sémantique) est créé automatiquement s'il n'existe pas.
 *
 *   npm run ingest
 */
import { Document } from "@langchain/core/documents";
import { CARS, vectorStore, settings, type Car } from "./config.js";

/** Texte indexé : ce que l'embedding et la recherche plein texte « voient ». */
export function carToText(c: Car): string {
  return `${c.title}. ${c.desc} Carburant : ${c.fuel}. Boîte ${c.gearbox}. ` +
    `${c.year}, ${c.km} km, ${c.price} €. Ville : ${c.city}.`;
}

/** Métadonnées filtrables (OData) : le schéma LangChain les range en paires clé/valeur. */
export function carToDocument(c: Car): Document {
  return new Document({
    pageContent: carToText(c),
    metadata: {
      source: `annonce-${c.id}`,
      attributes: [
        { key: "id", value: String(c.id) },
        { key: "fuel", value: c.fuel },
        { key: "gearbox", value: c.gearbox },
        { key: "city", value: c.city.toLowerCase() },
      ],
    },
  });
}

async function main() {
  const store = vectorStore();
  const docs = CARS.map(carToDocument);
  const ids = await store.addDocuments(docs, { ids: CARS.map((c) => `annonce-${c.id}`) });
  console.log(`✔ ${ids.length} annonces indexées dans « ${settings.indexName} ».`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
