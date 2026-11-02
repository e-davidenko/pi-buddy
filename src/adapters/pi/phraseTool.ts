/** Инструмент для агента: «добавь Сальсе фраз про Kafka» прямо в чате */
import type { BuddyApp } from "../../app/buddy.ts";
import { learnPhrases } from "../../app/phrases.ts";
import { TOPICS, TOPIC_HINT } from "../../content/topicHints.ts";
import { TOPIC_POSES } from "../../domain/topics.ts";

export async function registerPhraseTool(pi: any, app: BuddyApp, state: { ready: boolean }) {
  if (state.ready || typeof pi.registerTool !== "function") return;
  let Type: any = null;
  for (const m of ["typebox", "@sinclair/typebox"]) {
    try {
      Type = (await import(m)).Type;
      if (Type) break;
    } catch {
      /* следующий */
    }
  }
  if (!Type) return; // без схем инструмент не зарегистрировать — остаётся /buddy learn
  state.ready = true;
  pi.registerTool({
    name: "buddy_phrases",
    label: "Buddy phrases",
    description:
      "Add new speech phrases to the user's terminal pet (buddy extension). Use ONLY when the user asks to " +
      "teach/extend the pet's phrases. Phrases must be Russian, at most 34 characters, in the pet's character. " +
      `Topics: ${TOPICS.map((t) => `${t} (${TOPIC_HINT[t]})`).join("; ")}. ` +
      "Body/pose remarks may be prefixed with @stand:, @walk:, @lie: or @sit:, but only with the pose the pet is in for that topic: " +
      TOPICS.map((t) => `${t}=${TOPIC_POSES[t].join("/")}`).join(", ") +
      ".",
    promptSnippet: "Teach the user's terminal pet new phrases",
    parameters: Type.Object({
      topic: Type.String({ description: "One of the topics listed in the tool description" }),
      phrases: Type.Array(Type.String(), { description: "New phrases, each at most 34 characters" }),
    }),
    async execute(_id: string, params: { topic: string; phrases: string[] }) {
      const t = TOPICS.find((x) => x === params.topic);
      if (!t) {
        return { content: [{ type: "text", text: `Unknown topic "${params.topic}". Valid: ${TOPICS.join(", ")}` }], details: {} };
      }
      const { list, n } = learnPhrases(app, t, params.phrases);
      if (n) {
        app.say(`новые фразы: ${n}!`, 5000);
        app.react("happy", 4000);
        app.render();
      }
      return {
        content: [
          {
            type: "text",
            text: n
              ? `Added ${n} phrase(s) to topic ${t} for ${app.s.name}: ${list.join(" | ")}`
              : "Nothing added: all phrases were duplicates, empty or longer than 34 characters.",
          },
        ],
        details: { added: n },
      };
    },
  });
}
