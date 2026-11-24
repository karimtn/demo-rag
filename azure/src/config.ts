import "dotenv/config";
import { createRequire } from "node:module";
import { AzureChatOpenAI, AzureOpenAIEmbeddings } from "@langchain/openai";
import { AzureAISearchVectorStore, AzureAISearchQueryType } from "@langchain/community/vectorstores/azure_aisearch";

// Les modules partagés avec le navigateur (catalogue, pipeline local, évaluation) sont en CommonJS.
const require = createRequire(import.meta.url);

export type Car = {
  id: number; title: string; price: number; year: number; km: number;
  fuel: "essence" | "diesel" | "hybride" | "electrique"; gearbox: "automatique" | "manuelle"; city: string; desc: string;
};
export const { CARS } = require("../../lib/catalog.js") as { CARS: Car[] };

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Variable d'environnement manquante : ${name} (voir azure/.env.example)`);
  return v;
}

export const settings = {
  get apiVersion() { return env("AZURE_OPENAI_API_VERSION", "2024-10-21"); },
  get indexName() { return env("AZURE_AISEARCH_INDEX", "annonces-demo-rag"); },
  get queryType() {
    // "similarity_hybrid" (BM25 + vecteurs) par défaut ; "semantic_hybrid" ajoute le reranker sémantique (offre Basic+).
    return (process.env.AZURE_AISEARCH_QUERY_TYPE ?? AzureAISearchQueryType.SimilarityHybrid) as
      (typeof AzureAISearchQueryType)[keyof typeof AzureAISearchQueryType];
  },
};

const azureOpenAI = () => ({
  azureOpenAIApiKey: env("AZURE_OPENAI_API_KEY"),
  azureOpenAIApiInstanceName: env("AZURE_OPENAI_API_INSTANCE_NAME"),
  azureOpenAIApiVersion: settings.apiVersion,
});

export function chatModel(temperature = 0) {
  return new AzureChatOpenAI({
    ...azureOpenAI(),
    azureOpenAIApiDeploymentName: env("AZURE_OPENAI_CHAT_DEPLOYMENT"),
    temperature,
    maxRetries: 2,
  });
}

export function embeddings() {
  return new AzureOpenAIEmbeddings({
    ...azureOpenAI(),
    azureOpenAIApiDeploymentName: env("AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT"),
  });
}

export function vectorStore() {
  return new AzureAISearchVectorStore(embeddings(), {
    endpoint: env("AZURE_AISEARCH_ENDPOINT"),
    key: env("AZURE_AISEARCH_KEY"),
    indexName: settings.indexName,
    search: { type: settings.queryType },
  });
}
