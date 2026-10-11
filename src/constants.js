export const STATUSES = {
  pending: { label: "In review", public: false, lane: null },
  open: { label: "Open", public: true, lane: null },
  planned: { label: "Planned", public: true, lane: "Planned" },
  building: { label: "Building", public: true, lane: "Building" },
  done: { label: "Shipped", public: true, lane: "Shipped" },
  declined: { label: "Not now", public: true, lane: null },
};

export const LANES = ["planned", "building", "done"];

export const NOTICES = {
  posted: "Your idea is on the board. Share the link if you want more votes.",
  review: "Thanks. New ideas are reviewed before they show up on the board.",
  saved: "Saved.",
  deleted: "Deleted.",
  password: "Password updated. You can use the board admin now.",
  released: "Changelog entry published.",
};

export const PAGE_SIZE = 20;

export const PRODUCT_NAME = "QuorDiscuss";
