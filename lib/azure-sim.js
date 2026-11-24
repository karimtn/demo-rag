/*
 * SIMULATION du pipeline Azure OpenAI + Azure AI Search, pour voir son fonctionnement sans clé ni réseau.
 *
 * Elle reproduit les étapes et les formats du vrai code (azure/src/rag.ts) :
 *   1. analyse de la requête      → objet structuré (ce que GPT renvoie via withStructuredOutput)
 *   2. filtre OData               → la même chaîne que celle envoyée à Azure AI Search
 *   3. recherche hybride          → fusion RRF d'un classement « mots-clés » et d'un classement « vecteurs »
 *   4. budget appliqué par le code
 *   5. génération avec citations  → par règles ici (un LLM en production)
 *   6. garde-fous anti-hallucination, identiques au vrai code
 *
 * Ce qui est simulé : l'analyse et la génération (règles au lieu de GPT) et les « vecteurs »
 * (TF-IDF sur une requête enrichie de synonymes au lieu d'embeddings). Les garde-fous et le filtre OData sont réels.
 */
(function (root) {
  const L = typeof module !== "undefined" && module.exports ? require("./local-rag.js") : root.LocalRAG;
  const { CARS, norm, fmt } = L;
  const byId = new Map(CARS.map((c) => [c.id, c]));

  // Ce que des embeddings capteraient et que le TF-IDF rate : des synonymes.
  const SYNONYMS = [
    [/sobre|peu gourmand|economique|consomme peu|econome/, "faible consommation hybride"],
    [/famille|enfants|nombreuse/, "familial 7 places coffre"],
    [/spacieux|grand coffre|chargement/, "coffre break spacieux"],
    [/luxe|haut de gamme|prestige/, "premium cuir"],
    [/ville|urbain|citadin|se garer/, "citadine ville urbain"],
    [/longue distance|autoroute|grands trajets/, "routiere autonomie confort"],
    [/ecolo|zero emission|propre/, "electrique hybride"],
  ];
  // Modèles et types de véhicules absents du catalogue : un LLM bien guidé les reconnaît comme tels.
  const NOT_IN_CATALOG = ["model y", "model s", "model x", "clio", "megane", "twingo", "sandero", "tiguan", "qashqai",
    "rav4", "camping-car", "camping car", "moto", "scooter", "utilitaire", "camion"];
  const SUV = /suv|3008|captur|aircross|duster|5008|kona|niro/i;

  // ---------- 1. Analyse (simulée) ----------
  function analyze(q) {
    const f = L.facets(q);
    const n = norm(q);
    let expansion = "";
    SYNONYMS.forEach(([re, add]) => { if (re.test(n)) expansion += " " + add; });
    const searchQuery = (q.replace(/(moins de|budget|max(imum)?)?\s*\d[\d\s.]*\s*(€|euros?)/gi, " ") + expansion).replace(/\s+/g, " ").trim();
    return {
      searchQuery,
      budget: f.budget ?? null,
      fuel: f.fuel ?? null,
      gearbox: f.gearbox ?? null,
      city: f.city ?? null,
      body: /suv|7 places/.test(n) ? "suv" : null,
      notInCatalog: NOT_IN_CATALOG.find((m) => n.includes(m)) ?? null,
    };
  }

  // ---------- 2. Filtre OData (identique à azure/src/rag.ts) ----------
  const attr = (k, v) => `metadata/attributes/any(a: a/key eq '${k}' and a/value eq '${String(v).replace(/'/g, "''")}')`;
  function buildODataFilter(a) {
    const parts = [];
    if (a.fuel) parts.push(attr("fuel", a.fuel));
    if (a.gearbox) parts.push(attr("gearbox", a.gearbox));
    if (a.city) parts.push(attr("city", a.city.toLowerCase()));
    return parts.length ? parts.join(" and ") : undefined;
  }
  const passesFilter = (c, a) =>
    (!a.fuel || c.fuel === a.fuel) && (!a.gearbox || c.gearbox === a.gearbox) && (!a.city || norm(c.city) === a.city);

  // ---------- 3. Recherche hybride : fusion RRF (Reciprocal Rank Fusion), comme Azure AI Search ----------
  function hybridSearch(q, a, useFilter) {
    const pool = CARS.filter((c) => !useFilter || passesFilter(c, a));
    const ids = new Set(pool.map((c) => c.id));
    const rank = (scores) => scores.filter((s) => ids.has(s.id)).sort((x, y) => y.score - x.score);
    const keyword = rank(L.lexicalScores(q));
    const vector = rank(L.lexicalScores(a.searchQuery || q));
    const rrf = new Map();
    [keyword, vector].forEach((list) => list.forEach((s, i) => rrf.set(s.id, (rrf.get(s.id) || 0) + 1 / (60 + i + 1))));
    const fused = [...rrf].map(([id, score]) => ({ ...byId.get(id), score }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 10);
    return { fused, keyword: keyword.slice(0, 5).map((s) => s.id), vector: vector.slice(0, 5).map((s) => s.id) };
  }

  // ---------- 5. Génération (simulée : règles au lieu de GPT, même format de sortie) ----------
  function generate(q, a, context) {
    if (a.notInCatalog)
      return { noMatch: true, answer: `Le catalogue ne contient pas de « ${a.notInCatalog} ». Aucune annonce ne correspond.`, citations: [] };
    const ok = context.filter((c) => passesFilter(c, a) && (!a.budget || c.price <= a.budget) && (a.body !== "suv" || SUV.test(c.title))).slice(0, 3);
    if (!ok.length) return { noMatch: true, answer: "Aucune annonce du catalogue ne correspond à tous vos critères.", citations: [] };
    return {
      noMatch: false,
      answer: ok.map((c, i) => `${i + 1}. ${c.title} — ${fmt(c.price)} · ${c.km.toLocaleString("fr-FR")} km · ${c.city} [${c.id}]`).join("\n"),
      citations: ok.map((c) => c.id),
    };
  }

  /** Erreurs typiques d'un LLM, injectées à la demande pour voir les garde-fous agir. */
  function injectHallucination(out, context) {
    if (out.noMatch) return { noMatch: false, answer: "Je vous recommande la Tesla Model Y Grande Autonomie à 31 500 € [99].", citations: [99] };
    const first = byId.get(out.citations[0]);
    const wrong = Math.round(first.price * 0.9 / 100) * 100;
    return { ...out, answer: out.answer.replace(fmt(first.price), fmt(wrong)) + "\n4. Peugeot 308 GT — 21 900 € [99]", citations: [...out.citations, 99] };
  }

  // ---------- 6. Garde-fous (identiques à applyGuardrails dans azure/src/rag.ts) ----------
  function applyGuardrails(out, context, a, question) {
    const notes = [];
    const inCtx = new Map(context.map((c) => [c.id, c]));
    let citations = [...new Set(out.citations)].filter((id) => {
      if (!inCtx.has(id)) { notes.push(`citation [${id}] supprimée : absente du contexte`); return false; }
      if (a.budget && inCtx.get(id).price > a.budget) { notes.push(`citation [${id}] supprimée : hors budget`); return false; }
      return true;
    });
    const cited = citations.map((id) => inCtx.get(id));
    const qNums = new Set([...question.matchAll(/\d[\d\s.]*\d/g)].map((m) => parseInt(m[0].replace(/[\s.]/g, ""), 10)));
    for (const m of out.answer.matchAll(/(\d{1,3}(?:[\s  .]\d{3})+|\d{4,6})\s*€/g)) {
      const p = parseInt(m[1].replace(/[\s  .]/g, ""), 10);
      if (!qNums.has(p) && !cited.some((c) => c.price === p)) notes.push(`prix ${fmt(p)} non vérifiable`);
    }
    let noMatch = out.noMatch;
    let text = out.answer;
    if (!noMatch && citations.length === 0) {
      noMatch = true;
      text = "Aucune annonce du catalogue ne correspond à votre demande.";
      notes.push("réponse sans citation valide : remplacée par une abstention");
    }
    if (noMatch) citations = [];
    if (!noMatch && notes.some((n) => n.startsWith("prix") || n.startsWith("citation"))) {
      text = cited.map((c, i) => `${i + 1}. ${c.title} — ${fmt(c.price)} · ${c.km.toLocaleString("fr-FR")} km · ${c.city} [${c.id}]`).join("\n");
      notes.push("texte régénéré à partir des données vérifiées");
    }
    return { noMatch, text, citations, notes };
  }

  // ---------- Pipeline complet, avec la trace de chaque étape ----------
  function answer(q, { inject = false } = {}) {
    const trace = [];
    const a = analyze(q);
    trace.push({ step: "1. Analyse de la requête (GPT, sortie structurée)", detail: JSON.stringify(a, null, 1) });
    const filter = buildODataFilter(a);
    trace.push({ step: "2. Filtre OData envoyé à Azure AI Search", detail: filter || "(aucun)" });
    let h = hybridSearch(q, a, true);
    let relaxed = false;
    if (!h.fused.length && filter) { h = hybridSearch(q, a, false); relaxed = true; }
    trace.push({ step: "3. Recherche hybride (mots-clés + vecteurs, fusion RRF)",
      detail: `mots-clés : ${h.keyword.join(", ") || "—"}\nvecteurs  : ${h.vector.join(", ") || "—"}\nfusion    : ${h.fused.slice(0, 5).map((c) => c.id).join(", ") || "—"}` +
        (relaxed ? "\n(0 résultat avec le filtre : recherche relancée sans filtre)" : "") });
    const retrieved = h.fused.filter((c) => !a.budget || c.price <= a.budget);
    const context = retrieved.slice(0, 5);
    trace.push({ step: "4. Budget appliqué par le code", detail: a.budget ? `≤ ${fmt(a.budget)} : ${h.fused.length - retrieved.length} annonce(s) écartée(s)` : "pas de budget" });
    let draft = context.length || a.notInCatalog ? generate(q, a, context) : { noMatch: true, answer: "Aucune annonce du catalogue ne correspond à vos critères.", citations: [] };
    if (inject) draft = injectHallucination(draft, context);
    trace.push({ step: `5. Génération avec citations${inject ? " — erreur du LLM injectée" : ""}`, detail: draft.answer });
    const g = applyGuardrails(draft, context, a, q);
    trace.push({ step: "6. Garde-fous anti-hallucination", detail: g.notes.length ? g.notes.join("\n") : "aucune correction nécessaire" });
    return {
      noMatch: g.noMatch, text: g.text, citations: g.citations, guardrails: g.notes,
      retrieved, facets: { budget: a.budget, fuel: a.fuel, gearbox: a.gearbox, city: a.city }, analysis: a, filter, trace,
    };
  }

  const api = { analyze, buildODataFilter, hybridSearch, applyGuardrails, answer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AzureSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
