# Démo RAG — recherche sémantique d'annonces

Un même cas d'usage (rechercher des annonces automobiles en langage naturel), en trois volets :

| Volet | Où | Ce que ça montre |
|---|---|---|
| **Démo locale** | [`index.html`](index.html), mode « Local » | Le pipeline retrieval → synthèse, hors ligne, sans clé (TF-IDF + règles) |
| **Simulation Azure** | [`index.html`](index.html), mode « Azure OpenAI · simulation » | Les étapes du pipeline Azure rejouées dans la page, avec leur trace, sans clé |
| **Code Azure réel** | [`azure/`](azure/) | Azure OpenAI + Azure AI Search, orchestré en **LangChain.js** (TypeScript), avec garde-fous anti-hallucination |
| **Évaluation** | [`eval.html`](eval.html), `azure/src/eval.ts` | Jeu de test annoté, métriques de recherche, détection d'hallucinations, abstention, juge LLM |

Démo en ligne : https://karimtn.github.io/demo-rag/ · évaluation : https://karimtn.github.io/demo-rag/eval.html

---

## 1. Démo locale

Démo **autonome** (aucune dépendance, aucune clé API) du pipeline **retrieval → synthèse** d'un système RAG.

## Ce que ça démontre

1. **Retrieval** : la requête et les annonces sont vectorisées (TF-IDF) puis comparées par similarité cosinus.
2. **Extraction de critères** : budget, carburant, boîte, ville sont détectés dans le langage naturel et ajustent le classement.
3. **Synthèse** : un résumé en 3 lignes restitue les critères compris et les meilleures annonces.

## Ce que ce n'est pas (transparence)

- Ce n'est **pas** un LLM : la synthèse est générée par des **règles**, pour que la démo tourne hors-ligne et reste vérifiable.
- Ce n'est **pas** des embeddings : c'est du **TF-IDF**, une baseline lexicographique.
- Le pipeline avec **embeddings** et **LLM** est le [code Azure](azure/) ; la page en propose une simulation (mode « Azure OpenAI · simulation »).

## Lancer

```bash
# ouvrir directement le fichier
open index.html          # macOS
xdg-open index.html      # Linux

# ou via un petit serveur (nécessaire pour afficher le rapport Azure dans eval.html)
npx serve .
```
## Script de démo — 3 minutes

| Temps | Ce que tu montres | Ce que tu dis |
|---|---|---|
| 0:00-0:20 | La page | « Une recherche en langage naturel sur un catalogue d'annonces. » |
| 0:20-0:50 | Cliquer « SUV automatique essence moins de 20 000 € à Lyon » | « Regardez : il comprend le budget, la boîte, la ville — et il ne se contente pas de chercher les mots. » |
| 0:50-1:30 | Montrer les scores + le panneau « Critères retenus » | « Chaque annonce est un vecteur ; le score, c'est la similarité cosinus, ajustée par les critères détectés. » |
| 1:30-2:10 | Taper « citadine électrique budget 15000 € » | « Là, le modèle écarte les thermiques : la Zoé sort, les autres chutent. » |
| 2:10-2:40 | Montrer le résumé | « La dernière brique, c'est la synthèse : en production, c'est un LLM qui la rédige à partir des résultats ; ici, des règles. » |
| 2:40-3:00 | Conclure | « Le même pipeline tourne sur un vrai catalogue : embeddings, retrieval, puis génération. » |

**Phrase de clôture :** « La différence avec une démo, c'est que celle-ci est vérifiable : vous pouvez ouvrir le code et voir exactement ce qui se passe. »

## Détails techniques

- **Tokenisation** : normalisation Unicode (accents), minuscules, stopwords FR, stemming léger.
- **Index** : TF-IDF (`log((N+1)/(df+1))+1`), vecteurs normalisés L2.
- **Similarité** : cosinus.
- **Réordonnancement** : bonus/malus par facette (carburant, boîte, ville, carrosserie, budget).
- **Jeu de données** : 20 annonces **fictives** (aucune donnée réelle, aucun problème RGPD).

## 2. Pipeline Azure OpenAI + Azure AI Search + LangChain.js

**Dans la page : une simulation.** Le mode « Azure OpenAI · simulation » rejoue chaque étape du pipeline dans le
navigateur et affiche sa trace : l'objet structuré produit par l'analyse, le filtre OData envoyé à Azure AI Search, les
classements mots-clés / vecteurs et leur fusion RRF, le brouillon de réponse, puis les corrections des garde-fous. Une case
permet d'**injecter une erreur du LLM** (prix faux, annonce inventée) pour voir les garde-fous la corriger. Ce qui est
simulé : l'analyse et la génération (des règles au lieu de GPT) et les embeddings (TF-IDF enrichi de synonymes). Le filtre
OData et les garde-fous sont les mêmes que dans le vrai code. Code : [`lib/azure-sim.js`](lib/azure-sim.js).

**Le vrai code : [`azure/`](azure/)**, voir [`azure/README.md`](azure/README.md). On peut aussi brancher la page sur l'API réelle
(« Brancher l'API réelle » dans le mode Azure). En résumé : analyse de la requête par GPT en sortie structurée, recherche
hybride (BM25 + vecteurs) avec filtre OData, budget appliqué par le code, génération avec citations obligatoires, puis
garde-fous : citation hors contexte supprimée, prix non vérifiable → texte régénéré depuis les données, réponse sans
source → abstention.

## 3. Évaluation de la qualité des réponses

[`eval.html`](eval.html) calcule en direct l'évaluation du pipeline local et de la simulation Azure, et affiche le dernier rapport du pipeline Azure réel.

- **Jeu de test** : 14 questions annotées à la main, dont 3 pièges (modèle absent, véhicule hors catalogue, critères impossibles).
- **Recherche** : hit@1, recall@3/5, MRR, nDCG@5.
- **Ancrage** : contrôles déterministes — citations existantes et issues du contexte, prix et kilométrages vérifiés, aucun modèle inventé.
- **Contraintes et abstention** : aucune annonce hors critères, « rien ne correspond » quand c'est vrai.
- **Juge LLM** (option `--judge`) : pertinence et fidélité notées de 1 à 5.

Le pipeline local obtient 79 % de réussite de bout en bout : il rate les synonymes (« sobre ») et propose une Model 3
quand on demande une Model Y. C'est le rôle de l'évaluation : rendre ces limites visibles et mesurables. La simulation Azure obtient 100 %, mais ce score
n'est pas représentatif, puisque ses règles ont été écrites en connaissant ces questions. Seul le rapport du pipeline réel compte.

## Structure

```
index.html          démo (modes Local / Azure)
eval.html           tableau de bord d'évaluation
lib/catalog.js      20 annonces fictives (partagé navigateur / Node)
lib/local-rag.js    pipeline local
lib/azure-sim.js    simulation du pipeline Azure (trace étape par étape)
lib/eval-core.js    jeu de test, métriques, détecteurs d'hallucinations
azure/              variante Azure en TypeScript + LangChain.js
eval/reports/       rapports JSON produits par azure/src/eval.ts
```

## Limites assumées

- Pas de compréhension sémantique profonde (synonymes, négations) → c'est le rôle des embeddings en production.
- Pas de génération de texte libre → c'est le rôle du LLM.
- 20 documents : suffisant pour démontrer, pas pour évaluer la qualité d'un retrieval.
