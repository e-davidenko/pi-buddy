/** Что делает агент — по имени инструмента и аргументам: поза питомца и тема реплики */
import type { PxState, Topic } from "./types.ts";

/** Инструменты, которые запускают субагентов (пример subagent из pi и похожие расширения) */
export const SUBAGENT_TOOL = /^(subagents?|sub_agents?|task|tasks|agent|agents|delegate|spawn_?agents?|run_?agents?)$/i;

/** Чем агент занят — по инструменту и команде */
export const TEST_OR_BUILD = /\b(mvnw?|gradlew?|npm|pnpm|yarn|pytest|jest|vitest|go|dotnet|cargo)\b.*\b(test|build|verify|package|install|check)\b|\b(javac|tsc)\b/i;
export function activityOf(tool: string, args: any): PxState {
  if (["read", "grep", "find", "ls"].includes(tool)) return "sniff";
  if (tool === "edit" || tool === "write") return "dig";
  if (tool === "bash" || tool === "powershell") return TEST_OR_BUILD.test(String(args?.command ?? args?.script ?? "")) ? "sit" : "alert";
  return "alert";
}

/** Тема по инструменту и его аргументам. Для ошибок — своя тема или null */
export function classify(name: string, input: any, ok: boolean): { t: Topic; p: number } | null {
  const cmd = String(input?.command ?? input?.script ?? "");
  const file = String(input?.path ?? input?.file_path ?? input?.pattern ?? "").toLowerCase();
  if (name === "bash" || name === "powershell") {
    if (/\brm\s+-[a-z]*r|remove-item\b.*-recurse|\brd\s+\/s|\bdel\s+\/s/i.test(cmd)) return ok ? { t: "rm", p: 1 } : null;
    if (/\b(mvnw?|gradlew?|npm|pnpm|yarn|pytest|jest|vitest|go|dotnet|cargo)\b.*\btest/i.test(cmd))
      return { t: ok ? "testOk" : "testFail", p: ok ? 0.8 : 1 };
    if (/\b(mvnw?|gradlew?|javac|tsc)\b|\b(npm run build|cargo build|dotnet build)\b/i.test(cmd))
      return { t: ok ? "buildOk" : "buildFail", p: ok ? 0.5 : 1 };
    if (/\bgit\b/i.test(cmd)) {
      if (!ok) return { t: "gitFail", p: 1 };
      if (/\bgit\s+commit\b/i.test(cmd)) return { t: "gitCommit", p: 0.7 };
      if (/\bgit\s+push\b/i.test(cmd)) return { t: "gitPush", p: 0.8 };
    }
    if (!ok) return null;
    if (/\bdocker\b/i.test(cmd)) return { t: "docker", p: 0.4 };
    if (/\b(kubectl|helm|k9s)\b/i.test(cmd)) return { t: "k8s", p: 0.4 };
    return { t: "bash", p: 0.1 };
  }
  if (!ok) return null;
  const writing = name === "edit" || name === "write";
  if (/\.bpmn$/.test(file)) return { t: "bpmn", p: writing ? 0.6 : 0.3 };
  if (/pom\.xml$|build\.gradle(\.kts)?$/.test(file)) return { t: "pom", p: 0.5 };
  if (/\.java$|\.kt$/.test(file)) return { t: "java", p: writing ? 0.25 : 0.1 };
  if (/\.ya?ml$/.test(file)) return { t: "yaml", p: 0.3 };
  if (/\.sql$/.test(file)) return { t: "sql", p: 0.4 };
  if (writing) return { t: "edit", p: 0.08 };
  if (["read", "grep", "find", "ls"].includes(name)) return { t: "read", p: 0.06 };
  return null;
}
