import type { ConsoleRole } from "./types";

export interface ProjectMember {
  userId: string; email: string; firstName: string | null; lastName: string | null; role: ConsoleRole; addedAt: string;
  /** False until a new account sets its password. */
  passwordSet: boolean;
}

/** GET api/members: this project's members, and the server admins (admins of every project). */
export interface MembersData {
  members: ProjectMember[];
  serverAdmins: { userId: string; email: string; firstName: string | null; lastName: string | null }[];
}
