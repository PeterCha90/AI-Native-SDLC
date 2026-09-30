// Role -> Slack user-group membership checks for gate approval buttons. No Slack
// API calls here: the caller injects `listMembers` (a thin wrapper around
// `usergroups.users.list`), which keeps this module testable without a live
// Slack connection and without depending on any Slack SDK.

type CanActResult = { ok: true } | { ok: false; groupId: string; error?: string };

interface CacheEntry {
  members: string[];
  expiresAt: number;
}

export class RoleChecker {
  private readonly roleGroups: Record<string, string>;
  private readonly listMembers: (groupId: string) => Promise<string[]>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(o: {
    roleGroups: Record<string, string>;
    listMembers: (groupId: string) => Promise<string[]>;
    ttlMs?: number;
    now?: () => number;
  }) {
    this.roleGroups = o.roleGroups;
    this.listMembers = o.listMembers;
    this.ttlMs = o.ttlMs ?? 60_000;
    this.now = o.now ?? Date.now;
  }

  /**
   * A role with no mapped Slack user group is unrestricted — anyone in the
   * channel can act. A role that is mapped requires membership in that group;
   * a lookup failure fails closed (ok:false), never open.
   */
  async canAct(role: string, userId: string): Promise<CanActResult> {
    const groupId = this.roleGroups[role];
    if (!groupId) return { ok: true };

    const nowMs = this.now();
    const cached = this.cache.get(groupId);
    let members: string[];

    if (cached && cached.expiresAt > nowMs) {
      members = cached.members;
    } else {
      try {
        members = await this.listMembers(groupId);
      } catch (err) {
        return { ok: false, groupId, error: (err as Error).message };
      }
      this.cache.set(groupId, { members, expiresAt: nowMs + this.ttlMs });
    }

    return members.includes(userId) ? { ok: true } : { ok: false, groupId };
  }

  /** Roles with no Slack user-group mapping — logged once at startup as a warning. */
  unrestrictedRoles(roles: string[]): string[] {
    return roles.filter((role) => !this.roleGroups[role]);
  }
}
