/** point values and labels, shared by the server ledger and the client key. kept free of prisma so client bundles can import it */
export const POINTS = {
  TRADE_CLOSED: 10,
  TRADE_WIN: 15,
  THESIS_POSTED: 5,
  THESIS_PROFIT: 25,
  COPIED: 20,
  COPY_MADE: 5,
  INVITED: 50,
  INVITE_JOINED: 25,
} as const;
export type PointKind = keyof typeof POINTS;

export const POINT_LABELS: Record<PointKind, string> = {
  TRADE_CLOSED: "closed a trade",
  TRADE_WIN: "closed in profit",
  THESIS_POSTED: "posted a thesis",
  THESIS_PROFIT: "thesis settled in profit",
  COPIED: "someone copied your trade",
  COPY_MADE: "copied a trade",
  INVITED: "a friend you invited started trading",
  INVITE_JOINED: "joined with an invite",
};
