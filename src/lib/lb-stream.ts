/**
 * incremental extraction of the rows in hyperliquid's leaderboard feed: `{"leaderboardRows":[{...},{...}]}` is tens of
 * megabytes, and JSON.parse of the whole body needs several hundred MB of heap, which small workers do not have.
 * this walks the text chunk by chunk, hands each top-level row object to `onRow` as soon as it closes, and never holds
 * more than one row (plus the current chunk) in memory. strings are tracked so braces inside display names do not count.
 */
export function createRowExtractor(onRow: (row: unknown) => void, onBadRow?: (text: string, err: Error) => void) {
  let started = false;
  let done = false;
  let pre = "";
  let depth = 0;
  let inStr = false;
  let esc = false;
  let buf = "";
  let rows = 0;
  const scan = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (depth > 0) buf += ch;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") {
        if (depth === 0) buf = "{";
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            onRow(JSON.parse(buf));
            rows++;
          } catch (e) {
            onBadRow?.(buf.slice(0, 200), e as Error);
          }
          buf = "";
        }
      } else if (ch === "]" && depth === 0) {
        done = true;
        return;
      }
    }
  };
  return {
    push(chunk: string) {
      if (done) return;
      if (!started) {
        pre += chunk;
        const k = pre.indexOf('"leaderboardRows"');
        if (k < 0) {
          // keep only a tail so a key split across chunks is still found
          if (pre.length > 64) pre = pre.slice(-64);
          return;
        }
        const open = pre.indexOf("[", k);
        if (open < 0) return;
        started = true;
        const rest = pre.slice(open + 1);
        pre = "";
        scan(rest);
        return;
      }
      scan(chunk);
    },
    get started() {
      return started;
    },
    get done() {
      return done;
    },
    get rows() {
      return rows;
    },
  };
}
