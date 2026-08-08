#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";

process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) {
    return;
  }

  console.warn(warning);
});

import { Command } from "commander";
import { EntityTypeSchema, MemoryInputSchema, MemoryTypeSchema, RelationTypeSchema } from "../core/schema";
import { RegistryRepository } from "../storage/registry-repository";
import { MemoryRepository } from "../storage/memory-repository";
import { GraphRepository } from "../storage/graph-repository";
import { writeMarkdownRender } from "../render/markdown";
import { parseMarkdownImport } from "../render/markdown-import";
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
import { classifyWithLlm } from "../classify/llm-classifier";
import { addLexiconWord, loadLexicon, parseLexiconCategory, removeLexiconWord, resetLexicon } from "../classify/lexicon";
import { dismissLexiconSuggestion, listLexiconSuggestions, recordPromotionSignal } from "../classify/lexicon-learning";
import { logCommandInvocation, mineCommandHabits } from "../classify/habit-mining";
import { logRecallQuery, mineQueryPatterns, suggestRelatedTopics } from "../classify/query-pattern-mining";
import { extractKeywords } from "../classify/keywords";
import {
  DEFAULT_CONFIG,
  coerceConfigValue,
  loadConfig,
  parseConfigKey,
  resolveLlmClassifierConfig,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
  type ClassifierConfig
} from "../core/config";
import { createEmbeddingClient, type EmbeddingProvider } from "../embedding/embedding-client";
import { EmbeddingRepository, type SemanticResult } from "../storage/embedding-repository";
import type { MemoryRecord } from "../core/schema";
import { rankMemories, type RecallResult } from "../retrieval/retrieval";
import { defaultSmartMemoryHome } from "../core/paths";
import { processCandidates } from "../process/candidate-processor";
import { readMemoryExport, writeMemoryExport } from "../transfer/memory-transfer";
import { daemonStatus, processOnce, runDaemon, stopDaemon } from "../daemon/daemon";
import { readEventStats } from "../hook/event-stats";
import { archiveRawEvents } from "../hook/event-retention";
import {
  formatRawEventFull,
  formatTranscriptRecordFull,
  findRawEventById,
  findTranscriptRecordById,
  isMeaningfulHistoryRecord,
  rawThread,
  searchRaw,
  summarizeRawEvent,
  summarizeTranscriptRecord
} from "../raw/raw-reader";
import { printDecisionOverlaps, printEntity, printFocus, printMacroGraph, printMemory, printProject, printRelation } from "./format";
import { stopWeb, webStatus, writeWebMetadata } from "../web/web-daemon";

const program = new Command();

program
  .name("smem")
  .description("Smart Memory CLI core MVP")
  .version("0.1.0");

// Logs every successful command invocation for `smem habits` to mine — a single hook here
// instead of touching each action handler. `postAction` (not `preAction`) so a command that
// throws doesn't get logged as if it succeeded. Runs for every command including subcommands
// (`lexicon add`, `entity add`, ...); `fullCommandPath` walks up to build "lexicon add" instead
// of just "add". This never calls an LLM — see habit-mining.ts for why frequency alone is enough.
program.hook("postAction", (_thisCommand, actionCommand) => {
  try {
    logCommandInvocation(fullCommandPath(actionCommand));
  } catch {
    // Habit logging is best-effort; it must never fail a command that otherwise succeeded.
  }
});

function fullCommandPath(command: Command): string {
  const parts: string[] = [];
  for (let current: Command | null = command; current && current.name() !== "smem"; current = current.parent) {
    parts.unshift(current.name());
  }
  return parts.join(" ");
}

program
  .command("guide")
  .description("Print the system-level smem usage guide for agents and users")
  .action(() => {
    console.log(readGuide());
  });

program
  .command("install")
  .description("Install smem bootstrap instructions for an agent in the current project")
  .option("--agent <agent>", "Agent to install: codex, claude-code, antigravity, opencode, or all", "all")
  .option("--listen", "Install native capture for the selected agents (hooks for codex/claude-code/antigravity, an opencode plugin for opencode)")
  .option("--hooks", "Alias for --listen on codex, claude-code, and antigravity")
  .option("--plugins", "Alias for --listen on opencode only")
  .option("--global", "Install hooks at the user level (all projects) instead of the current directory only")
  .option("--dry-run", "Show target files without writing")
  .action((options: { agent: string; listen?: boolean; hooks?: boolean; plugins?: boolean; global?: boolean; dryRun?: boolean }) => {
    const agents = options.agent === "all" ? knownAgents() : [parseAgentName(options.agent)];
    if (options.plugins && agents.some((agent) => agent !== "opencode")) {
      throw new Error("--plugins applies to opencode only; use --hooks for codex, claude-code, or antigravity.");
    }

    if (!options.global) {
      const results = installAgents({
        agents,
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false
      });

      for (const result of results) {
        const action = options.dryRun ? "would update" : result.changed ? "updated" : "already installed";
        console.log(`${result.agent}: ${action} ${result.filePath}`);
      }
    }

    if (options.listen || options.hooks || options.plugins) {
      const hookResults = installAgentsHooks({
        agents,
        cwd: process.cwd(),
        global: options.global ?? false,
        dryRun: options.dryRun ?? false
      });
      for (const result of hookResults) {
        const action = options.dryRun ? "would update" : result.changed ? "updated" : "already installed";
        const kind = result.agent === "opencode" ? "plugin" : "hooks";
        console.log(`${result.agent} ${kind}: ${action} ${result.filePath}`);
        if (options.global) {
          const note = globalHookVerificationNote(result.agent);
          if (note) {
            console.log(`  ${note}`);
          }
        }
      }
    }
  });

