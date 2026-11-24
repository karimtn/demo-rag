/**
 * Évaluation hors ligne du pipeline, sur le jeu de test annoté de lib/eval-core.js.
 *
 *   npm run eval -- --pipeline local            (aucune clé nécessaire)
 *   npm run eval -- --pipeline azure --judge    (Azure + LLM-as-judge)
 *
 * Écrit eval/reports/<pipeline>.json, affiché par eval.html.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const require = createRequire(import.meta.url);
const { runEval } = require("../../lib/eval-core.js");
const LocalRAG = require("../../lib/local-rag.js");

const args = process.argv.slice(2);
const pipelineName = args[args.indexOf("--pipeline") + 1] ?? "local";
const withJudge = args.includes("--judge");

const Judgement = z.object({
  relevance: z.number().int().min(1).max(5).describe("La réponse répond-elle à la question ? 1 = hors sujet, 5 = parfait"),
  faithfulness: z.number().int().min(1).max(5).describe("Chaque affirmation est-elle soutenue par les annonces du contexte ? 1 = inventé, 5 = entièrement soutenu"),
  rationale: z.string().describe("Une phrase de justification"),
});

const judgePrompt = ChatPromptTemplate.fromMessages([
  ["system", "Tu évalues la réponse d'un assistant de recherche d'annonces automobiles. Sois sévère : toute information absente du contexte compte comme une invention. " +
    "Si le contexte ne contient aucune annonce adaptée, la bonne réponse est de le dire."],
  ["human", "QUESTION : {question}\n\nCONTEXTE (annonces récupérées) :\n{context}\n\nRÉPONSE ÉVALUÉE :\n{answer}"],
]);

async function main() {
  let pipeline: (q: string) => Promise<unknown> | unknown;
  if (pipelineName === "azure") {
    const { CARS, chatModel, vectorStore } = await import("./config.js");
    const { buildRagChain, llmSteps } = await import("./rag.js");
    const chain = buildRagChain({ ...llmSteps(chatModel()), retriever: vectorStore(), catalog: CARS });
    pipeline = (question) => chain.invoke({ question });
  } else {
    pipeline = (q) => LocalRAG.answer(q);
  }

  let judge;
  if (withJudge) {
    const { chatModel } = await import("./config.js");
    const { formatContext } = await import("./rag.js");
    const j = judgePrompt.pipe(chatModel().withStructuredOutput(Judgement, { name: "judgement" }));
    judge = (item: { query: string }, ans: { text: string; retrieved: never[] }) =>
      j.invoke({ question: item.query, context: formatContext((ans.retrieved ?? []).slice(0, 5)), answer: ans.text });
  }

  const report = await runEval(pipeline, { judge, name: pipelineName });
  const out = fileURLToPath(new URL("../../eval/reports/", import.meta.url));
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}${pipelineName}.json`, JSON.stringify(report, null, 2));

  const s = report.summary;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  console.log(`\nÉvaluation « ${pipelineName} » — ${s.questions} questions`);
  console.log(`  Réussite de bout en bout : ${pct(s.passRate)}`);
  console.log(`  Retrieval  hit@1 ${pct(s.retrieval.hit1)} · recall@3 ${pct(s.retrieval.recall3)} · MRR ${s.retrieval.mrr.toFixed(2)} · nDCG@5 ${s.retrieval.ndcg5.toFixed(2)}`);
  console.log(`  Génération ancrage ${pct(s.generation.groundedRate)} · contraintes ${pct(s.generation.constraintRate)} · abstention ${pct(s.generation.abstentionAccuracy)}`);
  if (s.judge) console.log(`  Juge LLM   pertinence ${s.judge.relevance.toFixed(1)}/5 · fidélité ${s.judge.faithfulness.toFixed(1)}/5`);
  for (const r of report.rows.filter((r: { pass: boolean }) => !r.pass))
    console.log(`  ✗ ${r.item.id} ${r.item.query}\n      ${r.issues.map((i: { msg: string }) => i.msg).join("\n      ")}`);
  console.log(`\nRapport : eval/reports/${pipelineName}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
