/**
 * Pipeline RAG Azure orchestré avec LangChain.js :
 *
 *   question ──► 1. analyse (LLM, sortie structurée) ──► critères + requête reformulée
 *            ──► 2. retrieval hybride Azure AI Search (BM25 + vecteurs) + filtre OData
 *            ──► 3. filtre budget côté code (les prix ne sont jamais confiés au LLM)
 *            ──► 4. génération ancrée (LLM, sortie structurée avec citations)
 *            ──► 5. garde-fous post-génération (citations, prix, abstention)
 */
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda, RunnableSequence, type Runnable } from "@langchain/core/runnables";
import type { Document } from "@langchain/core/documents";
import type { Car } from "./config.js";

// ---------- Schémas de sortie structurée ----------

export const QueryAnalysis = z.object({
  searchQuery: z.string().describe("La demande reformulée pour la recherche, sans les critères chiffrés"),
  budget: z.number().nullable().describe("Prix maximum en euros, ou null"),
  fuel: z.enum(["essence", "diesel", "hybride", "electrique"]).nullable(),
  gearbox: z.enum(["automatique", "manuelle"]).nullable(),
  city: z.string().nullable().describe("Ville en minuscules, ou null"),
});
export type QueryAnalysis = z.infer<typeof QueryAnalysis>;

export const GroundedAnswer = z.object({
  noMatch: z.boolean().describe("true si AUCUNE annonce du contexte ne répond à la demande"),
  answer: z.string().describe("Réponse en français, 3 à 6 lignes, chaque annonce suivie de son identifiant entre crochets, ex. [12]"),
  citations: z.array(z.number()).describe("Identifiants des annonces recommandées, tous issus du contexte"),
});
export type GroundedAnswer = z.infer<typeof GroundedAnswer>;

// ---------- Prompts ----------

const analysisPrompt = ChatPromptTemplate.fromMessages([
  ["system",
    "Tu extrais les critères d'une recherche de voiture d'occasion. N'invente aucun critère absent de la demande. " +
    "Carburant « électrique » s'écrit « electrique »."],
  ["human", "{question}"],
]);

const answerPrompt = ChatPromptTemplate.fromMessages([
  ["system",
    "Tu es l'assistant d'un site d'annonces automobiles. Règles strictes :\n" +
    "1. Réponds UNIQUEMENT à partir des annonces du CONTEXTE. N'utilise aucune connaissance externe.\n" +
    "2. Cite chaque annonce recommandée avec son identifiant entre crochets, ex. [12].\n" +
    "3. Recopie les prix et kilométrages exactement comme dans le contexte ; ne calcule et n'arrondis rien.\n" +
    "4. Ne mentionne jamais un modèle qui n'est pas dans le contexte, même pour dire qu'il serait une bonne idée.\n" +
    "5. Si aucune annonce ne répond vraiment à la demande (modèle, type de véhicule ou critère impossible), " +
    "mets noMatch à true, citations à [] et explique brièvement pourquoi, sans proposer d'annonce.\n" +
    "6. Recommande au plus 3 annonces."],
  ["human", "QUESTION : {question}\nCRITÈRES DÉTECTÉS : {criteria}\n\nCONTEXTE :\n{context}"],
]);

// ---------- Étapes déterministes (testables sans Azure) ----------

