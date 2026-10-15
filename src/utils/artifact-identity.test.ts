import { describe, it, expect, beforeEach } from "vitest";
import {
    artifactIdentityLines,
    artifactKeyNames,
    localIsoWithOffset,
    uuidv7,
    VERSION_UUID_LINE,
} from "./artifact-identity";
import { TFile } from "obsidian";
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
        for (const name of [
            "aliases",
            "version_uuid",
            "Type",
            "cssclasses",
            "publish",
            "null",
            "Yes",
            "a b",
            "1x",
        ]) {
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
        expect(
            artifactIdentityLines({ artifactNoteType: "yes" }, undefined)
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
    let warnings: unknown[];

    function useSettings(settings: Record<string, unknown>) {
        written = {};
        warnings = [];
        const files: Record<string, TFile> = {};
        ClaudeConverter.setPlugin({
            logger: {
                ...logger,
                child: () => ({
                    ...logger,
                    warn: (...args: unknown[]) => warnings.push(args),
                }),
            },
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
                        files[path] = new TFile();
                        (files[path] as unknown as { path: string }).path =
                            path;
                    },
                    getAbstractFileByPath: (path: string) =>
                        files[path] ?? null,
                    read: async (file: { path: string }) => written[file.path],
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

    async function isSkipped(versionUuid: string): Promise<boolean> {
        return (
            ClaudeConverter as unknown as {
                shouldSkipArtifactVersion: (
                    path: string,
                    uuid: string
                ) => Promise<boolean>;
            }
        ).shouldSkipArtifactVersion(
            "Attachments/made-up-recipe_v1.md",
            versionUuid
        );
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

    it("keeps the stock key names when artifactVaultKeyNames is off", async () => {
        const fm = frontmatter(await writeArtifact());
        expect(fm).toMatch(/^plugin_version: "0\.0\.0-test"$/m);
        expect(fm).toMatch(/^version_uuid: toolu_01MadeUpForTests$/m);
        expect(fm).toMatch(
            /^conversation_id: 00000000-0000-4000-8000-000000000001$/m
        );
        expect(fm).toMatch(/^create_time: 2023-11-14T22:15:00\.000Z$/m);
        expect(fm).not.toMatch(
            /^(plugin-version|version-uuid|conversation-id|created):/m
        );
    });

    it("writes the vault's key names when artifactVaultKeyNames is on", async () => {
        useSettings({ ...VAULT, artifactVaultKeyNames: true });
        const fm = frontmatter(await writeArtifact());
        expect(fm).toMatch(/^plugin-version: "0\.0\.0-test"$/m);
        expect(fm).toMatch(/^version-uuid: toolu_01MadeUpForTests$/m);
        expect(fm).toMatch(
            /^conversation-id: 00000000-0000-4000-8000-000000000001$/m
        );
        const created = /^created: (.*)$/m.exec(fm)?.[1];
        expect(created).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
        );
        // Same instant as the message time (1_700_000_100 s)
        expect(Date.parse(created as string)).toBe(1_700_000_100_000);
        expect(fm).not.toMatch(
            /^(plugin_version|version_uuid|conversation_id|create_time):/m
        );
        expect(fm).toMatch(/^tool-use-id: toolu_01MadeUpForTests$/m);
        const keys = fm
            .split("\n")
            .slice(1)
            .map((l) => /^([^\s:]+):/.exec(l)?.[1])
            .filter(Boolean);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("still matches an existing note on a re-import, under either name", async () => {
        for (const vaultKeys of [false, true]) {
            useSettings({ ...VAULT, artifactVaultKeyNames: vaultKeys });
            await writeArtifact();
            expect(await isSkipped("toolu_01MadeUpForTests")).toBe(true);
            // A match is silent; only a different version warns.
            expect(warnings).toHaveLength(0);
            expect(await isSkipped("toolu_01SomeOtherMadeUpId")).toBe(true);
            expect(warnings).toHaveLength(1);
        }
    });
});

describe("artifactKeyNames", () => {
    it("is the stock names unless the option is exactly true", () => {
        for (const v of [undefined, false, "true" as unknown as boolean]) {
            expect(artifactKeyNames({ artifactVaultKeyNames: v })).toEqual({
                pluginVersion: "plugin_version",
                versionUuid: "version_uuid",
                conversationId: "conversation_id",
                createTime: "create_time",
            });
        }
        expect(artifactKeyNames({ artifactVaultKeyNames: true })).toEqual({
            pluginVersion: "plugin-version",
            versionUuid: "version-uuid",
            conversationId: "conversation-id",
            createTime: "created",
        });
    });

    it("keeps the option's names out of the identity properties", () => {
        for (const name of ["plugin-version", "version-uuid", "created"]) {
            expect(
                artifactIdentityLines(
                    { artifactUidProperty: name },
                    "toolu_01FakeId"
                )
            ).toBe("");
        }
    });
});

describe("VERSION_UUID_LINE", () => {
    it("reads either spelling", () => {
        for (const key of ["version_uuid", "version-uuid"]) {
            const note = `---\nnexus: x\n${key}: toolu_01FakeId\nformat: text\n---\n`;
            expect(VERSION_UUID_LINE.exec(note)?.[1]).toBe("toolu_01FakeId");
        }
    });

    it("reads nothing from other keys", () => {
        expect(VERSION_UUID_LINE.exec("---\nversion: 1\n---\n")).toBeNull();
    });
});

describe("localIsoWithOffset", () => {
    const t = Date.UTC(2026, 7, 1, 4, 8, 55) / 1000;

    it("writes local time with a negative offset", () => {
        expect(localIsoWithOffset(t, 240)).toBe("2026-08-01T00:08:55-04:00");
    });

    it("writes local time with a positive or half-hour offset", () => {
        expect(localIsoWithOffset(t, -330)).toBe("2026-08-01T09:38:55+05:30");
        expect(localIsoWithOffset(t, 0)).toBe("2026-08-01T04:08:55+00:00");
    });

    it("names the same instant whatever the offset", () => {
        for (const offset of [240, -330, 0, 600]) {
            expect(Date.parse(localIsoWithOffset(t, offset))).toBe(t * 1000);
        }
    });
});
