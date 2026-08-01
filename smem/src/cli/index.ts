#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) {
    return;
  }

  console.warn(warning);
});

import { Command } from "commander";
import { MemoryInputSchema, MemoryTypeSchema } from "../core/schema";
import { RegistryRepository } from "../storage/registry-repository";
import { MemoryRepository } from "../storage/memory-repository";
import { writeMarkdownRender } from "../render/markdown";
import { readGuide } from "../guide/guide";
import {
  installAgents,
  installAgentsHooks,
  knownAgents,
  parseAgentName,
  uninstallAgents,
  uninstallAgentsHooks
} from "../install/agent-installer";
import { runHook } from "../hook/hook-runner";
import { classifyText } from "../classify/offline-classifier";
import { createEmbeddingClient, type EmbeddingProvider } from "../embedding/embedding-client";
import { EmbeddingRepository, type SemanticResult } from "../storage/embedding-repository";
import type { MemoryRecord } from "../core/schema";
import { processCandidates } from "../process/candidate-processor";
import {
  formatRawEventFull,
  formatTranscriptRecordFull,
  isMeaningfulHistoryRecord,
  rawThread,
  searchRaw,
  summarizeRawEvent,
  summarizeTranscriptRecord
} from "../raw/raw-reader";
import { printMemory, printProject } from "./format";

const program = new Command();

program
  .name("smem")
  .description("Smart Memory CLI core MVP")
  .version("0.1.0");

program
  .command("guide")
  .description("Print the system-level smem usage guide for agents and users")
  .action(() => {
    console.log(readGuide());
  });

program
  .command("install")
  .description("Install smem bootstrap instructions for an agent in the current project")
  .option("--agent <agent>", "Agent to install: codex, claude-code, antigravity, or all", "all")
  .option("--hooks", "Install native hook capture config")
  .option("--dry-run", "Show target files without writing")
  .action((options: { agent: string; hooks?: boolean; dryRun?: boolean }) => {
    const agents = options.agent === "all" ? knownAgents() : [parseAgentName(options.agent)];
    const results = installAgents({
      agents,
      cwd: process.cwd(),
      dryRun: options.dryRun ?? false
    });

    for (const result of results) {
      const action = options.dryRun ? "would update" : result.changed ? "updated" : "already installed";
      console.log(`${result.agent}: ${action} ${result.filePath}`);
    }

    if (options.hooks) {
      const hookResults = installAgentsHooks({
        agents,
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false
      });
      for (const result of hookResults) {
        const action = options.dryRun ? "would update" : result.changed ? "updated" : "already installed";
        console.log(`${result.agent} hooks: ${action} ${result.filePath}`);
      }
    }
  });

program
  .command("uninstall")
  .description("Remove smem bootstrap instructions and optional hook config from the current project")
  .option("--agent <agent>", "Agent to uninstall: codex, claude-code, antigravity, or all", "all")
  .option("--hooks", "Remove native hook capture config")
  .option("--dry-run", "Show target files without writing")
  .action((options: { agent: string; hooks?: boolean; dryRun?: boolean }) => {
    const agents = options.agent === "all" ? knownAgents() : [parseAgentName(options.agent)];
    const results = uninstallAgents({
      agents,
      cwd: process.cwd(),
      dryRun: options.dryRun ?? false
    });

    for (const result of results) {
      const action = options.dryRun ? "would remove" : result.changed ? "removed" : "already uninstalled";
      console.log(`${result.agent}: ${action} ${result.filePath}`);
    }

    if (options.hooks) {
      const hookResults = uninstallAgentsHooks({
        agents,
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false
      });
      for (const result of hookResults) {
        const action = options.dryRun ? "would remove" : result.changed ? "removed" : "already uninstalled";
        console.log(`${result.agent} hooks: ${action} ${result.filePath}`);
      }
    }
  });

const hook = program.command("hook").description("Internal smem hook commands");

