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

// src/import-report-toggle.test.ts
import { describe, expect, it, vi } from "vitest";
import NexusAiChatImporterPlugin from "./main";
import { DEFAULT_SETTINGS } from "./config/constants";
import { ImportReport } from "./models/import-report";

// The settings tab extends a class the shared Obsidian stub does not provide;
// this test never builds the tab, so a bare stand-in is enough.
vi.mock("./ui/settings-tab", () => ({
    NexusAiChatImporterPluginSettingTab: class {},
}));

// The real adapters need a whole plugin; the report falls back to the bare
// provider name when none is found.
vi.mock("./providers/provider-registry", () => ({
    createProviderRegistry: () => ({ getAdapter: () => undefined }),
}));

type ReportWriter = (
    report: ImportReport,
    provider: string,
    files: File[]
) => Promise<string>;

/** A stand-in plugin with just what writeConsolidatedReport touches. */
function fakePlugin(writeImportReports: boolean) {
    const vault = {
        create: vi.fn(),
        createFolder: vi.fn(),
        getAbstractFileByPath: vi.fn(() => null),
        adapter: { exists: vi.fn(async () => false) },
    };
    return {
        settings: { ...DEFAULT_SETTINGS, writeImportReports },
        app: { vault },
        logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        selectionWarnings: [],
        vault,
    };
}

const writeReport = (
    NexusAiChatImporterPlugin.prototype as unknown as {
        writeConsolidatedReport: ReportWriter;
    }
).writeConsolidatedReport;

describe("import report toggle", () => {
    it("keeps reports on by default, so stock behaviour is unchanged", () => {
        expect(DEFAULT_SETTINGS.writeImportReports).toBe(true);
    });

    it("writes nothing and returns no path when reports are off", async () => {
        const plugin = fakePlugin(false);

        const path = await writeReport.call(
            plugin,
            new ImportReport(),
            "chatgpt",
            []
        );

        expect(path).toBe("");
        expect(plugin.vault.create).not.toHaveBeenCalled();
        expect(plugin.vault.createFolder).not.toHaveBeenCalled();
        expect(plugin.vault.adapter.exists).not.toHaveBeenCalled();
    });

    it("still reaches the report folder when reports are on", async () => {
        const plugin = fakePlugin(true);

        // The stand-in is too thin for a full report; only the first vault
        // touch matters here, so a later failure is ignored.
        await writeReport
            .call(plugin, new ImportReport(), "chatgpt", [])
            .catch(() => undefined);

        expect(plugin.vault.createFolder).toHaveBeenCalledWith(
            `${DEFAULT_SETTINGS.reportFolder}/chatgpt/`
        );
    });
});
