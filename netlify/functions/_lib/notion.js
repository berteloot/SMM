const NOTION_API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

function headers() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error("NOTION_API_KEY is not set");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": VERSION,
    "Content-Type": "application/json",
  };
}

const t = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);

function recoEmoji(reco) {
  if (reco === "ADVANCE") return "🟢";
  if (reco === "MAYBE") return "🟡";
  if (reco === "PASS") return "🔴";
  return "👤";
}

export async function pushCandidate({ candidate, evaluation, videoUrl, evaluationUrl }) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    console.warn("notion_skipped, no NOTION_DATABASE_ID");
    return null;
  }

  const fullName = `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim() || candidate.email || "Unknown";

  const properties = {
    Name: { title: t(fullName) },
    "✉️ Email": { email: candidate.email || null },
    "🔗 LinkedIn": { url: candidate.linkedin || null },
    "📅 Submitted": candidate.submitted_at ? { date: { start: candidate.submitted_at } } : { date: null },
    "🚦 Status": { select: { name: "New" } },
    "🎥 Video": { url: videoUrl || null },
    "📊 Eval JSON": { url: evaluationUrl || null },
  };

  if (evaluation) {
    properties["🎯 Reco"] = { select: { name: evaluation.recommendation || "MAYBE" } };
    properties["⭐ Score"] = { number: typeof evaluation.total === "number" ? evaluation.total : null };
    properties["🚩 Flag"] = { checkbox: !!evaluation.flagged_low_score };
    properties["🧭 Mission"] = { number: evaluation.scores?.mission_clarity ?? null };
    properties["⚙️ Ops"] = { number: evaluation.scores?.operational_readiness ?? null };
    properties["👑 Leadership"] = { number: evaluation.scores?.leadership_under_pressure ?? null };
    properties["🤝 Coalition"] = { number: evaluation.scores?.coalition_relationship_building ?? null };
    properties["💰 Fundraising"] = { number: evaluation.scores?.fundraising_credibility ?? null };
    properties["🎤 Communication"] = { number: evaluation.scores?.communication_quality ?? null };
    properties["🌟 Culture"] = { number: evaluation.scores?.cultural_fit ?? null };
    properties["✅ Strengths"] = { rich_text: t(evaluation.strengths) };
    properties["⚠️ Concerns"] = { rich_text: t(evaluation.concerns) };
    properties["👁️ Body Language"] = { rich_text: t(evaluation.behavioral_observations) };
  }

  const icon = { type: "emoji", emoji: recoEmoji(evaluation?.recommendation) };

  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      icon,
      properties,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`notion_create_failed: ${res.status} ${body.code || ""} ${body.message || ""}`);
  }
  return { id: body.id, url: body.url };
}
