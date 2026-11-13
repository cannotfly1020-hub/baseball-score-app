/** 解析 API が返す計測メタ（プロンプト非依存） */
export type AnalyzeUsageMeta = {
  model: string;
  modelsUsed?: string[];
  elapsedMs: number;
  elapsedSec: number;
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    thoughtsTokenCount: number;
    totalTokenCount: number;
  };
  estimatedCostYen: number;
  estimatedCostNote?: string;
  calls?: Array<{
    step: string;
    model: string;
    usage: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      thoughtsTokenCount: number;
      totalTokenCount: number;
    };
  }>;
};

export function emptyAnalyzeUsageMeta(): AnalyzeUsageMeta {
  return {
    model: "",
    elapsedMs: 0,
    elapsedSec: 0,
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    totalTokenCount: 0,
    estimatedCostYen: 0,
  };
}

/** 複数ページ解析のメタを合算 */
export function mergeAnalyzeUsageMeta(
  parts: Array<AnalyzeUsageMeta | null | undefined>,
): AnalyzeUsageMeta | null {
  const list = parts.filter((p): p is AnalyzeUsageMeta => Boolean(p?.model || p?.totalTokenCount));
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  const merged = emptyAnalyzeUsageMeta();
  const models: string[] = [];
  const calls: AnalyzeUsageMeta["calls"] = [];
  for (const p of list) {
    merged.elapsedMs += p.elapsedMs || 0;
    merged.promptTokenCount += p.promptTokenCount || 0;
    merged.candidatesTokenCount += p.candidatesTokenCount || 0;
    merged.thoughtsTokenCount += p.thoughtsTokenCount || 0;
    merged.totalTokenCount += p.totalTokenCount || 0;
    merged.estimatedCostYen += p.estimatedCostYen || 0;
    if (p.model) models.push(p.model);
    if (p.calls) calls.push(...p.calls);
  }
  merged.elapsedSec = Math.round((merged.elapsedMs / 1000) * 10) / 10;
  merged.estimatedCostYen = Math.round(merged.estimatedCostYen * 100) / 100;
  merged.model = [...new Set(models)].join(" / ");
  merged.modelsUsed = models;
  merged.usageMetadata = {
    promptTokenCount: merged.promptTokenCount,
    candidatesTokenCount: merged.candidatesTokenCount,
    thoughtsTokenCount: merged.thoughtsTokenCount,
    totalTokenCount: merged.totalTokenCount,
  };
  merged.calls = calls;
  merged.estimatedCostNote = list[0]?.estimatedCostNote;
  return merged;
}

export function formatAnalyzeUsageLine(meta: AnalyzeUsageMeta): string {
  const sec = meta.elapsedSec || Math.round(((meta.elapsedMs || 0) / 1000) * 10) / 10;
  const inT = meta.promptTokenCount || 0;
  const think = meta.thoughtsTokenCount || 0;
  const outT = meta.candidatesTokenCount || 0;
  const total = meta.totalTokenCount || inT + think + outT;
  const yen =
    typeof meta.estimatedCostYen === "number"
      ? meta.estimatedCostYen.toFixed(2)
      : "—";
  return `${meta.model || "—"} / ${sec}秒 / 合計${total.toLocaleString()}トークン（入力${inT.toLocaleString()}・思考${think.toLocaleString()}・出力${outT.toLocaleString()}） / 推定¥${yen}`;
}
