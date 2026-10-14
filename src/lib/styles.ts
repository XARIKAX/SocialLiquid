/** trading-style tags a claimed profile can pick; shown as a pill next to the name */
export const STYLES = ["scalper", "day trader", "swing", "position", "macro", "degen", "quant", "systematic", "news", "meme"] as const;
export type Style = (typeof STYLES)[number];
