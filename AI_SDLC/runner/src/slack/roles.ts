// Role -> Slack user-group / specific-user checks for gate approval buttons. No Slack
// API calls here: the caller injects `listMembers` (a thin wrapper around
// `usergroups.users.list`), which keeps this module testable without a live
// Slack connection and without depending on any Slack SDK.
//
// A role can be restricted by a Slack user group (paid-plan feature), by a fixed list of
// Slack user IDs (works on any plan), by both, or by neither (unrestricted — today's
// default). `userIds` is checked first and always wins, even if the group lookup below it
// would fail — see `canAct`.

type CanActResult = { ok: true } | { ok: false; groupId?: string; userIds?: string[]; error?: string };

interface CacheEntry {
  members: string[];
  expiresAt: number;
}

export class RoleChecker {
  private readonly roleGroups: Record<string, string>;
  private readonly roleUsers: Record<string, string[]>;
  private readonly listMembers: (groupId: string) => Promise<string[]>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(o: {
    roleGroups: Record<string, string>;
    roleUsers?: Record<string, string[]>;
    listMembers: (groupId: string) => Promise<string[]>;
    ttlMs?: number;
    now?: () => number;
  }) {
    this.roleGroups = o.roleGroups;
    this.roleUsers = o.roleUsers ?? {};
    this.listMembers = o.listMembers;
    this.ttlMs = o.ttlMs ?? 60_000;
    this.now = o.now ?? Date.now;
  }

  /**
   * A role with neither a mapped Slack user group nor a specific-people list is
   * unrestricted — anyone in the channel can act. Otherwise: a listed userId always wins
   * (checked before any group lookup, so a group-lookup failure never blocks a specifically
   * listed person); failing that, a mapped group requires membership (a lookup failure fails
   * closed, never open); failing that (or with no group mapped at all), the role is denied.
   */
  async canAct(role: string, userId: string): Promise<CanActResult> {
    const groupId = this.roleGroups[role];
    const userIds = this.roleUsers[role];
    const hasUsers = Boolean(userIds && userIds.length > 0);
    // Only attach `userIds` to a failure result when the role actually has one — keeps
    // `canAct`'s failure shape identical to before this feature existed for a role with just
    // a group, which `assert.deepEqual` (an exact own-key match) depends on.
    const usersField = hasUsers ? { userIds } : {};

    if (!groupId && !hasUsers) return { ok: true };
    if (hasUsers && userIds!.includes(userId)) return { ok: true };
    if (!groupId) return { ok: false, ...usersField };

    const nowMs = this.now();
    const cached = this.cache.get(groupId);
    let members: string[];

    if (cached && cached.expiresAt > nowMs) {
      members = cached.members;
    } else {
      try {
        members = await this.listMembers(groupId);
      } catch (err) {
        return { ok: false, groupId, ...usersField, error: (err as Error).message };
      }
      this.cache.set(groupId, { members, expiresAt: nowMs + this.ttlMs });
    }

    return members.includes(userId) ? { ok: true } : { ok: false, groupId, ...usersField };
  }

  /** Roles with neither a Slack user-group mapping nor a specific-people list — logged once at startup as a warning. */
  unrestrictedRoles(roles: string[]): string[] {
    return roles.filter((role) => !this.roleGroups[role] && !(this.roleUsers[role] && this.roleUsers[role].length > 0));
  }
}
