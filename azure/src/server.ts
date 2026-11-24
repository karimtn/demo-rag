/**
 * API HTTP de la variante Azure, appelée par index.html (mode « Azure OpenAI »).
 *
 *   npm run dev          → http://localhost:8787
 *   POST /api/ask  { "question": "SUV automatique moins de 20 000 €" }
 */
import express from "express";
import cors from "cors";
import { CARS, chatModel, vectorStore } from "./config.js";
import { buildRagChain, llmSteps } from "./rag.js";

const chain = buildRagChain({ ...llmSteps(chatModel()), retriever: vectorStore(), catalog: CARS });

const app = express();
app.use(express.json({ limit: "8kb" }));
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS ?? "https://karimtn.github.io,http://localhost:3000,http://127.0.0.1:5500").split(","),
}));

// Limite simple par IP : la démo est publique et chaque appel coûte des jetons.
const hits = new Map<string, number[]>();
app.use("/api", (req, res, next) => {
  const ip = req.ip ?? "?";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) return res.status(429).json({ error: "Trop de requêtes, réessayez dans une minute." });
  hits.set(ip, [...recent, now]);
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/ask", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question || question.length > 300) return res.status(400).json({ error: "Question vide ou trop longue (300 caractères max)." });
  const t0 = Date.now();
  try {
    const r = await chain.invoke({ question });
    res.json({ ...r, latencyMs: Date.now() - t0 });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Le service Azure n'a pas répondu." });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`API RAG Azure sur http://localhost:${port}`));
