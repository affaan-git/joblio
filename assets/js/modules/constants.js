export const API_BASE = "";
export const LEFT_WIDTH_KEY = "joblio-left-width";

export const STATUS = [
  { id: "wishlist", label: "Wishlist" },
  { id: "in_progress", label: "In progress" },
  { id: "applied", label: "Applied" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "closed", label: "Closed" },
];

export const MODES = ["Unknown", "On-site", "Hybrid", "Remote"];
export const STATUS_IDS = new Set(STATUS.map((s) => s.id));
export const SAFE_ID_RE = /^[a-zA-Z0-9_-]{6,100}$/;

export const LEFT_PANEL_DEFAULT = 372;
export const LEFT_PANEL_MIN = 300;
export const LEFT_PANEL_MAX = 620;
export const BACKEND_SAVE_ERROR_TOAST_COOLDOWN_MS = 15000;

export function createInitialState() {
  return {
    apps: [],
    activeId: null,
    mobileView: "list",
    scrollListToActive: false,
    pendingDescriptionFocusId: null,
    search: "",
    sortBy: "recent_update",
    statusFilter: "all",
    modeFilter: "all",
    theme: "dark",
    trashApps: [],
    trashFiles: [],
  };
}
