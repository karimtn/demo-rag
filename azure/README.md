# Variante Azure — Azure OpenAI + Azure AI Search + LangChain.js

Le même cas d'usage que la démo locale (recherche d'annonces en langage naturel), sur un vrai pipeline RAG :

```
question ─► 1. analyse        AzureChatOpenAI + sortie structurée (zod) → budget, carburant, boîte, ville, requête reformulée
         ─► 2. retrieval      Azure AI Search, recherche hybride BM25 + vecteurs, filtre OData sur les métadonnées
         ─► 3. budget         appliqué par le code : un prix n'est jamais confié au LLM
         ─► 4. génération     AzureChatOpenAI, réponse structurée { noMatch, answer, citations[] }, ancrée dans le contexte
         ─► 5. garde-fous     citations hors contexte supprimées, prix non vérifiables → texte régénéré depuis les données,
                              réponse sans citation valide → abstention
```

Tout est orchestré en **LangChain.js** (`ChatPromptTemplate`, `withStructuredOutput`, `RunnableSequence`,
`AzureOpenAIEmbeddings`, `AzureAISearchVectorStore`).

| Fichier | Rôle |
|---|---|
| `src/config.ts` | Clients Azure OpenAI (chat, embeddings) et vector store Azure AI Search |
| `src/ingest.ts` | Annonces → documents → embeddings → index (créé automatiquement) |
| `src/rag.ts` | Chaîne RAG, filtre OData, garde-fous anti-hallucination |
| `src/server.ts` | API Express `POST /api/ask`, CORS, limite de débit |
| `src/eval.ts` | Évaluation sur le jeu de test annoté, juge LLM optionnel |
| `test/` | Tests sans réseau (LLM et index remplacés par des doublures) |

## Prérequis Azure

1. Une ressource **Azure OpenAI** avec deux déploiements, par exemple `gpt-4o-mini` (chat) et `text-embedding-3-small` (embeddings).
2. Un service **Azure AI Search**. L'offre gratuite suffit en mode `similarity_hybrid` ; `semantic_hybrid` (reranker sémantique) demande l'offre Basic ou plus.

## Lancer

```bash
cd azure
npm install --legacy-peer-deps   # @langchain/community déclare un peer optionnel ancien (zep) ; sans effet ici
cp .env.example .env             # puis renseigner les clés
npm test                         # 12 tests, sans appel réseau
npm run ingest                   # crée l'index et indexe les 20 annonces
npm run dev                      # API sur http://localhost:8787
```

Ouvrez ensuite `index.html`, choisissez **Azure OpenAI** et indiquez `http://localhost:8787`.

```bash
curl -s localhost:8787/api/ask -H 'Content-Type: application/json' \
  -d '{"question":"SUV électrique moins de 20 000 €"}' | jq
```

## Évaluer

```bash
npm run eval -- --pipeline local            # référence hors ligne, sans clé
npm run eval -- --pipeline azure --judge    # pipeline Azure + juge LLM (pertinence, fidélité)
```

Le rapport est écrit dans `eval/reports/<pipeline>.json`. Une fois commité, `eval.html` l'affiche à côté de l'évaluation locale.

## Mettre l'API en ligne

L'API est un simple serveur Node : Azure Container Apps ou Azure App Service conviennent. Ajoutez l'URL de la page
(par exemple `https://karimtn.github.io`) à `ALLOWED_ORIGINS`, et gardez la limite de débit : chaque appel consomme des jetons.
