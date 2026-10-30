import type { Chat } from "./types";

export const ROLE_TITLES = ["名字", "要求总览", "人设", "说话方式", "外貌备忘", "开场场景"] as const;
export type RoleTitle = (typeof ROLE_TITLES)[number];

const TITLE_LINE = /^(?:【\s*)?(名字|要求总览|人设|说话方式|外貌备忘|开场场景)\s*(?:】)?\s*[:：]?\s*$/;

export interface RolePerson {
  name?: string;
  persona?: string;
  speech?: string;
  appearance?: string;
}

export interface ParsedRole {
  matched: boolean;
  overview?: string;
  opening?: string;
  people: RolePerson[];
}

function pushBlock(blocks: string[], title: string, body: string) {
  const text = body.trim();
  if (!text) return;
  blocks.push(`${title}\n${text}`);
}

export function copyRole(chat: Chat) {
  const blocks: string[] = [];
  if (!chat.isMulti) {
    const c = chat.characters[0];
    pushBlock(blocks, "名字", c?.name ?? "");
    pushBlock(blocks, "要求总览", chat.overview);
    pushBlock(blocks, "人设", c?.persona ?? "");
    pushBlock(blocks, "说话方式", c?.speech ?? "");
    pushBlock(blocks, "外貌备忘", c?.appearance ?? "");
    pushBlock(blocks, "开场场景", chat.opening);
    return blocks.join("\n\n");
  }
  for (const c of chat.characters) {
    pushBlock(blocks, "名字", c.name);
    pushBlock(blocks, "人设", c.persona);
    pushBlock(blocks, "说话方式", c.speech);
    pushBlock(blocks, "外貌备忘", c.appearance);
  }
  pushBlock(blocks, "要求总览", chat.overview);
  pushBlock(blocks, "开场场景", chat.opening);
  return blocks.join("\n\n");
}

export function parseRoleText(raw: string): ParsedRole {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sections: { title: RoleTitle; lines: string[] }[] = [];
  let cur: { title: RoleTitle; lines: string[] } | null = null;
  for (const line of lines) {
    const hit = line.trim().match(TITLE_LINE);
    if (hit) {
      cur = { title: hit[1] as RoleTitle, lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (!sections.length) return { matched: false, people: [] };

  const people: RolePerson[] = [];
  let person: RolePerson | null = null;
  let overview: string | undefined;
  let opening: string | undefined;
  const ensure = () => {
    if (!person) {
      person = {};
      people.push(person);
    }
    return person;
  };
  for (const sec of sections) {
    const body = sec.lines.join("\n").trim();
    if (sec.title === "要求总览") {
      overview = body;
      continue;
    }
    if (sec.title === "开场场景") {
      opening = body;
      continue;
    }
    if (sec.title === "名字") {
      if (person?.name !== undefined) {
        person = {};
        people.push(person);
      }
      ensure().name = body;
      continue;
    }
    const target = ensure();
    if (sec.title === "人设") target.persona = body;
    else if (sec.title === "说话方式") target.speech = body;
    else target.appearance = body;
  }
  return { matched: true, overview, opening, people };
}