program
  .command("uninstall")
  .description("Remove smem bootstrap instructions and optional hook config from the current project")
  .option("--agent <agent>", "Agent to uninstall: codex, claude-code, antigravity, opencode, or all", "all")
  .option("--listen", "Remove native capture for the selected agents (hooks for codex/claude-code/antigravity, an opencode plugin for opencode)")
  .option("--hooks", "Alias for --listen on codex, claude-code, and antigravity")
  .option("--plugins", "Alias for --listen on opencode only")
  .option("--global", "Remove the user-level hook install instead of the current directory only")
  .option("--dry-run", "Show target files without writing")
  .action((options: { agent: string; listen?: boolean; hooks?: boolean; plugins?: boolean; global?: boolean; dryRun?: boolean }) => {
    const agents = options.agent === "all" ? knownAgents() : [parseAgentName(options.agent)];
    if (options.plugins && agents.some((agent) => agent !== "opencode")) {
      throw new Error("--plugins applies to opencode only; use --hooks for codex, claude-code, or antigravity.");
    }

    if (!options.global) {
      const results = uninstallAgents({
        agents,
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false
      });

      for (const result of results) {
        const action = options.dryRun ? "would remove" : result.changed ? "removed" : "already uninstalled";
        console.log(`${result.agent}: ${action} ${result.filePath}`);
      }
    }

    if (options.listen || options.hooks || options.plugins) {
      const hookResults = uninstallAgentsHooks({
        agents,
        cwd: process.cwd(),
        global: options.global ?? false,
        dryRun: options.dryRun ?? false
      });
      for (const result of hookResults) {
        const action = options.dryRun ? "would remove" : result.changed ? "removed" : "already uninstalled";
        const kind = result.agent === "opencode" ? "plugin" : "hooks";
        console.log(`${result.agent} ${kind}: ${action} ${result.filePath}`);
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
  .description("Classify text with the local classifier or an optional LLM provider")
  .argument("<text...>", "Text to classify")
  .option("--provider <provider>", "Classifier: offline (default) or llm", "offline")
  .action(async (textParts: string[], options: { provider: string }) => {
    const text = textParts.join(" ");
    if (options.provider === "llm") {
      let config;
      try {
        config = resolveLlmClassifierConfig();
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
        return;
      }
      if (!config) {
        console.error(
          "LLM classifier is not configured. Configure it with: smem config set classifier ollama|openai"
        );
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(await classifyWithLlm(text, config), null, 2));
      return;
    }
    console.log(JSON.stringify(classifyText(text), null, 2));
  });

const configCmd = program
  .command("config")
  .description("Show the smem CLI configuration (classifier, LLM model, ...)")
  .action(() => {
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

configCmd
  .command("get")
  .description("Show the full configuration or one key")
  .argument("[key]", "Key: classifier, model, base-url, api-key, timeout-ms")
  .action((key?: string) => {
    const config = loadConfig();
    if (!key) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    const field = parseConfigKey(key);
    if (!field) {
      throw new Error(unknownConfigKeyMessage(key));
    }
    const value = config.classifier[field];
    console.log(value === undefined ? "(not set)" : String(value));
  });

configCmd
  .command("set")
  .description("Set a configuration value")
  .argument("<key>", "Key: classifier, model, base-url, api-key, timeout-ms")
  .argument("<value>", "Value")
  .action((key: string, value: string) => {
    const field = setConfigValue(key, value);
    const shown = loadConfig().classifier[field];
    console.log(`smem: ${field} = ${shown === undefined ? "(not set)" : String(shown)}`);
    printClassifierHint(loadConfig().classifier);
  });

configCmd
  .command("unset")
  .description("Remove a configuration value")
  .argument("<key>", "Key: classifier, model, base-url, api-key, timeout-ms")
  .action((key: string) => {
    const field = unsetConfigValue(key);
    const shown = loadConfig().classifier[field];
    console.log(`smem: ${field} = ${shown === undefined ? "(not set)" : String(shown)}`);
    printClassifierHint(loadConfig().classifier);
  });

configCmd
  .command("reset")
  .description("Reset the configuration to defaults (offline classifier)")
  .action(() => {
    saveConfig(DEFAULT_CONFIG);
    console.log("smem: configuration reset to defaults (offline classifier).");
  });

function printClassifierHint(config: ClassifierConfig): void {
  if (config.provider === "offline") {
    if (config.model) {
      console.error(
        "Hint: LLM classification is off. Enable it with: smem config set classifier ollama (or openai)"
      );
    }
    return;
  }
  if (!config.model) {
    console.error("Hint: set the LLM model with: smem config set model <name>");
    return;
  }
  if (config.provider === "openai" && !config.apiKey) {
    console.error("Hint: set the API key with: smem config set api-key <key>");
    return;
  }
  console.error(`Hint: LLM classification is enabled with ${config.provider}/${config.model}.`);
}

function unknownConfigKeyMessage(key: string): string {
  return `Unknown config key "${key}". Known keys: classifier, model, base-url, api-key, timeout-ms.`;
}

const lexiconCmd = program
  .command("lexicon")
  .description("Inspect and edit the offline classifier's trigger-word dictionary (decision/todo/preference/error/question/context)")
  .action(() => {
    const lexicon = loadLexicon();
    console.log(printLexicon(lexicon));
  });

lexiconCmd
  .command("list")
  .description("List active trigger words, optionally for one category")
  .argument("[category]", "decision, todo, preference, error, question, or context")
  .action((category?: string) => {
    const lexicon = loadLexicon();
    console.log(printLexicon(lexicon, category ? parseLexiconCategory(category) : undefined));
  });

lexiconCmd
  .command("add")
  .description("Add a trigger word to a category")
  .argument("<category>", "decision, todo, preference, error, question, or context")
  .argument("<word...>", "Word or short phrase to add")
  .action((category: string, wordParts: string[]) => {
    const parsedCategory = parseLexiconCategory(category);
    const lexicon = addLexiconWord(parsedCategory, wordParts.join(" "));
    console.log(printLexicon(lexicon, parsedCategory));
  });

lexiconCmd
  .command("remove")
  .description("Remove a trigger word from a category")
  .argument("<category>", "decision, todo, preference, error, question, or context")
  .argument("<word...>", "Word or short phrase to remove")
  .action((category: string, wordParts: string[]) => {
    const parsedCategory = parseLexiconCategory(category);
    const lexicon = removeLexiconWord(parsedCategory, wordParts.join(" "));
    console.log(printLexicon(lexicon, parsedCategory));
  });

lexiconCmd
  .command("reset")
  .description("Reset the lexicon to its built-in defaults, discarding learned/added words")
  .action(() => {
    resetLexicon();
    console.log("smem: lexicon reset to defaults.");
  });

lexiconCmd
  .command("suggest")
  .description("Show words that keep showing up in promoted memories without matching any current trigger word")
  .option("--min-count <n>", "Minimum raw occurrence count before a word is suggested", parseInteger, 3)
  .option("--min-ratio <n>", "Minimum share of that category's confirmations the word must appear in (0-1)", parseRatio, 0.15)
  .action((options: { minCount: number; minRatio: number }) => {
    const suggestions = listLexiconSuggestions(undefined, { minCount: options.minCount, minRatio: options.minRatio });
    if (suggestions.length === 0) {
      console.log(
        "No suggestions yet. Suggestions appear once a word shows up in enough promoted memories, relative to how many of that type have been confirmed, that no current trigger word explains."
      );
      return;
    }
    console.log(
      suggestions
        .map(
          (s) =>
            `${s.category} "${s.word}" — ${s.count}/${s.total} promoted memories not yet explained by the lexicon (${(s.ratio * 100).toFixed(0)}%)`
        )
        .join("\n")
    );
    console.log("\nAdd one with: smem lexicon add <category> <word>");
    console.log("Or dismiss without adding: smem lexicon dismiss <category> <word>");
  });

lexiconCmd
  .command("dismiss")
  .description("Clear a suggestion's counter without adding it to the lexicon")
  .argument("<category>", "decision, todo, preference, error, question, or context")
  .argument("<word...>", "Suggested word or phrase to dismiss")
  .action((category: string, wordParts: string[]) => {
    const parsedCategory = parseLexiconCategory(category);
    dismissLexiconSuggestion(parsedCategory, wordParts.join(" "));
    console.log(`smem: dismissed suggestion "${wordParts.join(" ")}" for ${parsedCategory}.`);
  });

function printLexicon(lexicon: ReturnType<typeof loadLexicon>, only?: ReturnType<typeof parseLexiconCategory>): string {
  const categories = only ? [only] : (Object.keys(lexicon) as Array<keyof typeof lexicon>);
  return categories.map((category) => `${category}: ${lexicon[category].join(", ") || "(empty)"}`).join("\n");
}

program
  .command("habits")
  .description("Show command sequences you run often, mined from your own smem command history (0 LLM)")
  .option("--window-seconds <n>", "Max gap between two commands to count as one sequence", parseInteger, 300)
  .option("--min-count <n>", "Minimum raw occurrence count before a sequence is surfaced", parseInteger, 3)
  .option("--min-ratio <n>", "Minimum share of all observed sequences the pair must account for (0-1)", parseRatio, 0.1)
  .action((options: { windowSeconds: number; minCount: number; minRatio: number }) => {
    const habits = mineCommandHabits(undefined, {
      windowSeconds: options.windowSeconds,
      minCount: options.minCount,
      minRatio: options.minRatio
    });
    if (habits.length === 0) {
      console.log("No habits detected yet. This mines your own `smem` command history — nothing to see until there's enough of it.");
      return;
    }
    console.log(
      habits
        .map(
          (h) =>
            `smem ${h.steps[0]} -> smem ${h.steps[1]}  (${h.count}/${h.totalPairs} sequences, ${(h.ratio * 100).toFixed(0)}%, avg gap ${h.avgGapSeconds.toFixed(0)}s)`
        )
        .join("\n")
    );
  });

program
  .command("query-patterns")
  .description("Show topic pairs learned from your own `smem recall` history (0 LLM)")
  .option("--window-seconds <n>", "Max gap between two recalls to count as one sequence", parseInteger, 1800)
  .option("--min-count <n>", "Minimum raw occurrence count before a pair is surfaced", parseInteger, 3)
  .option("--min-ratio <n>", "Minimum share of all observed pairs the topic pair must account for (0-1)", parseRatio, 0.1)
  .action((options: { windowSeconds: number; minCount: number; minRatio: number }) => {
    const patterns = mineQueryPatterns(undefined, {
      windowSeconds: options.windowSeconds,
      minCount: options.minCount,
      minRatio: options.minRatio
    });
    if (patterns.length === 0) {
      console.log("No query patterns detected yet. This mines your own `smem recall` history — nothing to see until there's enough of it.");
      return;
    }
    console.log(
      patterns
        .map((p) => `"${p.topics[0]}" -> "${p.topics[1]}"  (${p.count}/${p.totalPairs} pairs, ${(p.ratio * 100).toFixed(0)}%)`)
        .join("\n")
    );
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
  .option("--namespace <namespace>", "Namespace (Level 1 classification)")
  .option("--title <title>", "Memory title")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--tag <tag>", "Single tag; can be repeated", collectOption, [])
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .option("--chosen <choice>", "Decision only: what was chosen (skips regex extraction from content)")
  .option("--rejected <alternative>", "Decision only: a rejected alternative; can be repeated", collectOption, [])
  .option("--reason <reason>", "Decision only: why (pairs with --chosen)")
  .argument("<content...>", "Memory content")
  .action(
    (
      contentParts: string[],
      options: {
        type: string;
        namespace?: string;
        title?: string;
        tags?: string;
        tag: string[];
        scope: string;
        chosen?: string;
        rejected: string[];
        reason?: string;
      }
    ) => {
    const type = MemoryTypeSchema.parse(options.type);
    const scope = parseScope(options.scope);
    const content = contentParts.join(" ").trim();
    const tags = parseTags(options.tags, options.tag);

    withMemoryRepository(scope, (repo) => {
      const input = MemoryInputSchema.parse({
        type,
        namespace: options.namespace ?? null,
        ...(options.title ? { title: options.title } : {}),
        content,
        tags,
        ...(options.chosen || options.rejected.length > 0 || options.reason
          ? {
              decision: {
                ...(options.chosen ? { chosen: options.chosen } : {}),
                rejectedAlternatives: options.rejected,
                ...(options.reason ? { reasoning: options.reason } : {})
              }
            }
          : {})
      });
      const memory = repo.create(input);
      console.log(printMemory(memory));
      // Explicit `smem store --type X` is a human confirming this content is type X directly —
      // at least as strong a signal as a promote, so it feeds the same lexicon-learning counter.
      if (memory.status === "active") {
        recordPromotionSignal(memory);
      }
      if (memory.type === "decision" && memory.decision && memory.status === "active") {
        const overlaps = repo.findDecisionOverlaps(memory.decision, tags, { excludeId: memory.id });
        if (overlaps.length > 0) {
          console.log("");
          console.log(printDecisionOverlaps(overlaps));
        }
      }
    });
    }
  );

program
  .command("supersede")
  .description("Mark an active decision memory as superseded by another one")
  .argument("<old-id>", "Memory id being replaced")
  .requiredOption("--by <new-id>", "Memory id that replaces it")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((oldId: string, options: { by: string; scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      console.log(printMemory(repo.supersede(oldId, options.by)));
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
  .command("namespaces")
  .description("List all unique namespaces")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((options: { scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const list = repo.namespaces();
      console.log(list.length > 0 ? list.join("\n") : "No namespaces found.");
    });
  });

program
  .command("tags")
  .description("List all unique tags, optionally filtered by namespace")
  .option("--namespace <namespace>", "Filter tags by namespace")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((options: { namespace?: string; scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const list = repo.tags(options.namespace);
      console.log(list.length > 0 ? list.map((tag) => `#${tag}`).join("\n") : "No tags found.");
    });
  });

program
  .command("show <memory-id>")
  .description("Show one official, candidate, rejected, or archived memory by id")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((memoryId: string, options: { scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const memory = repo.getById(memoryId);
      if (!memory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }
      console.log(printMemory(memory));
    });
  });

program
  .command("edit <memory-id>")
  .description("Edit an active or pending-review memory without changing its id")
  .option("--type <type>", "Memory type")
  .option("--namespace <namespace>", "Memory namespace")
  .option("--clear-namespace", "Remove the current namespace")
  .option("--title <title>", "Memory title")
  .option("--content <content>", "Memory content")
  .option("--tags <tags>", "Replace tags with comma-separated values")
  .option("--clear-title", "Remove the current title")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((memoryId: string, options: { type?: string; namespace?: string; clearNamespace?: boolean; title?: string; content?: string; tags?: string; clearTitle?: boolean; scope: string }) => {
    if (!options.type && options.namespace === undefined && !options.clearNamespace && options.title === undefined && !options.content && options.tags === undefined && !options.clearTitle) {
      throw new Error("Provide at least one field to edit: --type, --namespace, --clear-namespace, --title, --content, --tags, or --clear-title.");
    }
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const type = options.type ? MemoryTypeSchema.parse(options.type) : undefined;
      console.log(printMemory(repo.update(memoryId, {
        ...(type ? { type } : {}),
        ...(options.clearNamespace ? { namespace: null } : options.namespace !== undefined ? { namespace: options.namespace } : {}),
        ...(options.clearTitle ? { title: null } : options.title !== undefined ? { title: options.title } : {}),
        ...(options.content ? { content: options.content } : {}),
        ...(options.tags !== undefined ? { tags: parseTags(options.tags) } : {})
      })));
    });
  });

program
  .command("archive <memory-id>")
  .description("Archive an active memory without deleting it")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((memoryId: string, options: { scope: string }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      console.log(printMemory(repo.archive(memoryId)));
    });
  });

program
  .command("export")
  .description("Export project memories to a portable JSON file")
  .requiredOption("--out <path>", "Output JSON path")
  .option("--project-id <id>", "Project id; defaults to the current directory project")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action((options: { out: string; projectId?: string; scope: string }) => {
    const scope = parseScope(options.scope);
    withRegistry((registry) => {
      const project = options.projectId ? registry.findById(options.projectId) : registry.requireCurrentProject(process.cwd());
      if (!project) {
        throw new Error(`Project not found: ${options.projectId}`);
      }
      const repo = new MemoryRepository(project, { scope });
      try {
        const memories = repo.allRecords();
        const outputPath = writeMemoryExport(options.out, project, scope, memories);
        console.log(`Exported ${memories.length} memories to ${outputPath}`);
      } finally {
        repo.close();
      }
    });
  });

program
  .command("import <file>")
  .description("Import memories from a smem JSON export into the current project")
  .option("--scope <scope>", "Target memory scope: local or global", "local")
  .option("--on-conflict <mode>", "Conflict behavior: skip or replace", "skip")
  .action((file: string, options: { scope: string; onConflict: string }) => {
    if (options.onConflict !== "skip" && options.onConflict !== "replace") {
      throw new Error(`Invalid conflict mode: ${options.onConflict}. Expected skip or replace.`);
    }
    const payload = readMemoryExport(file);
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const conflict = options.onConflict as "skip" | "replace";
      const result = repo.importRecords(payload.memories, conflict);
      console.log(`Imported ${result.imported} memories; skipped ${result.skipped}.`);
    });
  });

program
  .command("feed <file>")
  .description("Import memory records from an agent-authored markdown file — run `smem guide` for the exact format")
  .option("--scope <scope>", "Default scope for records that don't set their own via a `scope:` metadata line", "local")
  .option("--pending-review", "Create records as pending-review instead of active")
  .action((file: string, options: { scope: string; pendingReview?: boolean }) => {
    const defaultScope = parseScope(options.scope);
    const markdown = readFileSync(resolve(file), "utf8");
    const { records, skippedEmpty } = parseMarkdownImport(markdown);

    if (records.length === 0) {
      console.log(
        skippedEmpty > 0
          ? `No records created — found ${skippedEmpty} heading(s) with no content. Run \`smem guide\` for the expected markdown structure.`
          : 'No "## " headings found. Run `smem guide` for the expected markdown structure.'
      );
      return;
    }

    withCurrentProject((project) => {
      const repos = new Map<"local" | "global", MemoryRepository>();
      const repoFor = (scope: "local" | "global"): MemoryRepository => {
        const existing = repos.get(scope);
        if (existing) {
          return existing;
        }
        const created = new MemoryRepository(project, { scope });
        repos.set(scope, created);
        return created;
      };

      try {
        const createdMemories = records.map((record) => {
          const scope = record.scope ?? defaultScope;
          const memory = repoFor(scope).create(record.input, options.pendingReview ? { status: "pending-review" } : {});
          if (memory.status === "active") {
            // An agent writing this file and a user explicitly running `smem feed` on it is at
            // least as strong a confirmation signal as `smem store` — feed the same lexicon.
            recordPromotionSignal(memory);
          }
          return memory;
        });

        console.log(createdMemories.map(printMemory).join("\n\n"));
        console.log("");
        const skippedNote = skippedEmpty > 0 ? `, skipped ${skippedEmpty} empty heading(s)` : "";
        console.log(`Created ${createdMemories.length} memor${createdMemories.length === 1 ? "y" : "ies"}${skippedNote}.`);
      } finally {
        for (const repo of repos.values()) {
          repo.close();
        }
      }
    });
  });

program
  .command("scan")
  .description("Rebuild registry mappings from outsider project stores")
  .requiredOption("--store <path>", "Project store or directory containing project stores")
  .option("--root <path>", "Root path for a single legacy store without project.json")
  .option("--name <name>", "Project name for a legacy store without project.json")
  .action((options: { store: string; root?: string; name?: string }) => {
    withRegistry((registry) => {
      const result = registry.scanStores(options);
      result.projects.forEach((project) => console.log(printProject(project)));
      result.skipped.forEach((message) => console.error(`Skipped: ${message}`));
      console.log(`scanned=${result.projects.length} skipped=${result.skipped.length}`);
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
  .option("--compact", "Print only ids, types, and titles for cheap agent routing")
  .option("--explain", "Print deterministic match and ranking reasons")
  .option("--type <type>", "Filter by memory type")
  .option("--tag <tag>", "Filter by exact memory tag")
  .option("--topic <topic>", "Filter by tag or offline classification topic")
  .option("--namespace <namespace>", "Filter by exact namespace")
  .option("--status <status>", "Filter by status; defaults to active")
  .action(
    async (
      queryParts: string[],
      options: {
        limit: number;
        scope: string;
        mode: string;
        provider: string;
        model?: string;
        compact?: boolean;
        explain?: boolean;
        type?: string;
        tag?: string;
        topic?: string;
        namespace?: string;
        status?: string;
      }
    ) => {
      const query = queryParts.join(" ");
      const scope = parseScope(options.scope);
      const mode = parseRecallMode(options.mode);
      const provider = parseEmbeddingProvider(options.provider);
      const recallOptions = {
        query,
        limit: options.limit,
        ...(mode === "contains" || mode === "fts" ? { mode } : {}),
        ...(options.type ? { type: MemoryTypeSchema.parse(options.type) } : {}),
        ...(options.tag ? { tag: options.tag } : {}),
        ...(options.topic ? { topic: options.topic } : {}),
        ...(options.namespace ? { namespace: options.namespace } : {}),
        ...(options.status ? { status: parseMemoryStatus(options.status) } : {})
      };
      const results = await withMemoryRepositoryAsync(scope, async (repo, project) => {
        if (mode === "contains") {
          return repo.retrieve(recallOptions);
        }
        if (mode === "fts") {
          return repo.retrieve(recallOptions);
        }

        const client = createEmbeddingClient({
          provider,
          ...(options.model ? { model: options.model } : {})
        });
        const embeddings = new EmbeddingRepository(project, { scope });
        try {
          const semantic = await embeddings.search(query, client, options.limit);
          if (mode === "semantic") {
            return semanticRecall(repo, recallOptions, semantic, options.limit);
          }

          return hybridRecall(repo, recallOptions, semantic, options.limit);
        } finally {
          embeddings.close();
        }
      });
      console.log(
        results.length > 0
          ? results.map((result) => formatRecallResult(result, options)).join("\n")
          : "No matching memories."
      );

      // Best-effort query-pattern learning — never blocks or fails the recall itself.
      try {
        logRecallQuery(query);
        if (!options.compact) {
          const currentTopics = extractKeywords(query, 2, 6).filter((topic) => !topic.includes(" "));
          const related = suggestRelatedTopics(currentTopics);
          if (related.length > 0) {
            console.log(
              `\nRelated searches (from your own recall history): ${related.map((r) => `"${r.topic}"`).join(", ")}`
            );
          }
        }
      } catch {
        // Learning is a side effect of recall, not part of its contract.
      }
    }
  );

const raw = program
  .command("raw")
  .description("Search raw hook captures before they become candidates or memories")
  .argument("<query...>", "Raw search query")
  .option("--limit <n>", "Raw event limit", parseInteger, 20)
  .option("--offset <n>", "Search offset", parseInteger, 0)
  .option("--agent <agent>", "Filter by agent: codex, claude-code, antigravity, or opencode")
  .option("--kind <kind>", "Filter by capture kind: raw-input, raw-output, tool-event, or raw-event")
  .option("--json", "Print raw JSON lines")
  .option("--full", "Print full formatted raw event JSON")
  .option("--after <n>", "Compatibility alias for `smem history <query> --after <n>`", parseInteger)
  .option("--before <n>", "Compatibility alias for `smem history <query> --before <n>`", parseInteger)
raw.action((queryParts: string[], options: { limit: number; offset: number; agent?: string; kind?: string; json?: boolean; full?: boolean; after?: number; before?: number }) => {
    const threadMode = queryParts[0] === "thread";
    const query = (threadMode ? queryParts.slice(1) : queryParts).join(" ");
    if (threadMode || options.after !== undefined || options.before !== undefined) {
      const result = rawThread({
        query,
        after: options.after ?? (options.before !== undefined ? 0 : 10),
        ...(options.before !== undefined ? { before: options.before } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.agent ? { agent: parseAgentName(options.agent) } : {}),
        ...(options.kind ? { kind: parseCaptureKind(options.kind) } : {})
      });
      if (result.records.length === 0) {
        console.log("No raw thread found.");
        return;
      }

      const isId = query && !query.includes(" ") && query.length >= 10 && result.totalMatches === 1;
      if (isId) {
        console.log(`Showing context for record ID: ${query}\n`);
      } else if (result.totalMatches && result.totalMatches > 0 && query !== "") {
        const matchIndexStr = options.offset ? ` match at offset ${options.offset}` : " best match";
        console.log(`Found ${result.totalMatches} matches. Showing context around the${matchIndexStr}:\n`);
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
      offset: options.offset,
      ...(options.agent ? { agent: parseAgentName(options.agent) } : {}),
      ...(options.kind ? { kind: parseCaptureKind(options.kind) } : {})
    });
    const records = [...result.transcripts, ...result.events];

    if (records.length === 0) {
      console.log("No raw events found.");
      return;
    }

    const totalFound = result.totalEvents + result.totalTranscripts;
    console.log(`Found ${totalFound} raw events/transcripts matching query: "${query}"\n`);

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

raw
  .command("show <event-id>")
  .description("Show one raw hook event by its stable event id")
  .option("--json", "Print the original raw JSONL line")
  .action((eventId: string, options: { json?: boolean }) => {
    const record = findRawEventById(eventId);
    if (!record) {
      throw new Error(`Raw event not found: ${eventId}`);
    }
    console.log(options.json ? record.line : formatRawEventFull(record));
  });

const history = program
  .command("history")
  .description("Read conversation history from a raw transcript match onward")
  .argument("<query...>", "Raw search query")
  .option("--after <n>", "Number of meaningful (user/assistant) records after the match", parseInteger, 10)
  .option("--before <n>", "Number of meaningful (user/assistant) records before the match", parseInteger, 0)
  .option("--offset <n>", "Select the N-th match as the anchor", parseInteger, 0)
  .option("--agent <agent>", "Filter by agent: codex, claude-code, antigravity, or opencode")
  .option("--kind <kind>", "Filter by capture kind: raw-input, raw-output, tool-event, or raw-event")
  .option("--full", "Print full transcript JSON records")
  .option("--verbose", "Include thinking, tool-only, and command-result records")
history.action((queryParts: string[], options: { after: number; before: number; offset: number; agent?: string; kind?: string; full?: boolean; verbose?: boolean }) => {
    const query = queryParts.join(" ");
    const result = rawThread({
      query,
      after: options.after,
      ...(options.before !== undefined ? { before: options.before } : {}),
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.agent ? { agent: parseAgentName(options.agent) } : {}),
      ...(options.kind ? { kind: parseCaptureKind(options.kind) } : {})
    });
    if (result.records.length === 0) {
      console.log("No history found.");
      return;
    }

    const isId = query && !query.includes(" ") && query.length >= 10 && result.totalMatches === 1;
    if (isId) {
      console.log(`Showing context for record ID: ${query}\n`);
    } else if (result.totalMatches && result.totalMatches > 0 && query !== "") {
      const matchIndexStr = options.offset ? ` match at offset ${options.offset}` : " best match";
      console.log(`Found ${result.totalMatches} matches. Showing context around the${matchIndexStr}:\n`);
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

history
  .command("show <record-id>")
  .description("Show one normalized transcript record by its stable record id")
  .option("--full", "Print the original transcript JSON and path")
  .action((recordId: string, options: { full?: boolean }) => {
    const record = findTranscriptRecordById(recordId);
    if (!record) {
      throw new Error(`Transcript record not found: ${recordId}`);
    }
    console.log(options.full ? formatTranscriptRecordFull(record) : summarizeTranscriptRecord(record));
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
  .option("--background", "Run as a hook-triggered background worker")
  .action(async (options: { scope: string; limit: number; background?: boolean }) => {
    const release = options.background ? acquireProcessLock() : undefined;
    if (options.background && !release) {
      return;
    }

    const scope = parseScope(options.scope);
    try {
      await withCurrentProject(async (project) => {
        const result = await processCandidates({
          project,
          scope,
          limit: options.limit
        });
        if (!options.background) {
          console.log(formatProcessResult(result));
        }
      });
    } finally {
      release?.();
    }
  });

const daemon = program.command("daemon").description("Optional background offline processing worker");

daemon
  .command("once")
  .description("Process one raw capture batch and exit")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .action(async (options: { scope: string }) => {
    const result = await processOnce({ cwd: process.cwd(), scope: parseScope(options.scope) });
    console.log(formatProcessResult(result));
  });

program
  .command("events")
  .description("Inspect raw capture queue diagnostics")
  .command("stats")
  .description("Show raw queue size and event breakdown")
  .action(() => {
    console.log(JSON.stringify(readEventStats(), null, 2));
  });

const events = program.commands.find((command) => command.name() === "events");
events
  ?.command("archive")
  .description("Move old raw events to a recoverable archive")
  .requiredOption("--older-than <days>", "Archive events older than this many days", parsePositiveNumber)
  .option("--apply", "Apply the archive operation; without this flag only prints a preview")
  .action((options: { olderThan: number; apply?: boolean }) => {
    if (!options.apply) {
      console.log(`Preview only. Re-run with --apply to archive events older than ${options.olderThan} days.`);
      return;
    }
    console.log(JSON.stringify(archiveRawEvents({ olderThanDays: options.olderThan }), null, 2));
  });

daemon
  .command("run")
  .description("Run the optional persistent offline processing daemon in the foreground")
  .option("--scope <scope>", "Memory scope: local or global", "local")
  .option("--interval <ms>", "Processing interval in milliseconds", parseInteger, 1000)
  .action(async (options: { scope: string; interval: number }) => {
    await runDaemon({
      cwd: process.cwd(),
      scope: parseScope(options.scope),
      intervalMs: options.interval,
      onCycle: (result) => {
        if (result.created > 0) {
          console.error(`smem daemon: scanned=${result.scanned} created=${result.created} skipped=${result.skipped}`);
        }
      }
    });
  });

daemon
  .command("status")
  .description("Show the local daemon status")
  .action(() => {
    const status = daemonStatus();
    console.log(status ? JSON.stringify(status, null, 2) : "smem daemon is not running.");
  });

daemon
  .command("stop")
  .description("Stop the local daemon without touching raw data")
  .action(() => {
    console.log(stopDaemon() ? "Stop signal sent to smem daemon." : "smem daemon is not running.");
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
      const promoted = repo.promote(id);
      console.log(printMemory(promoted));
      // A human just confirmed this content belongs to `promoted.type` — if none of the
      // current lexicon words explain that, count its keywords as a lexicon-learning signal.
      recordPromotionSignal(promoted);
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
  .option("--limit <n>", "Maximum official memories", parseInteger, 15)
  .option("--max-chars <n>", "Maximum rendered characters", parseInteger, 12000)
  .action((options: { scope: string; limit: number; maxChars: number }) => {
    withMemoryRepository(parseScope(options.scope), (repo) => {
      const context = repo.context({ limit: options.limit, maxChars: options.maxChars });
      console.log(context || "No context memories found.");
    });
  });

const entity = program
  .command("entity")
  .description("Manage domain-graph entities: modules, domain objects, decisions, and constraints");

entity
  .command("add")
  .description("Create a graph entity, or update its description/code-ref if the name already exists")
  .requiredOption("--type <type>", "Entity type: module, domain_object, decision, or constraint")
  .requiredOption("--name <name>", "Entity name")
  .option("--description <text>", "Short description")
  .option(
    "--code-ref <path>",
    "Breadcrumb path into the codebase; not indexed or parsed, just a pointer for the agent's own Read/Grep when it needs class/file-level detail"
  )
  .option("--scope <scope>", "Entity scope: local or global", "local")
  .action((options: { type: string; name: string; description?: string; codeRef?: string; scope: string }) => {
    const type = EntityTypeSchema.parse(options.type);
    withGraphRepository(parseScope(options.scope), (graph) => {
      const record = graph.upsertEntity({
        type,
        name: options.name,
        ...(options.description ? { description: options.description } : {}),
        ...(options.codeRef ? { codeRef: options.codeRef } : {})
      });
      console.log(printEntity(record));
    });
  });

entity
  .command("list")
  .description("List graph entities")
  .option("--type <type>", "Filter by entity type: module, domain_object, decision, or constraint")
  .option("--scope <scope>", "Entity scope: local or global", "local")
  .action((options: { type?: string; scope: string }) => {
    withGraphRepository(parseScope(options.scope), (graph) => {
      const type = options.type ? EntityTypeSchema.parse(options.type) : undefined;
      const entities = graph.listEntities(type ? { type } : {});
      console.log(entities.length > 0 ? entities.map(printEntity).join("\n\n") : "No entities found.");
    });
  });

entity
  .command("show <slug>")
  .description("Show one entity by slug")
  .option("--scope <scope>", "Entity scope: local or global", "local")
  .action((slug: string, options: { scope: string }) => {
    withGraphRepository(parseScope(options.scope), (graph) => {
      const record = graph.getBySlug(slug);
      if (!record) {
        throw new Error(`Entity not found: ${slug}`);
      }
      console.log(printEntity(record));
    });
  });

program
  .command("relate")
  .description("Record a typed relation between two existing entities")
  .requiredOption("--from <entity>", "Source entity name or slug (must already exist)")
  .requiredOption("--to <entity>", "Target entity name or slug (must already exist)")
  .requiredOption(
    "--type <type>",
    "Relation type: DEPENDS_ON, CONTAINS, COMMUNICATES_VIA, IMPACTS, RESOLVES, or REFERENCES"
  )
  .option("--detail <text>", "Extra detail shown only on `smem focus`, kept out of the macro `smem graph` view")
  .option("--scope <scope>", "Entity scope: local or global", "local")
  .action((options: { from: string; to: string; type: string; detail?: string; scope: string }) => {
    const type = RelationTypeSchema.parse(options.type);
    withGraphRepository(parseScope(options.scope), (graph) => {
      const relation = graph.createRelation({
        fromEntity: options.from,
        toEntity: options.to,
        type,
        ...(options.detail ? { detail: options.detail } : {})
      });
      const view = graph.listRelations({ entityId: relation.fromEntityId }).find((candidate) => candidate.id === relation.id);
      console.log(view ? printRelation(view, { detail: true }) : `${relation.id} ${relation.type}`);
    });
  });

program
  .command("graph")
  .description("Show the macro domain graph: modules, decisions, constraints, and how they relate (big picture, no detail)")
  .option("--scope <scope>", "Entity scope: local or global", "local")
  .action((options: { scope: string }) => {
    withGraphRepository(parseScope(options.scope), (graph) => {
      console.log(printMacroGraph(graph.macroGraph()));
    });
  });

program
  .command("focus <slug>")
  .description("Zoom into one entity: its full relation detail and what it directly contains")
  .option("--scope <scope>", "Entity scope: local or global", "local")
  .action((slug: string, options: { scope: string }) => {
    withGraphRepository(parseScope(options.scope), (graph) => {
      const result = graph.focus(slug);
      if (!result) {
        throw new Error(`Entity not found: ${slug}`);
      }
      console.log(printFocus(result));
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

program
  .command("web")
  .description("Launch the local webapp to browse, search, edit, archive, and delete memories")
  .option("--port <port>", "Port to run on", parseInteger, 4317)
  .option("--rebuild", "Force a fresh production build even if one already exists")
  .option("-d, --daemon", "Start in the background and return control of the terminal")
  .option("--stop", "Stop a webapp started with --daemon")
  .option("--status", "Show whether a daemonized webapp is running")
  .action((options: { port: number; rebuild?: boolean; daemon?: boolean; stop?: boolean; status?: boolean }) => {
    const home = defaultSmartMemoryHome();

    if (options.stop) {
      console.log(stopWeb(home) ? "Stop signal sent to smem web." : "smem web is not running.");
      return;
    }

    if (options.status) {
      const status = webStatus(home);
      console.log(status ? JSON.stringify(status, null, 2) : "smem web is not running.");
      return;
    }

    const running = webStatus(home);
    if (running) {
      console.log(`smem web is already running at http://localhost:${running.port} (pid ${running.pid}).`);
      return;
    }

    const webappDir = join(__dirname, "..", "..", "webapp");
    if (!existsSync(join(webappDir, "package.json"))) {
      console.error(`smem: webapp not found at ${webappDir}`);
      process.exitCode = 1;
      return;
    }
    if (!existsSync(join(webappDir, "node_modules"))) {
      console.error(`smem: webapp dependencies are not installed. Run \`pnpm install\` in ${webappDir} first.`);
      process.exitCode = 1;
      return;
    }

    const nextBin = join(webappDir, "node_modules", ".bin", "next");
    if (!existsSync(nextBin)) {
      console.error(`smem: next binary not found at ${nextBin}. Run \`pnpm install\` in ${webappDir} first.`);
      process.exitCode = 1;
      return;
    }

    // Spawn the local `next` binary directly rather than through `npx`, which adds an extra
    // wrapper/verification process — that extra hop is what a bare pid-based --stop can miss.
    const runNext = (args: string[]): Promise<number> =>
      new Promise((resolve) => {
        const child = spawn(nextBin, args, { cwd: webappDir, stdio: "inherit", env: process.env });
        child.on("exit", (code) => resolve(code ?? 0));
      });

    (async () => {
      const hasBuild = existsSync(join(webappDir, ".next", "BUILD_ID"));
      if (!hasBuild || options.rebuild) {
        console.log(`Building production bundle in ${webappDir}...`);
        const buildCode = await runNext(["build"]);
        if (buildCode !== 0) {
          process.exitCode = buildCode;
          return;
        }
      }

      if (options.daemon) {
        const logPath = join(home, "web.log");
        const logFd = openSync(logPath, "a");
        const child = spawn(nextBin, ["start", "-p", String(options.port)], {
          cwd: webappDir,
          stdio: ["ignore", logFd, logFd],
          env: process.env,
          detached: true
        });
        closeSync(logFd);
        child.unref();
        writeWebMetadata(home, { pid: child.pid!, port: options.port, startedAt: new Date().toISOString() });
        console.log(`smem web running in the background at http://localhost:${options.port} (pid ${child.pid}).`);
        console.log(`Logs: ${logPath}. Stop with \`smem web --stop\`.`);
        return;
      }

      process.exitCode = await runNext(["start", "-p", String(options.port)]);
    })();
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

function withGraphRepository<T>(scope: "local" | "global", fn: (repo: GraphRepository) => T): T {
  return withCurrentProject((project) => {
    const repo = new GraphRepository(project, { scope });
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

function globalHookVerificationNote(agent: string): string | null {
  if (agent === "antigravity" || agent === "codex") {
    return `Note: ${agent}'s global hook config location is inferred, not verified — chat once and check \`smem raw\`/\`smem history\` to confirm it fires.`;
  }
  if (agent === "opencode") {
    return "Note: opencode global hooks are installed as a plugin at ~/.config/opencode/plugin/smem.ts — restart opencode once, then check `smem raw` to confirm it fires.";
  }
  return null;
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

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive number: ${value}`);
  }
  return parsed;
}

function parseRatio(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid ratio: ${value}. Expected a number between 0 and 1.`);
  }
  return parsed;
}

function compactMemory(memory: MemoryRecord): string {
  return `${memory.id} type=${memory.type} status=${memory.status}${memory.title ? ` title=${memory.title}` : ""}`;
}

function formatProcessResult(result: { scanned: number; created: number; skipped: number; skippedByReason: Record<string, number> }): string {
  const reasons = Object.entries(result.skippedByReason)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(",");
  return `scanned=${result.scanned} created=${result.created} skipped=${result.skipped}${reasons ? ` reasons=${reasons}` : ""}`;
}

function acquireProcessLock(): (() => void) | null {
  const lockDir = join(defaultSmartMemoryHome(), "events");
  const lockPath = join(lockDir, "process.lock");
  mkdirSync(lockDir, { recursive: true });

  try {
    const descriptor = openSync(lockPath, "wx");
    return () => {
      closeSync(descriptor);
      try {
        unlinkSync(lockPath);
      } catch {
        // Another worker may have already cleaned up a stale lock.
      }
    };
  } catch {
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age > 5 * 60 * 1000) {
        unlinkSync(lockPath);
        return acquireProcessLock();
      }
    } catch {
      // A concurrent worker may be creating or removing the lock.
    }
    return null;
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseTags(value: string | undefined, repeated: string[] = []): string[] {
  return [value ?? "", ...repeated]
    .join(",")
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

function parseMemoryStatus(value: string): MemoryRecord["status"] {
  if (["active", "pending-review", "rejected", "superseded", "archived"].includes(value)) {
    return value as MemoryRecord["status"];
  }
  throw new Error(`Invalid memory status: ${value}.`);
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

function hybridRecall(
  repo: MemoryRepository,
  options: Parameters<MemoryRepository["retrieve"]>[0],
  semantic: SemanticResult[],
  limit: number
): RecallResult[] {
  const lexical = repo.retrieve({ ...options, limit });
  const scores = new Map<string, number>();

  for (let index = 0; index < lexical.length; index += 1) {
    const result = lexical[index];
    if (result) {
      scores.set(result.memory.id, Math.max(scores.get(result.memory.id) ?? 0, 1 - index * 0.02));
    }
  }

  for (const result of semantic) {
    scores.set(result.memoryId, Math.max(scores.get(result.memoryId) ?? 0, result.score));
  }

  const orderedIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  const byId = new Map(lexical.map((result) => [result.memory.id, result]));
  const semanticMemories = repo.getByIds(semantic.map((result) => result.memoryId));
  for (const result of rankMemories(semanticMemories, { ...options, query: "", limit })) {
    byId.set(result.memory.id, result);
  }
  return orderedIds
    .map((id) => byId.get(id))
    .filter((result): result is RecallResult => Boolean(result));
}

function semanticRecall(
  repo: MemoryRepository,
  options: Parameters<MemoryRepository["retrieve"]>[0],
  semantic: SemanticResult[],
  limit: number
): RecallResult[] {
  const memories = repo.getByIds(semantic.map((result) => result.memoryId));
  const byId = new Map(rankMemories(memories, { ...options, query: "", limit }).map((result) => [result.memory.id, result]));
  return semantic
    .map((match) => {
      const base = byId.get(match.memoryId);
      return base
        ? {
            memory: base.memory,
            reason: {
              score: match.score,
              matches: ["semantic"],
              adjustments: [`embedding:${match.score.toFixed(3)}`]
            }
          }
        : undefined;
    })
    .filter((result): result is RecallResult => Boolean(result))
    .slice(0, limit);
}

function formatRecallResult(
  result: RecallResult,
  options: { compact?: boolean; explain?: boolean }
): string {
  const memory = result.memory;
  if (options.compact) {
    const title = memory.title ? ` title=${memory.title}` : "";
    const reason = options.explain ? ` score=${result.reason.score.toFixed(2)} matches=${result.reason.matches.join(",")}` : "";
    return `${memory.id} type=${memory.type} status=${memory.status}${title}${reason}`;
  }
  const output = printMemory(memory);
  return options.explain
    ? `${output}\nmatch: ${result.reason.matches.join(", ") || "filter-only"}\nrank: ${result.reason.adjustments.join(", ")} score=${result.reason.score.toFixed(2)}`
    : output;
}