hook
  .command("run")
  .description("Capture one native agent hook event from stdin")
  .requiredOption("--agent <agent>", "Agent name")
  .option("--event <event>", "Hook event name")
  .action((options: { agent: string; event?: string }) => {
    runHook({
      agent: parseAgentName(options.agent),
      ...(options.event ? { event: options.event } : {})
    });
  });

program
  .command("classify")
  .description("Classify text offline with the default local classifier")
  .argument("<text...>", "Text to classify")
  .action((textParts: string[]) => {
    console.log(JSON.stringify(classifyText(textParts.join(" ")), null, 2));
  });

program
  .command("init")
  .description("Create or reuse an outsider Smart Memory project for the current directory")
  .option("--name <name>", "Project display name")
  .option("--store <path>", "Custom outsider store path")
  .action((options: { name?: string; store?: string }) => {
    withRegistry((registry) => {
      const project = registry.initProject({
        cwd: process.cwd(),
        ...(options.name ? { name: options.name } : {}),
        ...(options.store ? { store: options.store } : {})
      });
      console.log(printProject(project));
    });
  });

program
  .command("status")
  .description("Show the Smart Memory project attached to the current directory")
  .action(() => {
    withCurrentProject((project) => {
      console.log(printProject(project));
    });
  });

program
  .command("list-projects")
  .description("List known Smart Memory projects")
  .action(() => {
    withRegistry((registry) => {
      const projects = registry.listProjects();
      if (projects.length === 0) {
        console.log("No projects found.");
        return;
      }
      console.log(projects.map(printProject).join("\n\n"));
    });
  });

program
  .command("attach")
  .description("Attach the current directory to an existing Smart Memory project")
  .option("--project-id <id>", "Project ID")
  .option("--from-path <path>", "Current root path stored for the project")
  .action((options: { projectId?: string; fromPath?: string }) => {
    moveCurrentDirectoryMapping(options);
  });

program
  .command("move")
  .description("Move an existing Smart Memory project mapping to the current directory")
  .option("--project-id <id>", "Project ID")
  .option("--from-path <path>", "Current root path stored for the project")
  .action((options: { projectId?: string; fromPath?: string }) => {
    moveCurrentDirectoryMapping(options);
  });

program
  .command("del")
  .alias("delete-project")
  .description("Delete a Smart Memory project registry entry by project id")
  .requiredOption("--project-id <id>", "Project ID to delete")
  .action(async (options: { projectId: string }) => {
    withRegistry((registry) => {
      const project = registry.findById(options.projectId);
      if (!project) {
        throw new Error(`Project not found: ${options.projectId}`);
      }

      console.log(printProject(project));
      console.log("");
      console.log("This deletes the project registry entry and its memory store directory.");
    });

    const confirmed = await promptProjectIdConfirmation(options.projectId);
    if (confirmed !== options.projectId) {
      throw new Error("Confirmation did not match project id. Nothing was deleted.");
    }

    withRegistry((registry) => {
      const project = registry.deleteProject(options.projectId);
      console.log(`Deleted project registry entry: ${project.projectId}`);
      console.log(`Root: ${project.rootPath}`);
      console.log(`Deleted store: ${project.storePath}`);
    });
  });

program
  .command("store")
  .description("Store a memory record")
  .option("--type <type>", "Memory type", "note")
  .option("--title <title>", "Memory title")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .argument("<content...>", "Memory content")
  .action((contentParts: string[], options: { type: string; title?: string; tags?: string; scope: string }) => {
    const type = MemoryTypeSchema.parse(options.type);
    const scope = parseScope(options.scope);
    const content = contentParts.join(" ").trim();

    withMemoryRepository(scope, (repo) => {
      const input = MemoryInputSchema.parse({
        type,
        ...(options.title ? { title: options.title } : {}),
        content,
        tags: parseTags(options.tags)
      });
      const memory = repo.create(input);
      console.log(printMemory(memory));
    });
  });

