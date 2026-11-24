/**
 * Tests du pipeline sans appel réseau : le LLM et Azure AI Search sont remplacés par des doublures.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunnableLambda } from "@langchain/core/runnables";
import { Document } from "@langchain/core/documents";
import { CARS } from "../src/config.js";
import { carToDocument } from "../src/ingest.js";
import { applyGuardrails, buildODataFilter, buildRagChain, docToCarId, type GroundedAnswer, type QueryAnalysis } from "../src/rag.js";

const noCriteria: QueryAnalysis = { searchQuery: "", budget: null, fuel: null, gearbox: null, city: null };

/** Faux index : renvoie les annonces dans l'ordre donné, en respectant le filtre carburant. */
function fakeRetriever(order: number[]) {
  const calls: (string | undefined)[] = [];
  return {
    calls,
    async similaritySearchWithScore(_q: string, k = 4, filter?: { filterExpression?: string }) {
      calls.push(filter?.filterExpression);
      const fuel = filter?.filterExpression?.match(/key eq 'fuel' and a\/value eq '(\w+)'/)?.[1];
      return order.map((id) => CARS[id - 1]).filter((c) => !fuel || c.fuel === fuel).slice(0, k)
        .map((c, i) => [carToDocument(c), 1 - i * 0.1] as [Document, number]);
    },
  };
}

const chainWith = (analysis: QueryAnalysis, answer: GroundedAnswer, order: number[]) => {
  const retriever = fakeRetriever(order);
  const chain = buildRagChain({
    analyzer: RunnableLambda.from(async () => analysis),
    generator: RunnableLambda.from(async () => answer),
    retriever,
    catalog: CARS,
  });
  return { chain, retriever };
};

test("le filtre OData combine les critères et échappe les apostrophes", () => {
  const f = buildODataFilter({ ...noCriteria, fuel: "diesel", city: "L'Haÿ" });
  assert.equal(f, "metadata/attributes/any(a: a/key eq 'fuel' and a/value eq 'diesel') and metadata/attributes/any(a: a/key eq 'city' and a/value eq 'l''haÿ')");
  assert.equal(buildODataFilter(noCriteria), undefined);
});

test("l'identifiant d'annonce est relu depuis les métadonnées indexées", () => {
  assert.equal(docToCarId(carToDocument(CARS[11])), 12);
});

test("le budget est appliqué par le code, pas par le LLM", async () => {
  const { chain, retriever } = chainWith({ ...noCriteria, budget: 15000, fuel: "electrique" },
    { noMatch: false, answer: "Renault Zoé R135 Intens — 11 900 € [11]", citations: [11] }, [6, 11, 15, 20]);
  const r = await chain.invoke({ question: "électrique moins de 15000 €" });
  assert.deepEqual(r.retrieved.map((c) => c.id), [11]);
  assert.match(retriever.calls[0] ?? "", /electrique/);
  assert.deepEqual(r.citations, [11]);
  assert.deepEqual(r.guardrails, []);
});

test("garde-fou : une citation inventée est supprimée et la réponse devient une abstention", async () => {
  const { chain } = chainWith({ ...noCriteria, searchQuery: "Tesla Model Y" },
    { noMatch: false, answer: "La Tesla Model Y à 35 000 € est idéale [99]", citations: [99] }, [6]);
  const r = await chain.invoke({ question: "Tesla Model Y" });
  assert.equal(r.noMatch, true);
  assert.deepEqual(r.citations, []);
  assert.ok(r.guardrails.some((g) => g.includes("[99]")));
});

test("garde-fou : un prix inventé fait régénérer le texte à partir des données", () => {
  const out = applyGuardrails({ noMatch: false, answer: "Peugeot 3008 à 18 500 € [1]", citations: [1] }, [CARS[0]], noCriteria, "SUV");
  assert.ok(out.notes.some((n) => n.startsWith("prix")));
  assert.match(out.text, /19[\s\u202f]900 €/);
  assert.doesNotMatch(out.text, /18 500/);
});

test("contexte vide : pas d'appel au LLM, abstention directe", async () => {
  let called = false;
  const chain = buildRagChain({
    analyzer: RunnableLambda.from(async () => ({ ...noCriteria, budget: 5000 })),
    generator: RunnableLambda.from(async () => { called = true; return { noMatch: false, answer: "", citations: [] }; }),
    retriever: fakeRetriever([1, 2, 3]),
    catalog: CARS,
  });
  const r = await chain.invoke({ question: "voiture à moins de 5000 €" });
  assert.equal(called, false);
  assert.equal(r.noMatch, true);
});