const odataEscape = (s: string) => s.replace(/'/g, "''");
const attr = (key: string, value: string) =>
  `metadata/attributes/any(a: a/key eq '${key}' and a/value eq '${odataEscape(value)}')`;

/** Filtre OData appliqué par Azure AI Search sur les métadonnées de l'index. */
export function buildODataFilter(a: QueryAnalysis): string | undefined {
  const parts: string[] = [];
  if (a.fuel) parts.push(attr("fuel", a.fuel));
  if (a.gearbox) parts.push(attr("gearbox", a.gearbox));
  if (a.city) parts.push(attr("city", a.city.toLowerCase()));
  return parts.length ? parts.join(" and ") : undefined;
}

export function docToCarId(d: Document): number {
  const id = (d.metadata?.attributes as { key: string; value: string }[] | undefined)?.find((x) => x.key === "id")?.value
    ?? String(d.metadata?.source ?? "").replace("annonce-", "");
  return Number(id);
}

const fmtPrice = (n: number) => `${n.toLocaleString("fr-FR")} €`;
export function formatContext(cars: Car[]): string {
  return cars.map((c) =>
    `[${c.id}] ${c.title} — ${fmtPrice(c.price)} · ${c.year} · ${c.km.toLocaleString("fr-FR")} km · ${c.fuel} · ` +
    `boîte ${c.gearbox} · ${c.city}\n    ${c.desc}`).join("\n");
}

export type RagResult = {
  noMatch: boolean;
  text: string;
  citations: number[];
  retrieved: (Car & { score: number })[];
  analysis: QueryAnalysis;
  filter?: string;
  guardrails: string[];
};

/**
 * Garde-fous post-génération : on ne fait pas confiance aveuglément au LLM.
 * - citations hors contexte → supprimées ;
 * - annonce citée qui dépasse le budget → supprimée ;
 * - prix absent des annonces citées → signalé ;
 * - réponse positive sans citation valide → transformée en abstention.
 */
export function applyGuardrails(out: GroundedAnswer, context: Car[], a: QueryAnalysis, question: string) {
  const notes: string[] = [];
  const inCtx = new Map(context.map((c) => [c.id, c]));
  let citations = [...new Set(out.citations)].filter((id) => {
    if (!inCtx.has(id)) { notes.push(`citation [${id}] supprimée : absente du contexte`); return false; }
    const c = inCtx.get(id)!;
    if (a.budget && c.price > a.budget) { notes.push(`citation [${id}] supprimée : hors budget`); return false; }
    return true;
  });
  const cited = citations.map((id) => inCtx.get(id)!);
  const questionNums = new Set([...question.matchAll(/\d[\d\s.]*\d/g)].map((m) => parseInt(m[0].replace(/[\s.]/g, ""), 10)));
  for (const m of out.answer.matchAll(/(\d{1,3}(?:[\s  .]\d{3})+|\d{4,6})\s*€/g)) {
    const p = parseInt(m[1].replace(/[\s  .]/g, ""), 10);
    if (!questionNums.has(p) && !cited.some((c) => c.price === p)) notes.push(`prix ${fmtPrice(p)} non vérifiable`);
  }
  let noMatch = out.noMatch;
  let text = out.answer;
  if (!noMatch && citations.length === 0) {
    noMatch = true;
    text = "Aucune annonce du catalogue ne correspond à votre demande.";
    notes.push("réponse sans citation valide : remplacée par une abstention");
  }
  if (noMatch) citations = [];
  if (notes.some((n) => n.startsWith("prix")) && !noMatch) {
    // Un chiffre inventé : on reconstruit une réponse sûre à partir des données plutôt que d'afficher le texte du LLM.
    text = cited.map((c, i) => `${i + 1}. ${c.title} — ${fmtPrice(c.price)} · ${c.km.toLocaleString("fr-FR")} km · ${c.city} [${c.id}]`).join("\n");
    notes.push("texte régénéré à partir des données vérifiées");
  }
  return { noMatch, text, citations, notes };
}

// ---------- Assemblage LangChain ----------

export type Retriever = {
  similaritySearchWithScore(q: string, k?: number, filter?: { filterExpression?: string }): Promise<[Document, number][]>;
};

export type Deps = {
  analyzer: Runnable<{ question: string }, QueryAnalysis>;
  generator: Runnable<{ question: string; criteria: string; context: string }, GroundedAnswer>;
  retriever: Retriever;
  catalog: Car[];
  k?: number;
};

/** Construit les deux appels LLM à sortie structurée à partir d'un modèle de chat (AzureChatOpenAI en prod). */
export function llmSteps(chat: { withStructuredOutput: Function }) {
  return {
    analyzer: analysisPrompt.pipe(chat.withStructuredOutput(QueryAnalysis, { name: "query_analysis" })) as Deps["analyzer"],
    generator: answerPrompt.pipe(chat.withStructuredOutput(GroundedAnswer, { name: "grounded_answer" })) as Deps["generator"],
  };
}

export function buildRagChain({ analyzer, generator, retriever, catalog, k = 5 }: Deps) {
  const byId = new Map(catalog.map((c) => [c.id, c]));

  const retrieve = RunnableLambda.from(async (s: { question: string; analysis: QueryAnalysis }) => {
    const filter = buildODataFilter(s.analysis);
    let hits = await retriever.similaritySearchWithScore(s.analysis.searchQuery || s.question, 10, filter ? { filterExpression: filter } : undefined);
    // Si le filtre est trop strict (0 résultat), on relâche pour laisser le LLM expliquer l'absence.
    if (!hits.length && filter) hits = await retriever.similaritySearchWithScore(s.analysis.searchQuery || s.question, 10);
    const retrieved = hits
      .map(([d, score]) => ({ ...byId.get(docToCarId(d))!, score }))
      .filter((c) => c.id && (!s.analysis.budget || c.price <= s.analysis.budget));
    return { ...s, filter, retrieved };
  });

  const generate = RunnableLambda.from(async (s: { question: string; analysis: QueryAnalysis; filter?: string; retrieved: RagResult["retrieved"] }): Promise<RagResult> => {
    const context = s.retrieved.slice(0, k);
    if (!context.length) {
      return { noMatch: true, text: "Aucune annonce du catalogue ne correspond à vos critères.", citations: [], retrieved: s.retrieved, analysis: s.analysis, filter: s.filter, guardrails: ["contexte vide : pas d'appel au LLM"] };
    }
    const a = s.analysis;
    const criteria = [a.budget && `budget ≤ ${fmtPrice(a.budget)}`, a.fuel, a.gearbox && `boîte ${a.gearbox}`, a.city].filter(Boolean).join(" · ") || "aucun";
    const out = await generator.invoke({ question: s.question, criteria, context: formatContext(context) });
    const g = applyGuardrails(out, context, a, s.question);
    return { noMatch: g.noMatch, text: g.text, citations: g.citations, retrieved: s.retrieved, analysis: a, filter: s.filter, guardrails: g.notes };
  });

  return RunnableSequence.from([
    async (input: { question: string }) => ({ question: input.question, analysis: await analyzer.invoke({ question: input.question }) }),
    retrieve,
    generate,
  ]);
}
