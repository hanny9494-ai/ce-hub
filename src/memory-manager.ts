import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CWD = process.env.CE_HUB_CWD || process.cwd();
const MEMORY_DIR = join(CWD, '.ce-hub', 'memory');

export class MemoryManager {
  initialize(): void {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
    console.log(`[MemoryManager] memory dir: ${MEMORY_DIR}`);
  }

  // Get all memory files for an agent
  getMemory(agentName: string): Record<string, string> {
    const dir = join(MEMORY_DIR, agentName);
    if (!existsSync(dir)) return {};
    const result: Record<string, string> = {};
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      result[f.replace('.md', '')] = readFileSync(join(dir, f), 'utf-8');
    }
    return result;
  }

  // Get concatenated memory for prompt injection
  getMemoryPrompt(agentName: string): string {
    const mem = this.getMemory(agentName);
    if (Object.keys(mem).length === 0) return '';
    return Object.entries(mem).map(([k, v]) => `## ${k}\n${v}`).join('\n\n');
  }

  // Update a specific memory file
  updateMemory(agentName: string, filename: string, content: string): void {
    const dir = join(MEMORY_DIR, agentName);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename.endsWith('.md') ? filename : `${filename}.md`), content);
    console.log(`[MemoryManager] updated ${agentName}/${filename}`);
  }

  // Append to a memory file
  appendMemory(agentName: string, filename: string, entry: string): void {
    const dir = join(MEMORY_DIR, agentName);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, filename.endsWith('.md') ? filename : `${filename}.md`);
    const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    const timestamp = new Date().toISOString().split('T')[0];
    writeFileSync(path, existing + `\n\n### ${timestamp}\n${entry}`);
  }

  // Extract and save key info from agent result
  extractAndSave(agentName: string, taskSummary: string, outputFiles: string[]): void {
    // Append to runs log
    this.appendMemory(agentName, 'runs', `- ${taskSummary}${outputFiles.length ? '\n  Files: ' + outputFiles.join(', ') : ''}`);
  }

  listAgentsWithMemory(): string[] {
    if (!existsSync(MEMORY_DIR)) return [];
    return readdirSync(MEMORY_DIR).filter(f => {
      const dir = join(MEMORY_DIR, f);
      try { return statSync(dir).isDirectory(); } catch { return false; }
    });
  }
}
