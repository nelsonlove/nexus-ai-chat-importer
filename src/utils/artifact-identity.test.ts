import { describe, it, expect, beforeEach } from "vitest";
import { artifactIdentityLines, uuidv7 } from "./artifact-identity";
import { ClaudeConverter } from "../providers/claude/claude-converter";

const UUID_V7 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VAULT = {
    artifactNoteType: "Note/ChatArtifact",
    artifactUidProperty: "uid",
    artifactToolUseIdProperty: "tool-use-id",
};

const fixedBytes = (length: number) => new Uint8Array(length).fill(0xab);

describe("uuidv7", () => {
    it("has the version 7 shape", () => {
        for (let i = 0; i < 50; i++) {
            expect(uuidv7()).toMatch(UUID_V7);
        }
    });

    it("puts the time in milliseconds in the first 48 bits", () => {
        const now = Date.UTC(2026, 9, 15, 12, 0, 0);
        const id = uuidv7(now, fixedBytes);
        const ms = parseInt(id.replace(/-/g, "").slice(0, 12), 16);
        expect(ms).toBe(now);
        expect(id).toMatch(UUID_V7);
    });

    it("gives a new value each call", () => {
        const ids = new Set(Array.from({ length: 200 }, () => uuidv7()));
        expect(ids.size).toBe(200);
    });
});

describe("artifactIdentityLines", () => {
    it("writes nothing when every option is off", () => {
        expect(artifactIdentityLines({}, "toolu_01FakeId")).toBe("");
        expect(
            artifactIdentityLines(
                {
                    artifactNoteType: "",
                    artifactUidProperty: "",
                    artifactToolUseIdProperty: "",
                },
                "toolu_01FakeId"
            )
        ).toBe("");
    });

    it("writes type, a UUIDv7 uid and the tool-use id", () => {
        const lines = artifactIdentityLines(VAULT, "toolu_01FakeId").split(
            "\n"
        );
        expect(lines[0]).toBe("type: Note/ChatArtifact");
        expect(lines[1]).toMatch(/^uid: /);
        expect(lines[1].slice(5)).toMatch(UUID_V7);
        expect(lines[2]).toBe("tool-use-id: toolu_01FakeId");
        expect(lines[3]).toBe("");
    });

    it("never puts the tool-use id in the uid", () => {
        const lines = artifactIdentityLines(VAULT, "toolu_01FakeId");
        expect(lines).not.toMatch(/^uid: toolu_/m);
    });

    it("leaves out the tool-use id when there is none", () => {
        for (const id of [undefined, "", "  "]) {
            const lines = artifactIdentityLines(VAULT, id);
            expect(lines).not.toContain("tool-use-id");
            expect(lines).toMatch(/^uid: /m);
        }
    });

    it("leaves out a tool-use id that is not safe unquoted", () => {
        const lines = artifactIdentityLines(VAULT, "bad: value #x");
        expect(lines).not.toContain("tool-use-id");
    });

    it("refuses a property name that clashes or does not validate", () => {
        for (const name of ["aliases", "version_uuid", "Type", "a b", "1x"]) {
            const lines = artifactIdentityLines(
                { artifactUidProperty: name, artifactToolUseIdProperty: name },
                "toolu_01FakeId"
            );
            expect(lines).toBe("");
        }
    });

    it("does not write the same property twice", () => {
        const lines = artifactIdentityLines(
            { artifactUidProperty: "uid", artifactToolUseIdProperty: "uid" },
            "toolu_01FakeId"
        );
        expect(lines.match(/^uid:/gm)).toHaveLength(1);
        expect(lines).not.toContain("toolu_");
    });

    it("refuses a type value that would not parse", () => {
        expect(
            artifactIdentityLines({ artifactNoteType: "a: b" }, undefined)
        ).toBe("");
        expect(
            artifactIdentityLines({ artifactNoteType: "Note/" }, undefined)
        ).toBe("");
    });
});

// A made-up artifact written through the converter's own writer.
describe("Claude artifact note frontmatter", () => {
    const logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => logger,
    };
    let written: Record<string, string>;

    function useSettings(settings: Record<string, unknown>) {
        written = {};
        ClaudeConverter.setPlugin({
            logger,
            manifest: { version: "0.0.0-test" },
            settings: {
                conversationFolder: "Chats",
                addDatePrefix: false,
                dateFormat: "YYYY-MM-DD",
                ...settings,
            },
            app: {
                vault: {
                    create: async (path: string, content: string) => {
                        written[path] = content;
                    },
                },
            },
        } as never);
    }

    async function writeArtifact(): Promise<string> {
        await (
            ClaudeConverter as unknown as {
                saveIndividualArtifactVersion: (
                    ...args: unknown[]
                ) => Promise<void>;
            }
        ).saveIndividualArtifactVersion(
            {
                _blockId: "toolu_01MadeUpForTests",
                id: "made-up-recipe",
                title: "Made-up recipe",
                language: "markdown",
                command: "create",
                content: "# Pancakes\n\nA made-up recipe.",
            },
            "Attachments/made-up-recipe_v1.md",
            1,
            "# Pancakes\n\nA made-up recipe.",
            "00000000-0000-4000-8000-000000000001",
            "A made-up chat",
            1_700_000_000,
            undefined,
            1_700_000_100
        );
        return written["Attachments/made-up-recipe_v1.md"];
    }

    function frontmatter(note: string): string {
        return note.split("\n---\n")[0];
    }

    beforeEach(() => useSettings({}));

    it("is unchanged when the options are off", async () => {
        const fm = frontmatter(await writeArtifact());
        expect(fm).not.toMatch(/^(type|uid|tool-use-id):/m);
        expect(fm).toContain("version_uuid: toolu_01MadeUpForTests");
    });

    it("gets type, a UUIDv7 uid and the tool-use id when set", async () => {
        useSettings(VAULT);
        const fm = frontmatter(await writeArtifact());
        expect(fm).toMatch(/^type: Note\/ChatArtifact$/m);
        const uid = /^uid: (.*)$/m.exec(fm)?.[1];
        expect(uid).toMatch(UUID_V7);
        expect(fm).toMatch(/^tool-use-id: toolu_01MadeUpForTests$/m);
        expect(fm).not.toMatch(/^uid: toolu_/m);
        // Every key appears once, so the block still parses.
        const keys = fm
            .split("\n")
            .slice(1)
            .map((l) => /^([^\s:]+):/.exec(l)?.[1])
            .filter(Boolean);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("gives each note its own uid", async () => {
        useSettings(VAULT);
        const a = /^uid: (.*)$/m.exec(await writeArtifact())?.[1];
        const b = /^uid: (.*)$/m.exec(await writeArtifact())?.[1];
        expect(a).not.toBe(b);
    });
});