program
  .command("list")
  .description("List recent memory records")
  .option("--limit <n>", "Record limit", parseInteger, 20)
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((options: { limit: number; scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const memories = repo.list(options.limit);
      console.log(memories.length > 0 ? memories.map(printMemory).join("\n\n") : "No memories found.");
    });
  });

program
  .command("recall")
  .description("Search memory records")
  .argument("<query...>", "Search query")
  .option("--limit <n>", "Record limit", parseInteger, 10)
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .option("--mode <mode>", "Search mode: contains, fts, semantic, or hybrid", "fts")
  .option("--provider <provider>", "Embedding provider for semantic/hybrid mode", "openai")
  .option("--model <model>", "Embedding model override")
  .action(
    async (
      queryParts: string[],
      options: { limit: number; scope: string; mode: string; provider: string; model?: string }
    ) => {
      const query = queryParts.join(" ");
      const scope = parseScope(options.scope);
      const mode = parseRecallMode(options.mode);
      const provider = parseEmbeddingProvider(options.provider);
      const memories = await withMemoryRepositoryAsync(scope, async (repo, project) => {
        if (mode === "contains") {
          return repo.contains(query, options.limit);
        }
        if (mode === "fts") {
          return repo.recall(query, options.limit);
        }

        const client = createEmbeddingClient({
          provider,
          ...(options.model ? { model: options.model } : {})
        });
        const embeddings = new EmbeddingRepository(project, { scope });
        try {
          const semantic = await embeddings.search(query, client, options.limit);
          if (mode === "semantic") {
            return repo.getByIds(semantic.map((result) => result.memoryId));
          }

          return hybridRecall(repo, query, semantic, options.limit);
        } finally {
          embeddings.close();
        }
      });
      console.log(memories.length > 0 ? memories.map(printMemory).join("\n\n") : "No matching memories.");
    }
  );

program
  .command("raw")
  .description("Search raw hook captures before they become candidates or memories")
  .argument("<query...>", "Raw search query")
  .option("--limit <n>", "Raw event limit", parseInteger, 20)
  .option("--agent <agent>", "Filter by agent: codex, claude-code, or antigravity")
  .option("--kind <kind>", "Filter by capture kind: raw-input, raw-output, tool-event, or raw-event")
  .option("--json", "Print raw JSON lines")
  .option("--full", "Print full formatted raw event JSON")
  .option("--after <n>", "Compatibility alias for `smem history <query> --after <n>`", parseInteger)
  .action((queryParts: string[], options: { limit: number; agent?: string; kind?: string; json?: boolean; full?: boolean; after?: number }) => {
    const threadMode = queryParts[0] === "thread";
    const query = (threadMode ? queryParts.slice(1) : queryParts).join(" ");
    if (threadMode || options.after !== undefined) {
      const result = rawThread({
        query,
        after: options.after ?? 10,
        ...(options.agent ? { agent: parseAgentName(options.agent) } : {}),
        ...(options.kind ? { kind: parseCaptureKind(options.kind) } : {})
      });
      if (result.records.length === 0) {
        console.log("No raw thread found.");
        return;
      }

      console.log(
        result.records
          .map((record) => (options.full ? formatTranscriptRecordFull(record) : summarizeTranscriptRecord(record)))
          .join("\n\n")
      );
      return;
    }

    const result = searchRaw({
      query,
      limit: options.limit,
      ...(options.agent ? { agent: parseAgentName(options.agent) } : {}),
      ...(options.kind ? { kind: parseCaptureKind(options.kind) } : {})
    });
    const records = [...result.transcripts, ...result.events];

    if (records.length === 0) {
      console.log("No raw events found.");
      return;
    }

    console.log(
      records
        .map((record) => {
          const isTranscript = "transcriptPath" in record && !("line" in record);
          if (options.json) {
            return isTranscript ? JSON.stringify(record.event) : record.line;
          }
          if (options.full) {
            return isTranscript ? formatTranscriptRecordFull(record) : formatRawEventFull(record);
          }
          return isTranscript ? summarizeTranscriptRecord(record, query) : summarizeRawEvent(record, query);
        })
        .join("\n\n")
    );
  });

