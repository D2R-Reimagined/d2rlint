import { lintrule, Rule } from "../lib/rule.ts";
import { GetConfig, type RuleAction, type RuleConfig } from "../lib/config.ts";
import type {
  D2RExcelRecord,
  Workspace,
} from "../lib/workspace.ts";

/**
 * Checks for duplicate IDs and Keys in adjacent .json string files.
 */
//@ts-ignore
@lintrule
export class JsonDuplicateIds extends Rule {
  GetRuleName(): string {
    return "Json/DuplicateIds";
  }

  Evaluate(workspace: Workspace) {
    const { adjacentStringFiles } = workspace;
    if (adjacentStringFiles === undefined) {
      return;
    }

    const fileNames = Object.keys(adjacentStringFiles);

    // Global maps for cross-file duplicate detection: value -> source file name
    const globalIds = new Map<number, string>();
    const globalKeys = new Map<string, string>();

    for (const fileName of fileNames) {
      const entries = adjacentStringFiles[fileName];
      if (entries === undefined || entries.length === 0) {
        continue;
      }

      if (entries.forEach === undefined) {
        continue;
      }

      // Per-file maps for within-file duplicate detection
      const seenIds = new Map<number, number>();
      const seenKeys = new Map<string, number>();

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const id = entry.id;
        const key = entry.Key;

        // Duplicate ID check
        if (id !== undefined) {
          const prevLine = seenIds.get(id);
          if (prevLine !== undefined) {
            this.Warn(
              `${fileName}.json: duplicate id ${id} found on entries ${prevLine + 1} and ${i + 1}`,
            );
          } else {
            seenIds.set(id, i);
            // Cross-file duplicate ID check
            const prevFile = globalIds.get(id);
            if (prevFile !== undefined) {
              this.Warn(
                `${fileName}.json duplicate id ${id} found in ${prevFile}.json`,
              );
            } else {
              globalIds.set(id, fileName);
            }
          }
        } else {
          this.Warn(
            `${fileName}.json: missing id on entry ${i + 1}`,
          );
        }

        // Duplicate Key check
        if (key !== undefined && key !== "") {
          const prevLine = seenKeys.get(key);
          if (prevLine !== undefined) {
            this.Warn(
              `${fileName}.json: duplicate Key '${key}' found on entries ${prevLine + 1} and ${i + 1}`,
            );
          } else {
            seenKeys.set(key, i);
            // Cross-file duplicate Key check
            const prevFile = globalKeys.get(key);
            if (prevFile !== undefined) {
              this.Warn(
                `${fileName}.json duplicate key '${key}' found in ${prevFile}.json`,
              );
            } else {
              globalKeys.set(key, fileName);
            }
          }
        }
      }
    }
  }
}

/**
 * Checks that .json string keys with id > 40000 are referenced
 * in any column of the .txt files. The key must be an exact cell match (standalone entry).
 */
//@ts-ignore
@lintrule
export class JsonKeyUsage extends Rule {
  GetRuleName(): string {
    return "Json/KeyUsage";
  }

  override GetDefaultAction(): RuleAction {
    return "warn";
  }

  override GetDefaultConfig(): RuleConfig {
    return { action: this.GetDefaultAction(), idStart: 40000 };
  }

  Evaluate(workspace: Workspace) {
    const { adjacentStringFiles } = workspace;
    if (adjacentStringFiles === undefined) {
      return;
    }

    // Collect all standalone cell values from all columns across all txt files
    const usedKeys = new Set<string>();

    const collectAllFields = <T extends D2RExcelRecord>(
      records: T[] | undefined,
    ) => {
      if (records === undefined) {
        return;
      }
      for (const record of records) {
        const r = record as unknown as { [key: string]: unknown };
        for (const col of Object.keys(r)) {
          const val = r[col];
          if (val !== undefined && val !== "" && typeof val !== "function") {
            usedKeys.add(String(val));
          }
        }
      }
    };

    // Collect from all excel record sets in the workspace
    const wsKeys = Object.keys(workspace) as (keyof Workspace)[];
    for (const key of wsKeys) {
      const field = workspace[key];
      if (
        field === undefined || !Array.isArray(field) || field.length === 0
      ) {
        continue;
      }
      const first = field[0];
      if (
        typeof first !== "object" || first === null ||
        !("GetFileName" in first)
      ) {
        continue;
      }
      collectAllFields(field as D2RExcelRecord[]);
    }

    // Also collect keys referenced as @key in layout JSON files
    const { layoutJsonFiles } = workspace;
    if (layoutJsonFiles !== undefined) {
      const atKeyRegex = /@([A-Za-z0-9_]+)/g;
      for (const fileName of Object.keys(layoutJsonFiles)) {
        const content = layoutJsonFiles[fileName];
        if (content === undefined) continue;
        let match;
        while ((match = atKeyRegex.exec(content)) !== null) {
          usedKeys.add(match[1]);
        }
      }
    }

    // Check all json string entries with id > configured threshold (default 40000)
    const config = GetConfig();
    const ruleName = this.GetRuleName();
    const idStart = config.rules[ruleName]?.idStart!;

    const fileNames = Object.keys(adjacentStringFiles);
    for (const fileName of fileNames) {
      const entries = adjacentStringFiles[fileName];
      if (entries === undefined || entries.length === 0 || entries.forEach === undefined) {
        continue;
      }

      for (const entry of entries) {
        if (entry.id > idStart && entry.Key !== undefined && entry.Key !== "") {
          if (!usedKeys.has(entry.Key)) {
            this.Warn(
              `${fileName}.json: Key '${entry.Key}' (id: ${entry.id}) is not referenced as an entry in any .txt or layout .json file`,
            );
          }
        }
      }
    }
  }
}
