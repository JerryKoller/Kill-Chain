const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

export const SYSTEM_PROMPT = [
  "You are a careful coding assistant answering questions about a Windows Electron + React + TypeScript audio app.",
  "Name files and symbols only when you are confident they exist.",
  "If evidence is missing, say so. Do not invent files, symbols, or root causes.",
  "Do not claim tests passed unless you actually ran them.",
  "Prefer the smallest correct change. If a requested change would be unsafe, refuse and explain.",
].join(" ");

function stripThink(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|?thought\|?>[\s\S]*?<\/\|?thought\|?>/gi, "")
    .trim();
}

async function postJson(url, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

export async function ollamaChat({
  model,
  system = SYSTEM_PROMPT,
  user,
  host = DEFAULT_HOST,
  timeoutMs = 180000,
  temperature = 0,
  seed = 7,
  numPredict = 900,
  numCtx = 16384,
} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const options = {
    temperature,
    seed,
    top_p: 1,
    num_predict: numPredict,
    num_ctx: numCtx,
  };
  try {
    const chat = await postJson(`${host}/api/chat`, {
      model,
      stream: false,
      think: false,
      keep_alive: "30m",
      options,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }, ctrl.signal);
    if (chat.ok) {
      const msg = chat.json?.message?.content || chat.json?.response || "";
      return {
        text: stripThink(msg),
        thinking: stripThink(chat.json?.message?.thinking || ""),
        evalCount: chat.json?.eval_count,
        promptEvalCount: chat.json?.prompt_eval_count,
        totalDurationNs: chat.json?.total_duration,
        endpoint: "chat",
      };
    }
    const prompt = `${system}\n\n${user}`;
    const gen = await postJson(`${host}/api/generate`, {
      model,
      prompt,
      stream: false,
      think: false,
      keep_alive: "30m",
      options,
    }, ctrl.signal);
    if (!gen.ok) {
      throw new Error(`ollama ${gen.status}: ${JSON.stringify(gen.json).slice(0, 400)}`);
    }
    return {
      text: stripThink(gen.json?.response || ""),
      thinking: "",
      evalCount: gen.json?.eval_count,
      promptEvalCount: gen.json?.prompt_eval_count,
      totalDurationNs: gen.json?.total_duration,
      endpoint: "generate",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaTags(host = DEFAULT_HOST) {
  const res = await fetch(`${host}/api/tags`);
  if (!res.ok) throw new Error(`ollama tags ${res.status}`);
  return res.json();
}