program
  .command("history")
  .description("Read conversation history from a raw transcript match onward")
  .argument("<query...>", "Raw search query")
  .option("--after <n>", "Number of transcript records after the match", parseInteger, 10)
  .option("--agent <agent>", "Filter by agent: codex, claude-code, or antigravity")
  .option("--kind <kind>", "Filter by capture kind: raw-input, raw-output, tool-event, or raw-event")
  .option("--full", "Print full transcript JSON records")
  .option("--verbose", "Include thinking, tool-only, and command-result records")
  .action((queryParts: string[], options: { after: number; agent?: string; kind?: string; full?: boolean; verbose?: boolean }) => {
    const result = rawThread({
      query: queryParts.join(" "),
      after: options.after,
      ...(options.agent ? { agent: parseAgentName(options.agent) } : {}),
      ...(options.kind ? { kind: parseCaptureKind(options.kind) } : {})
    });
    if (result.records.length === 0) {
      console.log("No history found.");
      return;
    }

    const records = options.full || options.verbose ? result.records : result.records.filter(isMeaningfulHistoryRecord);
    if (records.length === 0) {
      console.log("No meaningful history found. Use --verbose or --full to inspect all transcript records.");
      return;
    }

    console.log(
      records
        .map((record) => (options.full ? formatTranscriptRecordFull(record) : summarizeTranscriptRecord(record)))
        .join("\n\n")
    );
  });

program
  .command("index")
  .description("Build or refresh vector embeddings for active memories")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .option("--provider <provider>", "Embedding provider", "openai")
  .option("--model <model>", "Embedding model override")
  .action(async (options: { scope: string; provider: string; model?: string }) => {
    const scope = parseScope(options.scope);
    const provider = parseEmbeddingProvider(options.provider);
    const result = await withMemoryRepositoryAsync(scope, async (repo, project) => {
      const client = createEmbeddingClient({
        provider,
        ...(options.model ? { model: options.model } : {})
      });
      const embeddings = new EmbeddingRepository(project, { scope });
      try {
        return await embeddings.index(repo.allActive(), client);
      } finally {
        embeddings.close();
      }
    });
    console.log(`indexed=${result.indexed} skipped=${result.skipped}`);
  });

program
  .command("process")
  .description("Convert raw hook captures into pending-review candidate memories")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .option("--limit <n>", "Raw event scan limit", parseInteger, 200)
  .action((options: { scope: string; limit: number }) => {
    const scope = parseScope(options.scope);
    withCurrentProject((project) => {
      const result = processCandidates({
        project,
        scope,
        limit: options.limit
      });
      console.log(`scanned=${result.scanned} created=${result.created} skipped=${result.skipped}`);
    });
  });

program
  .command("candidates")
  .description("List pending-review memory drafts created by process")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .option("--limit <n>", "Candidate limit", parseInteger, 20)
  .action((options: { scope: string; limit: number }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const memories = repo.listCandidates(options.limit);
      console.log(memories.length > 0 ? memories.map(printMemory).join("\n\n") : "No candidates found.");
    });
  });

program
  .command("promote")
  .description("Promote a pending-review candidate into official active memory")
  .argument("<id>", "Candidate memory id")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((id: string, options: { scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      console.log(printMemory(repo.promote(id)));
    });
  });

program
  .command("reject")
  .description("Reject a pending-review candidate")
  .argument("<id>", "Candidate memory id")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((id: string, options: { scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      console.log(printMemory(repo.reject(id)));
    });
  });

program
  .command("context")
  .description("Print compact project context for an agent")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((options: { scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const context = repo.context();
      console.log(context || "No context memories found.");
    });
  });

