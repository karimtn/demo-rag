/*
 * Pipeline RAG local (hors-ligne) : TF-IDF + cosinus + extraction de critères + synthèse par règles.
 * Fichier partagé : chargé par <script> dans le navigateur, ou par require() dans Node (évaluation).
 * Il ne dépend que de lib/catalog.js.
 */
(function (root) {
  const CARS =
    typeof module !== "undefined" && module.exports
      ? require("./catalog.js").CARS
      : root.CATALOG.CARS;

  const STOP = new Set(("le la les un une des du de d au aux a et ou en dans sur pour avec sans par plus moins que qui quoi dont " +
    "je tu il elle nous vous ils elles mon ma mes ton ta tes son sa ses ce cet cette ces est sont ai as avons avez ont " +
    "veux voudrais cherche trouver annonce annonces vehicule voiture auto voiture bon pas tres bien").split(" "));

  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const stem = (t) => (t.length > 4 ? t.replace(/(aux|eux|es|s)$/, "") : t);
  const tokens = (s) =>
    norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)).map(stem);

  // --- index TF-IDF ---
  const docText = (c) => `${c.title} ${c.desc} ${c.fuel} ${c.gearbox} ${c.city} ${c.year} ${c.km} km`;
  const docs = CARS.map((c) => tokens(docText(c)));
  const N = docs.length;
  const df = new Map();
  docs.forEach((tk) => new Set(tk).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  function vec(tk) {
    const tf = new Map();
    tk.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    const v = new Map();
    let n2 = 0;
    tf.forEach((c, t) => { const w = (1 + Math.log(c)) * idf(t); v.set(t, w); n2 += w * w; });
    const n = Math.sqrt(n2) || 1;
    v.forEach((w, t) => v.set(t, w / n));
    return v;
  }
  const docVecs = docs.map(vec);
  function cosine(a, b) { let s = 0; a.forEach((w, t) => { if (b.has(t)) s += w * b.get(t); }); return s; }

  // --- extraction de critères (le « self-query » du pipeline local) ---
  const CITIES = ["paris", "lyon", "lille", "nantes", "bordeaux", "toulouse", "marseille"];
  function facets(q) {
    const n = norm(q);
    const f = {};
    const nums = [...n.matchAll(/(\d[\d\s.]{2,7})\s*(?:€|eur|euros?)/g)]
      .map((m) => parseInt(m[1].replace(/[\s.]/g, ""), 10)).filter((v) => v >= 3000 && v <= 200000);
    if (nums.length) f.budget = Math.max(...nums);
    if (/electrique|ev\b|batterie/.test(n)) f.fuel = "electrique";
    else if (/hybride/.test(n)) f.fuel = "hybride";
    else if (/diesel|gasoil/.test(n)) f.fuel = "diesel";
    else if (/essence|sp95|sp98/.test(n)) f.fuel = "essence";
    if (/automatique|auto\b|eat8|dsg|edc/.test(n)) f.gearbox = "automatique";
    else if (/manuelle/.test(n)) f.gearbox = "manuelle";
    const city = CITIES.find((c) => n.includes(c));
    if (city) f.city = city;
    if (/suv|familial|7 places/.test(n)) f.body = "suv";
    if (/citadine|ville|urbain/.test(n)) f.body = "citadine";
    return f;
  }

  /** Une annonce respecte-t-elle les critères « durs » (budget, carburant, boîte, ville) ? */
  function satisfies(c, f) {
    if (f.budget && c.price > f.budget) return false;
    if (f.fuel && c.fuel !== f.fuel) return false;
    if (f.gearbox && c.gearbox !== f.gearbox) return false;
    if (f.city && norm(c.city) !== f.city) return false;
    return true;
  }

  function search(q) {
    const f = facets(q);
    const qv = vec(tokens(q));
    const scored = CARS.map((c) => {
      let s = cosine(qv, docVecs[c.id - 1]);
      if (f.fuel) s += c.fuel === f.fuel ? 0.18 : -0.22;
      if (f.gearbox) s += c.gearbox === f.gearbox ? 0.10 : -0.10;
      if (f.city) s += norm(c.city) === f.city ? 0.12 : -0.14;
      if (f.body === "citadine" && /suv|3008|5008|kona|niro|duster|aircross/i.test(c.title)) s -= 0.10;
      if (f.body === "suv" && /suv|3008|captur|duster|5008|kona|niro|aircross/i.test(c.title)) s += 0.08;
      if (f.body === "citadine" && /208|corsa|polo|500|yaris|c3|mini|zoe/i.test(c.title)) s += 0.08;
      if (f.budget) {
        if (c.price <= f.budget) s += 0.10;
        else s -= Math.min(0.5, (c.price - f.budget) / f.budget);
      }
      return { ...c, score: s };
    }).sort((a, b) => b.score - a.score);
    return { f, scored };
  }

  const fmt = (n) => n.toLocaleString("fr-FR") + " €";
  const MIN_SCORE = 0.08; // en dessous, on considère que rien ne correspond

  /**
   * Génération (par règles) d'une réponse structurée, au même format que la variante Azure :
   * { noMatch, text, citations: [id], facets }.
   * Garde-fou : on ne cite que des annonces récupérées ET conformes aux critères durs.
   */
  function answer(q, k = 3) {
    const { f, scored } = search(q);
    const retrieved = scored.slice(0, 8);
    const ok = retrieved.filter((c) => satisfies(c, f) && c.score >= MIN_SCORE).slice(0, k);
    const crit = [];
    if (f.budget) crit.push(`budget ≤ ${fmt(f.budget)}`);
    if (f.fuel) crit.push(f.fuel);
    if (f.gearbox) crit.push(`boîte ${f.gearbox}`);
    if (f.city) crit.push(f.city);
    const lines = [];
    lines.push(crit.length ? `Critères retenus : ${crit.join(" · ")}` : "Aucun critère structuré détecté — classement textuel.");
    if (!ok.length) {
      lines.push("", "Aucune annonce du catalogue ne correspond à tous vos critères.");
      return { noMatch: true, text: lines.join("\n"), citations: [], facets: f, retrieved };
    }
    lines.push("", ok.length === 1 ? "L'annonce qui correspond :" : `Les ${ok.length} annonces qui correspondent le mieux :`);
    ok.forEach((c, i) => lines.push(`${i + 1}. ${c.title} — ${fmt(c.price)} · ${c.km.toLocaleString("fr-FR")} km · ${c.city} [${c.id}]`));
    return { noMatch: false, text: lines.join("\n"), citations: ok.map((c) => c.id), facets: f, retrieved };
  }

  const api = { CARS, norm, tokens, facets, satisfies, search, answer, fmt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LocalRAG = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
