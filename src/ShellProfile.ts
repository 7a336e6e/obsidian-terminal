import { TerminalProfile } from "./types";
import * as os from "os";
import * as fs from "fs";

const userShell = process.env.SHELL || "/bin/zsh";

function makeProfile(
  id: string,
  name: string,
  shellPath: string,
  args: string[] = []
): TerminalProfile {
  return { id, name, shellPath, args, env: {}, icon: "terminal" };
}

function buildBuiltinProfiles(): TerminalProfile[] {
  const platform = process.platform;

  if (platform === "win32") {
    // Windows is not yet supported — TerminalInstance will surface a clear error.
    return [];
  }

  const candidates: TerminalProfile[] = [];

  if (platform === "darwin") {
    candidates.push(makeProfile("zsh", "zsh", "/bin/zsh"));
    candidates.push(makeProfile("bash", "bash", "/bin/bash"));
  } else {
    // Linux and other POSIX systems
    candidates.push(makeProfile("bash", "bash", "/bin/bash"));
    const zshPath = fs.existsSync("/usr/bin/zsh") ? "/usr/bin/zsh" : "/bin/zsh";
    candidates.push(makeProfile("zsh", "zsh", zshPath));
    candidates.push(makeProfile("sh", "sh", "/bin/sh"));
  }

  const defaultName = `Default (${userShell.split("/").pop()})`;
  candidates.push(makeProfile("default", defaultName, userShell));

  // Drop entries whose shell binary doesn't exist on this machine.
  return candidates.filter((p) => {
    if (p.id === "default") return true; // SHELL env var — trust it
    return fs.existsSync(p.shellPath);
  });
}

export const BUILTIN_PROFILES: TerminalProfile[] = buildBuiltinProfiles();

export function getAllProfiles(
  customProfiles: TerminalProfile[]
): TerminalProfile[] {
  return [...BUILTIN_PROFILES, ...customProfiles];
}

export function getProfile(
  id: string,
  customProfiles: TerminalProfile[]
): TerminalProfile {
  const all = getAllProfiles(customProfiles);
  return (
    all.find((p) => p.id === id) ||
    all.find((p) => p.id === "default") ||
    (all.length > 0 ? all[0] : makeProfile("fallback", "sh", "/bin/sh"))
  );
}

export function getDefaultCwd(vaultPath: string): string {
  return vaultPath || os.homedir();
}