program
  .command("render")
  .description("Render active memories to read-only Markdown")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((options: { scope: string }) => {
    withCurrentProject((project) => {
      const repo = new MemoryRepository(project, { scope: parseScope(options.scope) });
      try {
        const output = writeMarkdownRender(project, repo.allActive());
        console.log(output);
      } finally {
        repo.close();
      }
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smem: ${message}`);
  process.exitCode = 1;
});

function withRegistry<T>(fn: (registry: RegistryRepository) => T): T {
  const registry = new RegistryRepository();
  try {
    return fn(registry);
  } finally {
    registry.close();
  }
}

function withCurrentProject<T>(fn: (project: ReturnType<RegistryRepository["requireCurrentProject"]>) => T): T {
  return withRegistry((registry) => {
    const project = registry.requireCurrentProject(process.cwd());
    return fn(project);
  });
}

function moveCurrentDirectoryMapping(options: { projectId?: string; fromPath?: string }): void {
  withRegistry((registry) => {
    if (!options.projectId && !options.fromPath) {
      throw new Error("Expected --project-id <id> or --from-path <path>.");
    }

    const project = options.projectId
      ? registry.attachProject({
          cwd: process.cwd(),
          projectId: options.projectId
        })
      : registry.attachProjectFromPath({
          cwd: process.cwd(),
          fromPath: options.fromPath!
        });
    console.log(printProject(project));
  });
}

function withMemoryRepository<T>(scope: "local" | "global", fn: (repo: MemoryRepository) => T): T {
  return withCurrentProject((project) => {
    const repo = new MemoryRepository(project, { scope });
    try {
      return fn(repo);
    } finally {
      repo.close();
    }
  });
}

async function withMemoryRepositoryAsync<T>(
  scope: "local" | "global",
  fn: (repo: MemoryRepository, project: ReturnType<RegistryRepository["requireCurrentProject"]>) => Promise<T>
): Promise<T> {
  return withCurrentProject(async (project) => {
    const repo = new MemoryRepository(project, { scope });
    try {
      return await fn(repo, project);
    } finally {
      repo.close();
    }
  });
}

async function promptProjectIdConfirmation(projectId: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(`Type project id to delete (${projectId}): `)).trim();
  } finally {
    rl.close();
  }
}

function parseScope(value: string): "local" | "global" {
  if (value === "local" || value === "global") {
    return value;
  }

  throw new Error(`Invalid scope: ${value}. Expected local or global.`);
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseRecallMode(value: string): "contains" | "fts" | "semantic" | "hybrid" {
  if (value === "contains" || value === "fts" || value === "semantic" || value === "hybrid") {
    return value;
  }

  throw new Error(`Invalid recall mode: ${value}. Expected contains, fts, semantic, or hybrid.`);
}

function parseCaptureKind(value: string): "raw-input" | "raw-output" | "tool-event" | "raw-event" {
  if (value === "raw-input" || value === "raw-output" || value === "tool-event" || value === "raw-event") {
    return value;
  }

  throw new Error(`Invalid capture kind: ${value}. Expected raw-input, raw-output, tool-event, or raw-event.`);
}

function parseEmbeddingProvider(value: string): EmbeddingProvider {
  if (value === "openai") {
    return value;
  }

  throw new Error(`Invalid embedding provider: ${value}. Expected openai.`);
}

function hybridRecall(repo: MemoryRepository, query: string, semantic: SemanticResult[], limit: number): MemoryRecord[] {
  const lexical = repo.recall(query, limit);
  const scores = new Map<string, number>();

  for (let index = 0; index < lexical.length; index += 1) {
    const memory = lexical[index];
    if (memory) {
      scores.set(memory.id, Math.max(scores.get(memory.id) ?? 0, 1 - index * 0.02));
    }
  }

  for (const result of semantic) {
    scores.set(result.memoryId, Math.max(scores.get(result.memoryId) ?? 0, result.score));
  }

  const orderedIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  return repo.getByIds(orderedIds);
}
