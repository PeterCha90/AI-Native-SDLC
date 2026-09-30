/**
 * Zero-dependency argv parser for the `ai-sdlc-runner` CLI. Deliberately has no imports (not even
 * node:util) so it can be unit-tested in complete isolation from every other module, including the
 * Task 1 files this package depends on elsewhere.
 */
export interface ParsedArgs {
  command: "init" | "start" | "doctor" | "manifest" | "config" | "help";
  repo?: string;
  home?: string;
  yes: boolean;
  open: boolean;
  skipChecks: boolean;
  channel?: string;
  team?: string;
}

const COMMANDS = new Set<ParsedArgs["command"]>(["init", "start", "doctor", "manifest", "config", "help"]);

function helpFallback(): ParsedArgs {
  return { command: "help", yes: false, open: false, skipChecks: false };
}

/** Unknown command or unknown option both fall back to `help` — never throws. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (!first || !COMMANDS.has(first as ParsedArgs["command"])) {
    return helpFallback();
  }

  const result: ParsedArgs = { command: first as ParsedArgs["command"], yes: false, open: false, skipChecks: false };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case "--repo":
        result.repo = rest[++i];
        break;
      case "--home":
        result.home = rest[++i];
        break;
      case "--yes":
        result.yes = true;
        break;
      case "--open":
        result.open = true;
        break;
      case "--skip-checks":
        result.skipChecks = true;
        break;
      case "--channel":
        result.channel = rest[++i];
        break;
      case "--team":
        result.team = rest[++i];
        break;
      default:
        return helpFallback();
    }
  }

  return result;
}
