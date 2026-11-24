/** Les détecteurs d'évaluation attrapent-ils vraiment les erreurs ? On leur soumet des réponses fautives. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DATASET, checkAnswer, retrievalMetrics } = require("../../lib/eval-core.js");
const item = (id: string) => DATASET.find((d: { id: string }) => d.id === id);
const ctx = (...ids: number[]) => ids.map((id) => ({ id }));
const kinds = (issues: { kind: string }[]) => issues.map((i) => i.kind).sort();

test("réponse correcte : aucun problème", () => {
  const issues = checkAnswer(item("q02"), { noMatch: false, text: "Renault Zoé R135 Intens — 11 900 € · 41 000 km · Lyon [11]", citations: [11], retrieved: ctx(11, 17) });
  assert.deepEqual(issues, []);
});

test("prix inventé détecté", () => {
  const issues = checkAnswer(item("q02"), { noMatch: false, text: "Renault Zoé à 9 900 € [11]", citations: [11], retrieved: ctx(11) });
  assert.deepEqual(kinds(issues), ["hallucination"]);
});

test("modèle hors catalogue présenté comme disponible", () => {
  const issues = checkAnswer(item("q13"), { noMatch: false, text: "Je vous propose une Tesla Model Y [6]", citations: [6], retrieved: ctx(6) });
  assert.ok(kinds(issues).includes("hallucination"));
  assert.ok(kinds(issues).includes("abstention"));
});

test("citation absente du contexte et annonce hors budget", () => {
  const issues = checkAnswer(item("q02"), { noMatch: false, text: "Kia e-Niro 64 kWh [20]", citations: [20], retrieved: ctx(11) });
  assert.ok(issues.some((i: { msg: string }) => i.msg.includes("pas dans le contexte")));
  assert.ok(kinds(issues).includes("contrainte"));
});

test("abstention correcte sur une question impossible", () => {
  assert.deepEqual(checkAnswer(item("q14"), { noMatch: true, text: "Aucun SUV électrique sous 20 000 € dans le catalogue.", citations: [], retrieved: ctx(15, 20) }), []);
});

test("métriques de retrieval", () => {
  const m = retrievalMetrics({ relevant: [1, 2] }, [3, 1, 2]);
  assert.equal(m.hit1, 0);
  assert.equal(m.mrr, 0.5);
  assert.equal(m.recall3, 1);
});
