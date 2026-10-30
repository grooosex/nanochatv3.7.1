import assert from "node:assert/strict";
import test from "node:test";
import type { Chat } from "./types.ts";
import { copyRole, parseRoleText } from "./role-text.ts";

function chat(partial: Partial<Chat>): Chat {
  return {
    id: "c",
    folderId: null,
    name: "",
    remark: "",
    starred: false,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    isDraft: false,
    grokModelId: "grok-4.6-medium",
    isMulti: false,
    multiMode: "together",
    promptMode: "insert",
    adultBoost: false,
    canGen: true,
    statusBarOn: false,
    statusBar: "",
    overview: "",
    opening: "",
    extras: [],
    memory: "",
    memoryUntil: 0,
    memoryFoldAt: 0,
    memorySnaps: [],
    characters: [],
    messages: [],
    scrollTop: 0,
    imageParams: {} as Chat["imageParams"],
    ...partial,
  };
}

test("copy skips empty fields and keeps the single-person order", () => {
  const text = copyRole(
    chat({
      overview: "写细一点",
      opening: "",
      characters: [
        {
          id: "1",
          name: "小玉",
          persona: "温柔",
          speech: "",
          appearance: "black hair",
          extras: [],
          imageEnabled: true,
          prompt: "",
          uc: "",
          x: 0,
          y: 0,
        },
      ],
    }),
  );
  assert.equal(text, "名字\n小玉\n\n要求总览\n写细一点\n\n人设\n温柔\n\n外貌备忘\nblack hair");
});

test("parse fills only the titles it finds", () => {
  const got = parseRoleText("随便一段没有标题\n\n名字：\n青叶\n\n【人设】\n很静");
  assert.equal(got.matched, true);
  assert.equal(got.people.length, 1);
  assert.equal(got.people[0].name, "青叶");
  assert.equal(got.people[0].persona, "很静");
  assert.equal(got.people[0].speech, undefined);
  assert.equal(got.overview, undefined);
});

test("a second name starts another person", () => {
  const got = parseRoleText("名字\n小玉\n\n人设\n甲\n\n名字\n小铃\n\n人设\n乙\n\n要求总览\n慢一点");
  assert.equal(got.people.length, 2);
  assert.equal(got.people[1].name, "小铃");
  assert.equal(got.people[1].persona, "乙");
  assert.equal(got.overview, "慢一点");
});

test("prose without titles is not guessed", () => {
  const got = parseRoleText("她叫小玉，说话很轻。");
  assert.equal(got.matched, false);
  assert.equal(got.people.length, 0);
});
