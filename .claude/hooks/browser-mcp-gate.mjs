#!/usr/bin/env node
// browser-mcp-gate.mjs — PreToolUse hook: a browser MCP call (Playwright, Chrome) is refused unless,
// earlier in the SAME turn, the assistant stated the gate line as a shell command:
//
//     echo 'Browser MCP because: rung N can't answer Q, because R'
//
// A command, not prose, because only tool calls are reliably in the transcript by the time this hook
// runs. Measured while building it: every tool_use is written before its tool executes, but assistant
// text written between tool calls often isn't persisted yet — so a gate line in prose was invisible to
// the hook and an honest, gated call was denied anyway. A leading `echo`/`:` also keeps a command that
// merely CONTAINS the phrase (writing this file, a grep) from counting.
//
// Why a hook: "browser MCP is the last resort" lived in CLAUDE.md, a skill and memory, and was still
// broken dozens of times in one session. Instructions can be skipped; this can't. It doesn't forbid
// the browser — it forces the one sentence of reasoning that, written honestly, usually sends the
// work back to a test, `pnpm probe` or `tools/shot.sh`. See .claude/skills/delve-testing/SKILL.md.
//
// "This turn" = every transcript entry after the most recent message a human actually typed
// (origin.kind === "human"). Injected content — skill bodies, reminders, tool results — also arrives
// as `user` entries, so "the last user entry" is not the boundary. One gate line covers the rest of
// that turn's browser calls; the next human message resets it.
//
// Fails OPEN, with a visible warning, if the transcript can't be read: a gate that silently blocked
// every browser call forever would get disabled, and then there is no gate at all.
import { readFileSync } from 'node:fs';

const GATE = /browser mcp because:/i;
/** A Bash command whose FIRST word states the gate — echo "...", printf '...', or the : no-op. */
const GATE_COMMAND = /^\s*(?:echo|printf|:)\s+(?:-\w+\s+)?["']?\s*browser mcp because:/i;

function allow(warning) {
  if (warning) process.stdout.write(JSON.stringify({ systemMessage: `browser-mcp-gate: ${warning}` }));
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  allow('could not parse hook input; not enforcing this call');
}

let rows;
try {
  rows = readFileSync(input.transcript_path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
} catch {
  allow('could not read the transcript; not enforcing this call');
}

let turnStart = 0;
for (let i = rows.length - 1; i >= 0; i--) {
  if (rows[i].type === 'user' && rows[i].origin?.kind === 'human') {
    turnStart = i + 1;
    break;
  }
}

const gated = rows.slice(turnStart).some((row) => {
  if (row.type !== 'assistant') return false;
  const content = row.message?.content;
  if (typeof content === 'string') return GATE.test(content);
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      (block.type === 'tool_use' && block.name === 'Bash' && GATE_COMMAND.test(block.input?.command ?? '')) ||
      // prose counts too when it HAS been persisted — it just can't be relied on
      (block.type === 'text' && GATE.test(block.text ?? '')),
  );
});

if (gated) allow();

deny(
  `Browser MCP is the last resort (tool: ${input.tool_name}). Before calling it, state the gate with a Bash ` +
    `call — echo 'Browser MCP because: rung N can't answer Q, because R' — then retry. (A shell call, ` +
    `not prose: only tool calls are reliably visible to this hook.) ` +
    `If you can't fill it in, use a cheaper rung instead: a failing test for a rule; \`pnpm sim\` for the ` +
    `world; \`tools/shot.sh\` for a look; \`pnpm probe <page> --play --grep/--do/--eval\` for numbers or input ` +
    `in the running game. Not reasons: "it's visual", "it needs input", "it needs the live game". ` +
    `Full ladder: the delve-testing skill.`,
);
