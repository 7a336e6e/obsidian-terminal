import { TerminalProfile } from "./types";
import * as os from "os";

const userShell = process.env.SHELL || "/bin/zsh";

export const BUILTIN_PROFILES: TerminalProfile[] = [
  {
    id: "zsh",
    name: "zsh",
    shellPath: "/bin/zsh",
    args: [],
    env: {},
    icon: "terminal",
  },
  {
    id: "bash",
    name: "bash",
    shellPath: "/bin/bash",
    args: [],
    env: {},
    icon: "terminal",
  },
  {
    id: "default",
    name: `Default (${userShell.split("/").pop()})`,
    shellPath: userShell,
    args: [],
    env: {},
    icon: "terminal",
  },
];

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
  return all.find((p) => p.id === id) || BUILTIN_PROFILES[0];
}

export function getDefaultCwd(vaultPath: string): string {
  return vaultPath || os.homedir();
}
