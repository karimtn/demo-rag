/*
 * Évaluation de la qualité d'un pipeline RAG : jeu de test annoté + métriques + détecteurs d'hallucinations.
 * Partagé entre eval.html (navigateur, pipeline local) et azure/src/eval.ts (Node, pipeline Azure).
 *
 * Un pipeline évalué doit renvoyer : { noMatch, text, citations: [id], retrieved: [{id, ...}] }.
 */
(function (root) {
  const CARS =
    typeof module !== "undefined" && module.exports ? require("./catalog.js").CARS : root.CATALOG.CARS;
  const byId = new Map(CARS.map((c) => [c.id, c]));
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  /*
   * Jeu de test annoté à la main.
   * - relevant : annonces pertinentes (ordre sans importance) ; vide = aucune réponse correcte n'existe.
   * - constraints : critères durs que toute annonce citée doit respecter.
   * - type : ce que la question teste.
   */
  const DATASET = [
    { id: "q01", type: "critères multiples", query: "SUV automatique essence moins de 20 000 € à Lyon", relevant: [1, 2], constraints: { budget: 20000, fuel: "essence", gearbox: "automatique", city: "Lyon", body: "suv" } },
    { id: "q02", type: "critères multiples", query: "citadine électrique budget 15000 €", relevant: [11], constraints: { budget: 15000, fuel: "electrique" } },
    { id: "q03", type: "sémantique", query: "voiture électrique avec grande autonomie", relevant: [6, 15, 20], constraints: { fuel: "electrique" } },
    { id: "q04", type: "sémantique", query: "SUV 7 places pour famille nombreuse", relevant: [14], constraints: {} },
    { id: "q05", type: "critères multiples", query: "break diesel automatique", relevant: [12, 18], constraints: { fuel: "diesel", gearbox: "automatique" } },
    { id: "q06", type: "filtre simple", query: "hybride à Paris", relevant: [5, 16], constraints: { fuel: "hybride", city: "Paris" } },
    { id: "q07", type: "budget", query: "petite voiture pas chère pour la ville moins de 13000 €", relevant: [7, 11, 16], constraints: { budget: 13000 } },
    { id: "q08", type: "sémantique", query: "berline premium diesel", relevant: [9], constraints: { fuel: "diesel" } },
    { id: "q09", type: "sémantique", query: "voiture avec toit panoramique", relevant: [19], constraints: {} },
    { id: "q10", type: "critères multiples", query: "SUV manuelle à Toulouse", relevant: [10], constraints: { gearbox: "manuelle", city: "Toulouse", body: "suv" } },
    { id: "q11", type: "synonymes", query: "véhicule sobre pour trajets quotidiens, peu gourmand en carburant", relevant: [4, 5, 13, 16], constraints: {} },
    { id: "q12", type: "hors catalogue", query: "camping-car 4 places à Marseille", relevant: [], constraints: { city: "Marseille" } },
    { id: "q13", type: "hors catalogue", query: "Tesla Model Y", relevant: [], constraints: {} },
    { id: "q14", type: "critères impossibles", query: "SUV électrique moins de 20000 €", relevant: [], constraints: { budget: 20000, fuel: "electrique", body: "suv" } },
  ];

  // Modèles absents du catalogue : s'ils apparaissent dans une réponse positive, c'est une invention.
  const UNKNOWN_MODELS = ["model y", "model s", "model x", "clio", "megane", "twingo", "sandero", "yaris cross", "ioniq",
    "id.3", "id.4", "tiguan", "t-roc", "qashqai", "juke", "rav4", "c-hr", "kuga", "puma", "x1", "x3", "classe a",
    "fiesta", "2008", "308", "camping-car"];
  // Clé de modèle de chaque annonce (pour repérer une annonce citée sans être dans le contexte).
  const MODEL_KEYS = CARS.map((c) => ({ id: c.id, key: norm(c.title.split(" ").slice(0, c.title.startsWith("Tesla") || c.title.startsWith("BMW") ? 3 : 2).join(" ")) }));

  // Carrosserie : le catalogue n'a pas de champ dédié, on l'annote ici.
  const SUV_IDS = new Set([1, 2, 4, 10, 14, 15, 20]);
  function satisfies(c, k) {
    if (k.body === "suv" && !SUV_IDS.has(c.id)) return false;
    if (k.budget && c.price > k.budget) return false;
    if (k.fuel && c.fuel !== k.fuel) return false;
    if (k.gearbox && c.gearbox !== k.gearbox) return false;
    if (k.city && norm(c.city) !== norm(k.city)) return false;
    return true;
  }

  const parseNum = (s) => parseInt(s.replace(/[\s  .]/g, ""), 10);

  /** Détecteurs déterministes d'hallucinations et d'erreurs de génération. */
  function checkAnswer(item, ans) {
    const issues = [];
    const text = ans.text || "";
    const ntext = norm(text);
    const retrievedIds = new Set((ans.retrieved || []).map((d) => d.id));
    const cited = (ans.citations || []).map(Number);
    const citedCars = cited.map((id) => byId.get(id)).filter(Boolean);
    const queryNums = new Set([...(item.query.matchAll(/\d[\d\s.]*\d/g))].map((m) => parseNum(m[0])));

    // 1. Citations : doivent exister et venir du contexte récupéré.
    cited.forEach((id) => {
      if (!byId.has(id)) issues.push({ kind: "hallucination", msg: `cite une annonce inexistante [${id}]` });
      else if (retrievedIds.size && !retrievedIds.has(id)) issues.push({ kind: "hallucination", msg: `cite [${id}] qui n'était pas dans le contexte` });
    });

    // 2. Prix et kilométrages : chaque chiffre doit appartenir à une annonce citée (ou à la question).
    const prices = [...text.matchAll(/(\d{1,3}(?:[\s  .]\d{3})+|\d{4,6})\s*€/g)].map((m) => parseNum(m[1]));
    prices.forEach((p) => {
      if (!queryNums.has(p) && !citedCars.some((c) => c.price === p))
        issues.push({ kind: "hallucination", msg: `prix ${p.toLocaleString("fr-FR")} € introuvable dans les annonces citées` });
    });
    const kms = [...text.matchAll(/(\d{1,3}(?:[\s  .]\d{3})+|\d{4,6})\s*km\b/g)].map((m) => parseNum(m[1]));
    kms.forEach((k) => {
      if (!queryNums.has(k) && !citedCars.some((c) => c.km === k || /autonomie/.test(c.desc)))
        issues.push({ kind: "hallucination", msg: `kilométrage ${k.toLocaleString("fr-FR")} km introuvable dans les annonces citées` });
    });

    // 3. Modèles : un modèle du catalogue nommé sans être cité, ou un modèle inexistant présenté comme disponible.
    MODEL_KEYS.forEach(({ id, key }) => {
      if (ntext.includes(key) && !cited.includes(id) && !norm(item.query).includes(key))
        issues.push({ kind: "hallucination", msg: `mentionne « ${byId.get(id).title} » sans le citer` });
    });
    if (!ans.noMatch)
      UNKNOWN_MODELS.forEach((m) => {
        if (new RegExp(`(^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}([^a-z0-9]|$)`).test(ntext))
          issues.push({ kind: "hallucination", msg: `présente « ${m} » comme disponible alors qu'il n'est pas au catalogue` });
      });

    // 4. Critères : toute annonce recommandée doit respecter les contraintes de la question.
    citedCars.forEach((c) => {
      if (!satisfies(c, item.constraints)) issues.push({ kind: "contrainte", msg: `recommande [${c.id}] ${c.title} qui ne respecte pas les critères` });
    });

    // 5. Abstention : répondre « rien ne correspond » quand c'est vrai, et seulement dans ce cas.
    const answerable = item.relevant.length > 0;
    if (!answerable && !ans.noMatch) issues.push({ kind: "abstention", msg: "aurait dû répondre qu'aucune annonce ne correspond" });
    if (answerable && ans.noMatch) issues.push({ kind: "abstention", msg: "refuse de répondre alors qu'une annonce pertinente existe" });
    if (answerable && !ans.noMatch && !cited.some((id) => item.relevant.includes(id)))
      issues.push({ kind: "pertinence", msg: "aucune annonce pertinente dans la réponse" });

    return issues;
  }

  /** Métriques de recherche sur le classement renvoyé (seulement pour les questions qui ont une réponse). */
  function retrievalMetrics(item, rankedIds) {
    const rel = new Set(item.relevant);
    const at = (k) => rankedIds.slice(0, k);
    const recall = (k) => at(k).filter((id) => rel.has(id)).length / rel.size;
    const firstHit = rankedIds.findIndex((id) => rel.has(id));
    const dcg = at(5).reduce((s, id, i) => s + (rel.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
    const idcg = [...Array(Math.min(5, rel.size)).keys()].reduce((s, i) => s + 1 / Math.log2(i + 2), 0);
    return {
      hit1: rel.has(rankedIds[0]) ? 1 : 0,
      recall3: recall(3),
      recall5: recall(5),
      mrr: firstHit < 0 ? 0 : 1 / (firstHit + 1),
      ndcg5: idcg ? dcg / idcg : 0,
    };
  }

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  /**
   * Lance l'évaluation complète. `pipeline(query)` peut être synchrone ou asynchrone.
   * `judge(item, ans)` (optionnel) renvoie { relevance: 1-5, faithfulness: 1-5, rationale }.
   */
  async function runEval(pipeline, { judge, name = "pipeline", dataset = DATASET } = {}) {
    const rows = [];
    for (const item of dataset) {
      const t0 = Date.now();
      const ans = await pipeline(item.query);
      const latencyMs = Date.now() - t0;
      const ranked = (ans.retrieved || []).map((d) => d.id);
      const metrics = item.relevant.length ? retrievalMetrics(item, ranked) : null;
      const issues = checkAnswer(item, ans);
      const judgement = judge ? await judge(item, ans) : null;
      rows.push({ item, ans: { noMatch: ans.noMatch, text: ans.text, citations: ans.citations, retrieved: ranked.slice(0, 5) }, metrics, issues, judgement, latencyMs, pass: issues.length === 0 });
    }
    const answerable = rows.filter((r) => r.metrics);
    const kinds = ["hallucination", "contrainte", "abstention", "pertinence"];
    const summary = {
      name,
      date: new Date().toISOString(),
      questions: rows.length,
      passRate: mean(rows.map((r) => (r.pass ? 1 : 0))),
      retrieval: Object.fromEntries(["hit1", "recall3", "recall5", "mrr", "ndcg5"].map((k) => [k, mean(answerable.map((r) => r.metrics[k]))])),
      generation: {
        groundedRate: mean(rows.map((r) => (r.issues.some((i) => i.kind === "hallucination") ? 0 : 1))),
        constraintRate: mean(rows.map((r) => (r.issues.some((i) => i.kind === "contrainte") ? 0 : 1))),
        abstentionAccuracy: mean(rows.map((r) => (r.issues.some((i) => i.kind === "abstention") ? 0 : 1))),
      },
      issuesByKind: Object.fromEntries(kinds.map((k) => [k, rows.reduce((n, r) => n + r.issues.filter((i) => i.kind === k).length, 0)])),
      judge: judge
        ? { relevance: mean(rows.map((r) => r.judgement?.relevance ?? 0)), faithfulness: mean(rows.map((r) => r.judgement?.faithfulness ?? 0)) }
        : null,
      latencyMsP50: rows.map((r) => r.latencyMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
    };
    return { summary, rows };
  }

  const api = { DATASET, checkAnswer, retrievalMetrics, runEval, satisfies };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RAGEval = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
