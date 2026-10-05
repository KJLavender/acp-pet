// Normalized events the pet understands. Every data source (fake timeline,
// real acpx runtime) is translated into this small vocabulary first, so
// PetBrain never touches ACP wire types directly.

/** Mirrors ACP's ToolKind. */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type TurnOutcome = "completed" | "cancelled" | "failed";

export type PetEvent =
  | { type: "turn_start"; prompt: string }
  | { type: "thought"; text: string }
  | { type: "message"; text: string }
  | { type: "plan"; entries: string[] }
  | {
      type: "tool";
      id: string;
      kind?: ToolKind;
      title: string;
      status?: ToolStatus;
      paths?: string[];
    }
  | { type: "turn_end"; outcome: TurnOutcome; error?: string };

export type PermissionDecision = "allow" | "reject";

export type PermissionAsk = {
  id: string;
  kind?: ToolKind;
  title: string;
  /** Short human summary shown on the sign (command line, file path, …). */
  detail?: string;
  /** Unix ms when the request auto-rejects. */
  deadline: number;
};

export type PetState =
  | "idle"
  | "bored"
  | "sleeping"
  | "thinking"
  | "reading"
  | "typing"
  | "hammering"
  | "peeking"
  | "tugging"
  | "happy"
  | "sick"
  | "sulking"
  | "levelup";

export type Needs = {
  energy: number;
  boredom: number;
  mood: number;
  xp: number;
  level: number;
  streak: number;
  tasksDone: number;
};

export type DiaryEntry = {
  at: string;
  prompt: string;
  outcome: TurnOutcome;
};

/** Everything the renderer needs to draw one frame of the pet. */
export type PetSnapshot = {
  state: PetState;
  line: string | null;
  needs: Needs;
  permission: PermissionAsk | null;
  busy: boolean;
  /** Relay (/flow) progress, e.g. step 2 of 3. */
  progress: { step: number; total: number } | null;
};
