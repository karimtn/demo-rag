# Démo RAG — recherche sémantique d'annonces

Démo **autonome** (un seul fichier, aucune dépendance, aucune clé API) du pipeline
**retrieval → synthèse** d'un système RAG.

## Ce que ça démontre

1. **Retrieval** : la requête et les annonces sont vectorisées (TF-IDF) puis comparées par similarité cosinus.
2. **Extraction de critères** : budget, carburant, boîte, ville sont détectés dans le langage naturel et ajustent le classement.
3. **Synthèse** : un résumé en 3 lignes restitue les critères compris et les meilleures annonces.

## Ce que ce n'est pas (transparence)

- Ce n'est **pas** un LLM : la synthèse est générée par des **règles**, pour que la démo tourne hors-ligne et reste vérifiable.
- Ce n'est **pas** des embeddings : c'est du **TF-IDF**, une baseline lexicographique.
- **En production**, le pipeline réel utilise des **embeddings** (Pinecone/Weaviate) + un **LLM** pour la synthèse — c'est exactement ce que j'ai construit sur le projet RAG décrit dans mon CV.

## Lancer

```bash
# le plus simple
open demo-rag/index.html          # macOS
xdg-open demo-rag/index.html      # Linux

# ou via un petit serveur (utile pour partager sur le réseau)
npx serve demo-rag
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

## Limites assumées

- Pas de compréhension sémantique profonde (synonymes, négations) → c'est le rôle des embeddings en production.
- Pas de génération de texte libre → c'est le rôle du LLM.
- 20 documents : suffisant pour démontrer, pas pour évaluer la qualité d'un retrieval.
