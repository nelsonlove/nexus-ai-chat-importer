/**
 * Nexus AI Chat Importer - Obsidian Plugin
 * Copyright (C) 2024 Akim Sissaoui
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// src/utils/artifact-identity.ts

/**
 * Extra identity properties on an artifact note, all off by default:
 *
 * - `artifactNoteType`: a value written as `type: <value>`, for a vault that
 *   types its notes (e.g. `Note/ChatArtifact`).
 * - `artifactUidProperty`: a property that gets a fresh UUIDv7 per note, for
 *   a vault that gives every note its own id.
 * - `artifactToolUseIdProperty`: a property that gets the id of the Claude
 *   tool call the artifact came from (`toolu_…`), under its own name, so that
 *   it never has to stand in for a note id.
 *
 * Each is set in data.json; an empty or invalid value writes nothing.
 */

/** A property name: usable unquoted in YAML and stable across writes. */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A type value: a path of names such as `Note/ChatArtifact`. */
const VALID_TYPE = /^[A-Za-z_][A-Za-z0-9_-]*(?:\/[A-Za-z_][A-Za-z0-9_-]*)*$/;

/** A tool-use id: safe to write unquoted (e.g. `toolu_01AbC…`). */
const VALID_TOOL_USE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Keys an artifact note already carries, compared case-insensitively. A
 * duplicate key invalidates the whole frontmatter.
 */
const ARTIFACT_KEYS = new Set([
    "nexus",
    "plugin_version",
    "provider",
    "artifact_id",
    "version_uuid",
    "version_number",
    "command",
    "conversation_id",
    "create_time",
    "format",
    "aliases",
    "type",
    "tags",
]);

export interface ArtifactIdentitySettings {
    artifactNoteType?: string;
    artifactUidProperty?: string;
    artifactToolUseIdProperty?: string;
}

/** Bytes for a UUID; injectable so tests are deterministic. */
export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) =>
    crypto.getRandomValues(new Uint8Array(length));

/**
 * A UUID version 7 (RFC 9562): 48 bits of Unix time in milliseconds, then
 * version and variant bits around 74 random bits.
 */
export function uuidv7(
    now: number = Date.now(),
    randomBytes: RandomBytes = defaultRandomBytes
): string {
    const bytes = new Uint8Array(16);
    let ms = Math.max(0, Math.floor(now));
    for (let i = 5; i >= 0; i--) {
        bytes[i] = ms % 256;
        ms = Math.floor(ms / 256);
    }
    bytes.set(randomBytes(10).subarray(0, 10), 6);
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
        ""
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
        12,
        16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resolveName(raw: string | undefined): string | null {
    const name = (raw ?? "").trim();
    if (!VALID_NAME.test(name)) return null;
    if (ARTIFACT_KEYS.has(name.toLowerCase())) return null;
    return name;
}

/**
 * The extra frontmatter lines for a new artifact note, each ending in "\n",
 * or "" when every option is off. A name that does not validate, or that
 * repeats a name already used, writes nothing for that option.
 */
export function artifactIdentityLines(
    settings: ArtifactIdentitySettings,
    toolUseId: string | undefined,
    now: number = Date.now(),
    randomBytes: RandomBytes = defaultRandomBytes
): string {
    let lines = "";

    const type = (settings.artifactNoteType ?? "").trim();
    if (VALID_TYPE.test(type)) {
        lines += `type: ${type}\n`;
    }

    const used = new Set<string>();

    const uidName = resolveName(settings.artifactUidProperty);
    if (uidName) {
        used.add(uidName.toLowerCase());
        lines += `${uidName}: ${uuidv7(now, randomBytes)}\n`;
    }

    const toolName = resolveName(settings.artifactToolUseIdProperty);
    const toolValue = (toolUseId ?? "").trim();
    if (
        toolName &&
        !used.has(toolName.toLowerCase()) &&
        VALID_TOOL_USE_ID.test(toolValue)
    ) {
        lines += `${toolName}: ${toolValue}\n`;
    }

    return lines;
}
