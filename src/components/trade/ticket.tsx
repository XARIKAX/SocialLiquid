"use client";
import "./ticket.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { TICKET_PRICE_EVENT, useMyTheses } from "@/hooks/use-account";
import { useMids } from "@/hooks/use-market";
import { useSigner } from "@/hooks/use-signer";
import { api } from "@/lib/client";
import { fmtPx, fmtUsd } from "@/lib/format";
import type { MarketSummary } from "@/lib/hl-types";
import { setDexAbstractionWithWallet } from "@/lib/hl-client";
import { startChase, stopChase, useChases } from "@/lib/chase";
import { fmtQty, spotRows, usdcSpotAvail } from "@/lib/spot";
import { Icon, Switch } from "../ui";
import { STAGE_STEP, useOnboarding, type Stage } from "./onboarding";
import { openFunds } from "./funds";
import { openConvert } from "./convert";
import { TkIcon, TkNum } from "./tk-bits";

type OrderType = "market" | "limit" | "stopMarket" | "stopLimit" | "takeProfitMarket" | "takeProfitLimit" | "scale" | "twap" | "chase";
const PRO: [OrderType, string, string][] = [
  ["stopMarket", "Stop Market", "Market order once the stop trades"],
  ["stopLimit", "Stop Limit", "Limit order once the stop trades"],
  ["takeProfitMarket", "Take Profit Market", "Market order at your target"],
  ["takeProfitLimit", "Take Profit Limit", "Limit order at your target"],
  ["scale", "Scale", "A ladder of limits across a range"],
  ["twap", "TWAP", "Sliced into small orders over time"],
  ["chase", "Chase", "Follows the best price, maker only"],
];
/** what a spot pair takes from the pro menu: no triggers, no chase */
const SPOT_PRO: readonly OrderType[] = ["scale", "twap"];
const LABEL: Record<OrderType, string> = { market: "Market", limit: "Limit", stopMarket: "Stop Market", stopLimit: "Stop Limit", takeProfitMarket: "TP Market", takeProfitLimit: "TP Limit", scale: "Scale", twap: "TWAP", chase: "Chase" };
/** the quiet line at the end of the order types: what the chosen pro type does */
const TYPE_HINT: Partial<Record<OrderType, string>> = { twap: "slices every 30s", scale: "ladder of limits", chase: "follows the best price, maker only" };
const TIF_HINT = { Gtc: "Good till cancelled", Ioc: "Immediate or cancel", Alo: "Add liquidity only (post only)" } as const;
const QUICK = [10, 100, 500, 1000];
const TAKER = 0.00045;
const MAKER = 0.00015;
const BUILDER = 0.0005;
/** hyperliquid spot base tier */
const SPOT_TAKER = 0.0007;
const SPOT_MAKER = 0.0004;
const MAX_SLIP = 0.03;

type Book = { bids: { px: number; sz: number }[]; asks: { px: number; sz: number }[] };
type OrderResponse = { order: { status: "filled" | "resting" | "twap"; avgPx?: number; totalSz?: number; oid?: number; count?: number; twapId?: number }; thesis: { id: string } | null; copied?: boolean };

/** "$100", "$1,250", "$12.50": the cta speaks in round numbers */
function fmtCta(v: number) {
  if (v >= 100) return `$${Math.round(v).toLocaleString("en-US")}`;
  return `$${v.toFixed(2).replace(/\.00$/, "")}`;
}
const fmtQuick = (v: number) => (v >= 1000 ? `$${v / 1000}K` : `$${v}`);
/** a coin amount as it is, grouped, without float noise ("12.4", not "12.399999999999999") */
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 10 });
/** "9:41": what is left on a chase's clock */
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** the line under the cta while onboarding: what this step is, in a few words */
const STAGE_NOTE: Record<Stage, string> = {
  connect: "Non-custodial · funds stay on Hyperliquid",
  signin: "Free signature · no gas, no permissions",
  invite: "Invite only while we test with real money",
  handle: "Your name on the feed",
  enable: "Two signatures, once",
  ready: "",
};
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Ticket({ coin, market, mid }: { coin: string; market?: MarketSummary; mid?: number }) {
  const { address, signedIn } = useAuth();
  const ob = useOnboarding();
  const ready = ob.stage === "ready";
  const qc = useQueryClient();
  const isSpot = market?.kind === "spot";
  const dex = market?.dex ?? "";
  const dexName = market?.dexName ?? dex;
  const { wallet: walletClient } = useSigner();
  const walletChainId = useChainId();
  const [dexBusy, setDexBusy] = useState(false);
  /** builder dex: the main account, whose USDC unified margin puts to work here */
  const mainBal = useBalance(signedIn && dex ? address : null);
  /** perps numbers for this market's dex ("" = main), spot balances alongside */
  const bal = useBalance(signedIn ? address : null, dex);
  const mids = useMids();
  const maxLev = isSpot ? 1 : (market?.maxLeverage ?? 50);
  /** what people read: "BTC", "SOL/USDC", "GOLD". never the api id ("@107", "xyz:GOLD") */
  const label = market?.name ?? coin;
  /** the unit a size is counted in: "BTC", "SOL", "GOLD" */
  const base = market?.base ?? coin;
  // spot: buys spend spot USDC, sells spend the token
  const spotUsdc = bal.data?.spot?.find((b) => b.coin === "USDC");
  const spotTok = market?.token ? bal.data?.spot?.find((b) => b.coin === market.token) : undefined;
  const szDec = market?.szDecimals ?? 4;
  /* ids for the label / field pairs. a page has one ticket per market, so the market's id keeps them unique; and
     unlike useId they do not hang on where the ticket sits in the tree, so the server html and the client always
     agree on them (a useId here was split by tree differences above the ticket and failed hydration) */
  const uid = `tm-tk-${coin.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [type, setType] = useState<OrderType>("market");
  const [proOpen, setProOpen] = useState(false);
  const [isCross, setIsCross] = useState(true);
  const [lev, setLev] = useState(10);
  const [levOpen, setLevOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [trigger, setTrigger] = useState("");
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState<"coin" | "usd">("usd");
  const [pct, setPct] = useState(0);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tif, setTif] = useState<"Gtc" | "Ioc" | "Alo">("Gtc");
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [scale, setScale] = useState({ start: "", end: "", count: "5", skew: "1" });
  const [twap, setTwap] = useState({ minutes: "30", randomize: true });
  const [chaseMin, setChaseMin] = useState("10");
  const [thesis, setThesis] = useState("");
  /** the thesis composer is on by default; switching it off hides the card and posts nothing */
  const [postThesis, setPostThesis] = useState(true);
  /** a thesis being posted on the open position (without an order) */
  const [thesisBusy, setThesisBusy] = useState(false);
  const [showStep, setShowStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** bumps when a price lands from the book, so the price field lights once */
  const [pxFlash, setPxFlash] = useState(0);
  /** bumps when the cta is pressed without a size: the size field lights and takes focus */
  const [sizeNudge, setSizeNudge] = useState(0);
  /** the cta dock is pinned to the bottom of the column (the ticket runs past the fold) */
  const [stuck, setStuck] = useState(false);
  /** copy trade: set from /m/[coin]?copy=<positionId>&from=<address>&side=&lev=&name= */
  const [copyOf, setCopyOf] = useState<{ positionId: string; address: string; name: string; side: "LONG" | "SHORT"; lev: number } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("copy");
    const from = q.get("from");
    if (!id || !from) return;
    const sd = q.get("side") === "SHORT" ? "SHORT" : "LONG";
    const lv = Math.max(1, Math.min(maxLev, Number(q.get("lev")) || 10));
    setCopyOf({ positionId: id, address: from, name: q.get("name") ?? from.slice(0, 6), side: sd, lev: lv });
    setSide(sd);
    setLev(lv);
    setType("market");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);
  // once trading is enabled, push the copied leverage to the exchange
  useEffect(() => {
    if (!copyOf || !ready) return;
    api("/api/trade/leverage", { method: "POST", json: { coin, leverage: copyOf.lev, isCross: true } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyOf?.positionId, ready]);
  const clearCopy = () => {
    setCopyOf(null);
    const u = new URL(window.location.href);
    ["copy", "from", "side", "lev", "name"].forEach((k) => u.searchParams.delete(k));
    window.history.replaceState(null, "", u.pathname + (u.search || ""));
  };
  const proRef = useRef<HTMLDivElement>(null);
  const levRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<HTMLInputElement>(null);
  const thesisRef = useRef<HTMLTextAreaElement>(null);
  const sideRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const levSliderRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const specRef = useRef<HTMLSpanElement>(null);
  const dockEndRef = useRef<HTMLSpanElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  /* the dock. two observers, no scroll listener, nothing per frame:
     - engaged: the ticket's top edge has risen into the upper part of the viewport, i.e. the trader is in
       the ticket. only then is the dock sticky, so on phones and tablets (where the ticket scrolls in from
       below) it never rides over the margin row, the order types or long/short while they come into view.
       (written straight to the dock as data-engaged: it changes a css position, nothing react renders)
     - stuck: a zero-height sentinel sits under the dock's natural place, drawn one sticky inset lower (css),
       so it crosses the edge of the scroll area at the exact moment the dock pins or lets go. */
  useEffect(() => {
    const top = specRef.current;
    const dock = dockRef.current;
    const end = dockEndRef.current;
    if (!top || !dock || !end || typeof IntersectionObserver === "undefined") return;
    let engaged = false;
    const measure = () => {
      const inset = parseFloat(getComputedStyle(end).top) || 0;
      setStuck(engaged && end.getBoundingClientRect().top - inset - dock.getBoundingClientRect().bottom > 1);
    };
    const engage = new IntersectionObserver(
      ([e]) => {
        const on = !!e.rootBounds && e.boundingClientRect.top <= e.rootBounds.bottom;
        if (on === engaged) return;
        engaged = on;
        dock.toggleAttribute("data-engaged", on);
        measure();
      },
      { rootMargin: "0px 0px -55% 0px" },
    );
    const pin = new IntersectionObserver(measure);
    engage.observe(top);
    pin.observe(end);
    return () => {
      engage.disconnect();
      pin.disconnect();
    };
  }, []);
  // an opened menu takes focus on its checked (or first) item; the leverage dialog on its slider
  useEffect(() => {
    if (!proOpen) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
    (menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked=true]") ?? items?.[0])?.focus({ preventScroll: true });
  }, [proOpen]);
  useEffect(() => {
    if (levOpen) levSliderRef.current?.focus({ preventScroll: true });
  }, [levOpen]);

  // an opened onboarding step is brought into view (it opens under the cta, often past the fold)
  useEffect(() => {
    if (!showStep) return;
    const id = requestAnimationFrame(() => stepRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(id);
  }, [showStep]);
  // a success note bows out on its own (its timer is a css animation, so hover pauses it); errors stay until dismissed
  useEffect(() => {
    if (!msg?.ok || !reducedMotion()) return;
    const t = window.setTimeout(() => setMsg((m) => (m === msg ? null : m)), 9000);
    return () => window.clearTimeout(t);
  }, [msg]);

  useEffect(() => setLev((l) => Math.min(l, maxLev)), [maxLev]);
  // a spot pair takes market, limit, scale and twap orders and no tp / sl: a pro type or tp / sl carried over from a perp is let go
  // (the ticket remounts per market today, so this only guards a ticket that ever outlives its market)
  useEffect(() => {
    if (!isSpot) return;
    setType((t) => (t === "market" || t === "limit" || SPOT_PRO.includes(t) ? t : "market"));
    setTpsl(false);
  }, [isSpot]);
  useEffect(() => {
    setMsg(null);
    setPrice("");
    setTrigger("");
    setSize("");
    setPct(0);
  }, [coin]);
  useEffect(() => {
    const h = (e: Event) => {
      const px = (e as CustomEvent<number>).detail;
      setPrice(String(Number(px.toPrecision(7))));
      setType((t) => (t === "market" ? "limit" : t));
      setPxFlash((n) => n + 1);
    };
    window.addEventListener(TICKET_PRICE_EVENT, h);
    return () => window.removeEventListener(TICKET_PRICE_EVENT, h);
  }, []);
  // popovers close on an outside press or Escape
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!proRef.current?.contains(e.target as Node)) setProOpen(false);
      if (!levRef.current?.contains(e.target as Node)) setLevOpen(false);
    };
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // focus goes back to the trigger it came from
      const a = document.activeElement;
      if (proRef.current?.contains(a)) proRef.current.querySelector<HTMLButtonElement>("button")?.focus();
      if (levRef.current?.contains(a)) levRef.current.querySelector<HTMLButtonElement>(".tm-tk-lev")?.focus();
      setProOpen(false);
      setLevOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, []);

  const isLimit = type === "limit" || type === "stopLimit" || type === "takeProfitLimit";
  const isTrig = type.startsWith("stop") || type.startsWith("takeProfit");
  const isMarketish = type === "market" || type.endsWith("Market");
  const refPx = isLimit && Number(price) ? Number(price) : type === "scale" && Number(scale.start) && Number(scale.end) ? (Number(scale.start) + Number(scale.end)) / 2 : (mid ?? market?.markPx ?? 0);
  const myPos = bal.data?.positions.find((p) => p.coin === coin && p.szi !== 0);
  const upnlAll = bal.data?.positions.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
  const avail = isSpot ? (side === "LONG" ? Math.max(0, (spotUsdc?.total ?? 0) - (spotUsdc?.hold ?? 0)) : Math.max(0, (spotTok?.total ?? 0) - (spotTok?.hold ?? 0))) : (bal.data?.withdrawable ?? 0);
  const maxCoin = isSpot ? (side === "LONG" ? (refPx ? avail / refPx : 0) : avail) : reduceOnly ? Math.abs(myPos?.szi ?? 0) : refPx ? (avail * lev) / refPx : 0;
  const sizeCoin = unit === "coin" ? Number(size) || 0 : refPx ? (Number(size) || 0) / refPx : 0;
  const sizeUsd = sizeCoin * refPx;
  const margin = lev ? sizeUsd / lev : 0;
  const dir = side === "LONG" ? 1 : -1;
  const mm = 1 / (2 * maxLev);
  const liq = refPx && lev ? refPx - dir * (refPx * (1 / lev - mm)) / (1 - mm * dir) : null;
  const book = qc.getQueryData<Book>(["book", coin]);
  const slip = useMemo(() => {
    if (!book || !sizeCoin || !(type === "market" || type.endsWith("Market")) || !mid) return 0;
    const levels = side === "LONG" ? book.asks : book.bids;
    let left = sizeCoin;
    let cost = 0;
    for (const l of levels) {
      const take = Math.min(left, l.sz);
      cost += take * l.px;
      left -= take;
      if (left <= 0) break;
    }
    if (left > 0) return MAX_SLIP;
    return Math.abs(cost / sizeCoin - mid) / mid;
  }, [book, sizeCoin, type, side, mid]);
  /* the fee estimate (display only): taker for anything that takes liquidity (market, triggered market,
     twap slices, an ioc limit), maker for orders that rest (a chase is post-only). spot pays spot rates */
  const takes = type === "market" || type.endsWith("Market") || type === "twap" || (isLimit && tif === "Ioc");
  const baseFee = takes ? (isSpot ? SPOT_TAKER : TAKER) : isSpot ? SPOT_MAKER : MAKER;
  const feeRate = baseFee + BUILDER;
  const feeDigits = isSpot ? 2 : 3;
  const tpGain = Number(tp) && refPx ? ((Number(tp) - refPx) / refPx) * dir * lev : null;
  const slLoss = Number(sl) && refPx ? ((Number(sl) - refPx) / refPx) * dir * lev : null;
  /** the price a chase would sit at right now: the best bid for a buy, the best ask for a sell (from a fresh book) */
  const bookAt = qc.getQueryState(["book", coin])?.dataUpdatedAt ?? 0;
  const chaseAt = type === "chase" && book && Date.now() - bookAt < 6000 ? (side === "LONG" ? book.bids[0]?.px : book.asks[0]?.px) : undefined;
  // a thesis can go on a position that is already open, not only with the order that opens one
  const theses = useMyTheses(signedIn && !!myPos && postThesis);
  const liveThesis = myPos ? ((theses.data ?? []).find((t) => t.coin === coin) ?? null) : null;
  const spotAll = spotRows(bal.data?.spot, mids.data);
  const spotHeld = spotAll.filter((r) => r.name !== "USDC");
  const spotUsdcFree = usdcSpotAvail(bal.data?.spot);

  const setPctAndSize = (p: number) => {
    setPct(p);
    const c = (maxCoin * p) / 100;
    setSize(unit === "coin" ? String(Number(c.toFixed(szDec))) : String(Math.floor(c * refPx)));
  };
  const onSize = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setSize(clean);
    const c = unit === "coin" ? Number(clean) || 0 : refPx ? (Number(clean) || 0) / refPx : 0;
    setPct(maxCoin ? Math.min(100, Math.round((c / maxCoin) * 100)) : 0);
  };
  const switchUnit = (u: "coin" | "usd") => {
    if (u === unit) return;
    if (sizeCoin) setSize(u === "coin" ? String(Number(sizeCoin.toFixed(szDec))) : String(Math.floor(sizeUsd)));
    setUnit(u);
  };
  /** a quick size is the same as typing it in dollars */
  const pickUsd = (v: number) => {
    setUnit("usd");
    setSize(String(v));
    const c = refPx ? v / refPx : 0;
    setPct(maxCoin ? Math.min(100, Math.round((c / maxCoin) * 100)) : 0);
  };

  const invalid = ready && (() => {
    if (!sizeCoin) return "Enter a size";
    if (sizeUsd < 10 && !reduceOnly) return "Minimum order value is $10";
    if (isLimit && !Number(price)) return "Enter a limit price";
    if (isTrig && !Number(trigger)) return "Enter a trigger price";
    if (type === "scale" && (!Number(scale.start) || !Number(scale.end) || Number(scale.count) < 2)) return "Enter the scale range";
    if (type === "twap" && Number(twap.minutes) < 5) return "TWAP runs for at least 5 minutes";
    if (type === "chase" && !(Number(chaseMin) >= 1)) return "Chase needs a time limit of at least 1 minute";
    if (isSpot && side === "LONG" && sizeUsd > avail * 1.0001) return `Costs ${fmtUsd(sizeUsd)}, you have ${fmtUsd(avail)} USDC in spot`;
    if (isSpot && side === "SHORT" && sizeCoin > avail + 1e-9) return `You have ${avail} ${market?.base ?? coin} in spot`;
    if (!isSpot && !reduceOnly && margin > avail && avail > 0) return `Margin ${fmtUsd(margin)} exceeds available ${fmtUsd(avail)}`;
    return null;
  })();

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (type === "chase") {
        const c = startChase({ coin, label: market?.name ?? coin, side, sz: Number(sizeCoin.toFixed(szDec)), szDecimals: szDec, leverage: isSpot ? 1 : lev, reduceOnly, maxMinutes: Number(chaseMin) });
        setMsg({ ok: true, text: `Chasing ${c.sz} ${market?.base ?? coin} at the best ${side === "LONG" ? "bid" : "ask"} for up to ${chaseMin} min. Watch it in the Chase tab.` });
        setSize("");
        setPct(0);
        return;
      }
      const r = await api<OrderResponse>("/api/trade/order", {
        method: "POST",
        json: {
          coin,
          side,
          type,
          sz: Number(sizeCoin.toFixed(szDec)),
          leverage: isSpot ? 1 : lev,
          isCross: isSpot ? true : isCross,
          limitPx: isLimit ? Number(price) : undefined,
          triggerPx: isTrig ? Number(trigger) : undefined,
          tif: isLimit ? tif : undefined,
          reduceOnly,
          tp: tpsl && Number(tp) ? Number(tp) : undefined,
          sl: tpsl && Number(sl) ? Number(sl) : undefined,
          scale: type === "scale" ? { startPx: Number(scale.start), endPx: Number(scale.end), count: Number(scale.count), skew: Number(scale.skew) || 1 } : undefined,
          twap: type === "twap" ? { minutes: Number(twap.minutes), randomize: twap.randomize } : undefined,
          thesis: postThesis ? thesis.trim() || undefined : undefined,
          copyOf: copyOf ? { positionId: copyOf.positionId, address: copyOf.address } : undefined,
        },
      });
      const o = r.order;
      // one message per outcome (a fill used to fall through to the "resting" line and read "Order #undefined resting")
      if (o.status === "filled") {
        setMsg({ ok: true, text: `Filled ${o.totalSz} ${base} at ${fmtPx(o.avgPx)}${copyOf ? ` · copied ${copyOf.name}` : ""}${r.thesis ? " · thesis posted" : ""}` });
        if (copyOf) clearCopy();
      } else if (o.status === "twap") setMsg({ ok: true, text: `TWAP #${o.twapId} running for ${twap.minutes} min` });
      else setMsg({ ok: true, text: o.count ? `${o.count} orders resting` : `Order #${o.oid} resting${r.thesis ? " · thesis posted" : ""}` });
      setThesis("");
      setSize("");
      setPct(0);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market", coin] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const applyLeverage = async (l: number, cross: boolean) => {
    setLev(l);
    setIsCross(cross);
    setLevOpen(false);
    if (ready) await api("/api/trade/leverage", { method: "POST", json: { coin, leverage: l, isCross: cross } }).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  };

  /** builder dex without margin: hyperliquid's unified margin (userDexAbstraction), one main-wallet signature */
  const enableDexMargin = async () => {
    if (!walletClient || !address) return;
    setDexBusy(true);
    try {
      await setDexAbstractionWithWallet(walletClient, walletChainId, address, true);
      qc.invalidateQueries({ queryKey: ["balance"] });
      setMsg({ ok: true, text: "Unified margin on: your main USDC now backs builder-dex trades." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.slice(0, 200) });
    } finally {
      setDexBusy(false);
    }
  };

  /** the thesis on the position that is already open: bound to it like one posted with the order (POST /api/thesis) */
  const postOnPosition = async () => {
    const text = thesis.trim();
    if (!text) return;
    setThesisBusy(true);
    setMsg(null);
    try {
      await api("/api/thesis", { method: "POST", json: { coin, text } });
      qc.invalidateQueries({ queryKey: ["my-theses"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["market"] });
      setThesis("");
      setMsg({ ok: true, text: `Thesis posted on your open ${label} position` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setThesisBusy(false);
    }
  };

  /** armed but no size yet: the cta rests (no halo) and a press shows where the size goes instead of doing nothing */
  const needSize = ready && !sizeCoin;
  const onCta = () => {
    if (needSize) {
      sizeRef.current?.focus();
      setSizeNudge((n) => n + 1);
      return;
    }
    if (ready) return submit();
    if (ob.act) return ob.act();
    setShowStep((v) => !v);
  };
  /** popovers close when focus moves on to something outside them (a tab past the last control) */
  const closeOnLeave = (close: () => void) => (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to && !e.currentTarget.contains(to)) close();
  };

  /* the pro menu moves with arrows, Home and End */
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };

  /* long / short is a radio group: arrows move the choice, like any segmented control */
  const onSideKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = side === "LONG" ? "SHORT" : "LONG";
    setSide(next);
    sideRefs.current[next === "LONG" ? 0 : 1]?.focus();
  };

  /** spot buys and sells; perps go long or short */
  const sideWord = (s: "LONG" | "SHORT") => (s === "LONG" ? (isSpot ? "Buy" : "Long") : isSpot ? "Sell" : "Short");
  const proTypes = PRO.filter(([t]) => !isSpot || SPOT_PRO.includes(t));
  const tone = !ready ? "brand" : side === "LONG" ? "long" : "short";
  const step = STAGE_STEP[ob.stage];
  const ctaDisabled = busy || ob.busy || (!!invalid && !needSize);
  /** an onboarding step is open under the cta: its own button is the call to action, the cta folds into a quiet header */
  const stepOpen = !ready && showStep && !!ob.Panel;
  /* the halo means "this will do something now": armed with a size, or the next onboarding move */
  const ctaGlow = !ctaDisabled && !needSize && !stepOpen;
  const ctaCls = stepOpen ? "tm-tk-cta-quiet" : ready ? (side === "LONG" ? "btn-up" : "btn-down") : "btn-primary";
  const invalidIsMargin = typeof invalid === "string" && invalid.startsWith("Margin ");
  /** builder dex with no USDC of its own and unified margin off: the card above the sides offers to turn it on */
  const needsDexMargin = !!dex && ready && !!bal.data && bal.data.withdrawable <= 0 && bal.data.dexAbstraction !== true;
  /** an armed ticket with too little to trade with says so under the cta, with the fix when there is one */
  const lowNote: { kind: "deposit" | "enable" | "info"; text: string } | null = (() => {
    if (!ready || !bal.data || reduceOnly) return null;
    if (isSpot) {
      if (side === "LONG") return avail < 10 ? { kind: "info", text: avail < 0.01 ? "No USDC in spot yet" : `${fmtUsd(avail)} USDC in spot` } : null;
      return avail <= 0 ? { kind: "info", text: `No ${base} in spot to sell` } : null;
    }
    if (needsDexMargin) return { kind: "enable", text: `No USDC on ${dexName} yet` };
    // with unified margin on, a builder dex trades on the main account's USDC
    const backing = dex && bal.data.dexAbstraction === true ? Math.max(avail, mainBal.data?.withdrawable ?? 0) : avail;
    return backing < 10 ? { kind: "deposit", text: backing < 0.01 ? "No USDC on Hyperliquid yet" : `${fmtUsd(backing)} available to trade` } : null;
  })();
  const maxUsd = maxCoin * refPx;
  const levTicks = [1, Math.round(maxLev / 4), Math.round(maxLev / 2), Math.round((3 * maxLev) / 4), maxLev].filter((v, i, a) => a.indexOf(v) === i);
  const levAt = (v: number) => (v - 1) / Math.max(1, maxLev - 1);
  /** margin beyond the balance: the summary row and the deposit button say where the fix is */
  const overMargin = ready && !isSpot && !reduceOnly && sizeCoin > 0 && margin > avail && avail > 0;
  /** spot: more than the spot balance holds (USDC for a buy, the coin for a sell) */
  const overSpot = ready && isSpot && sizeCoin > 0 && (side === "LONG" ? sizeUsd > avail * 1.0001 : sizeCoin > avail + 1e-9);
  const nudgeDeposit = lowNote?.kind === "deposit" || overMargin;
  const sizeSub =
    sizeCoin > 0
      ? unit === "usd"
        ? `≈ ${sizeCoin.toFixed(Math.min(szDec, 6))} ${base}`
        : `≈ ${fmtUsd(sizeUsd)}`
      : reduceOnly
        ? "Reduces your position only"
        : "Min order $10";
  const pctOf = isSpot ? (side === "LONG" ? "your spot USDC" : `your ${base}`) : reduceOnly ? "your position" : "buying power";
  const thesisLevel = thesis.length >= 280 ? "full" : thesis.length >= 240 ? "warn" : undefined;
  const acctTitle = dex ? `${dexName} Account` : "Account Summary";

  return (
    <section className="card tm-tk" data-tone={tone} aria-label={`Order ticket, ${label}`}>
      <span ref={specRef} className="tm-tk-spec" aria-hidden />

      {/* margin mode + leverage (perps). a spot pair has neither: it says how it trades instead */}
      {isSpot ? (
        <div className="tm-tk-top tm-tk-spot">
          <span className="tm-tk-kind">Spot</span>
          <span className="tm-tk-spot-copy">Buy with spot USDC, sell for USDC. No leverage, no liquidation.</span>
        </div>
      ) : (
        <div className="tm-tk-top">
          <div className="seg tm-tk-mode" aria-label="Margin mode">
            <button type="button" aria-pressed={isCross} className={`seg-item ${isCross ? "seg-active" : ""}`} onClick={() => applyLeverage(lev, true)}>
              Cross
            </button>
            <button type="button" aria-pressed={!isCross} className={`seg-item ${!isCross ? "seg-active" : ""}`} onClick={() => applyLeverage(lev, false)}>
              Isolated
            </button>
          </div>
          <div ref={levRef} className="tm-tk-anchor" onBlur={closeOnLeave(() => setLevOpen(false))}>
            <button type="button" className="tm-tk-lev" onClick={() => setLevOpen((v) => !v)} aria-expanded={levOpen} aria-haspopup="dialog" aria-label={`Leverage ${lev}x. Adjust`}>
              <span className="tm-tk-lev-k" aria-hidden>
                LEV
              </span>
              <span className="tm-tk-lev-v">{lev}x</span>
              <TkIcon.chev size={13} sw={2} />
            </button>
            {levOpen && (
              <div className="pop tm-tk-pop tm-tk-levpop" role="dialog" aria-label="Adjust leverage">
                <div className="tm-tk-pop-head">
                  <span className="tm-tk-pop-title">Adjust leverage</span>
                  <span className="tm-tk-stepper">
                    <button type="button" onClick={() => setLev((l) => Math.max(1, l - 1))} disabled={lev <= 1} aria-label="Decrease leverage">
                      <TkIcon.minus size={13} sw={2} />
                    </button>
                    <b>{lev}x</b>
                    <button type="button" onClick={() => setLev((l) => Math.min(maxLev, l + 1))} disabled={lev >= maxLev} aria-label="Increase leverage">
                      <TkIcon.plus size={13} sw={2} />
                    </button>
                  </span>
                </div>
                <input ref={levSliderRef} type="range" min={1} max={maxLev} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="slider mt-5" style={{ ["--pct" as string]: `${levAt(lev) * 100}%` }} aria-label="leverage" />
                <div className="tm-tk-ticks mt-2">
                  {levTicks.map((v) => (
                    <button key={v} type="button" onClick={() => setLev(v)} style={{ "--at": levAt(v) } as CSSProperties} data-on={lev === v} data-past={v > 1 && lev > v}>
                      {v}x
                    </button>
                  ))}
                </div>
                <p className="tm-tk-pop-copy">
                  Max <b>{maxLev}x</b> on {label}. Higher leverage lowers the margin required and moves the liquidation price closer.
                </p>
                <button type="button" className="btn btn-primary w-full h-9 mt-3" onClick={() => applyLeverage(lev, isCross)}>
                  Confirm {lev}x
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* order type */}
      <div className="tm-tk-types">
        {(["market", "limit"] as OrderType[]).map((t) => (
          <button key={t} type="button" className="tm-tk-type" data-on={type === t} aria-pressed={type === t} onClick={() => setType(t)}>
            {LABEL[t]}
          </button>
        ))}
        <div ref={proRef} className="tm-tk-anchor flex" onBlur={closeOnLeave(() => setProOpen(false))}>
          <button type="button" className="tm-tk-type" data-on={!["market", "limit"].includes(type)} aria-haspopup="menu" aria-expanded={proOpen} onClick={() => setProOpen((v) => !v)}>
            {["market", "limit"].includes(type) ? "Pro" : LABEL[type]} <TkIcon.chev size={12} sw={2} />
          </button>
          {proOpen && (
            <div ref={menuRef} className="pop tm-tk-pop tm-tk-menu" role="menu" aria-label="Pro order types" onKeyDown={onMenuKey}>
              {proTypes.map(([t, l, hint]) => (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={type === t}
                  className="tm-tk-menu-item"
                  onClick={() => {
                    setType(t);
                    setProOpen(false);
                    proRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                  }}
                >
                  <span>
                    <b>{l}</b>
                    <small>{hint}</small>
                  </span>
                  <TkIcon.check size={14} sw={2.2} />
                </button>
              ))}
            </div>
          )}
        </div>
        {TYPE_HINT[type] && <span className="tm-tk-types-hint">{TYPE_HINT[type]}</span>}
      </div>

      {copyOf && (
        <div className="tm-tk-copy">
          <span className="tm-tk-copy-ico">
            <Icon.copy />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-fg-2">
              Copying <b className="text-fg font-semibold">{copyOf.name}</b>
            </span>
            <span className="block text-[11px] text-muted mt-0.5">
              {label} <span className={copyOf.side === "LONG" ? "tm-tk-up" : "tm-tk-down"}>{copyOf.side === "LONG" ? "Long" : "Short"}</span> <span className="num">{copyOf.lev}x</span> · pick your size
            </span>
          </span>
          <button type="button" className="tm-tk-copy-x" onClick={clearCopy} aria-label="Stop copying">
            <TkIcon.close size={13} />
          </button>
        </div>
      )}

      {/* chases running on this market, alive until filled, stopped or out of time */}
      <ChaseLive coin={coin} base={base} />

      {/* builder dex with no margin of its own: hyperliquid's unified margin, one main-wallet signature */}
      {needsDexMargin && (
        <div className="tm-tk-box tm-tk-dex" data-testid="dex-margin">
          <p className="tm-tk-dex-head">
            <TkIcon.bolt size={14} sw={2} />
            <b>No USDC on {dexName} yet.</b>
          </p>
          <p>
            Hyperliquid keeps builder-dex margin separate unless unified margin is on. Turn it on once and your main account USDC{mainBal.data ? ` (${fmtUsd(mainBal.data.withdrawable)})` : ""} backs trades here and on every other builder dex.
          </p>
          <button type="button" className="btn btn-primary tm-tk-dex-go" disabled={dexBusy || !walletClient} onClick={enableDexMargin} aria-busy={dexBusy}>
            {dexBusy ? (
              <>
                <TkIcon.spin size={14} className="tm-tk-spin" />
                Confirm in your wallet…
              </>
            ) : (
              "Enable unified margin"
            )}
          </button>
        </div>
      )}

      {/* side */}
      <div className="tm-tk-side" role="radiogroup" aria-label="Side" data-side={side} onKeyDown={onSideKey}>
        <span className="tm-tk-side-thumb" aria-hidden />
        {(["LONG", "SHORT"] as const).map((s, i) => (
          <button
            key={s}
            ref={(el) => {
              sideRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={side === s}
            tabIndex={side === s ? 0 : -1}
            data-v={s}
            className="tm-tk-side-btn"
            onClick={() => setSide(s)}
          >
            {sideWord(s)}
          </button>
        ))}
      </div>

      <dl className="tm-tk-info">
        <div>
          <dt>{isSpot ? (side === "LONG" ? "Available USDC · spot" : `Available ${base} · spot`) : "Available to trade"}</dt>
          <dd>
            {!signedIn ? (
              "–"
            ) : isSpot && side === "SHORT" ? (
              <>
                {qty(avail)}
                <small>{base}</small>
              </>
            ) : (
              <>
                {fmtUsd(avail).replace("$", "")}
                <small>USDC</small>
              </>
            )}
          </dd>
        </div>
        {!isSpot && spotUsdcFree > 0.01 && (
          <div>
            <dt>In spot</dt>
            <dd>
              {fmtUsd(spotUsdcFree).replace("$", "")}
              <small>USDC</small>
              {bal.data?.unified ? (
                <small className="tm-tk-info-tag">unified, already margin</small>
              ) : (
                <button type="button" className="tm-tk-note-act tm-tk-info-act" onClick={() => openConvert("USDC")} data-testid="ticket-move-usdc">
                  Move to perps
                </button>
              )}
            </dd>
          </div>
        )}
        {isSpot ? (
          <div>
            <dt>You hold</dt>
            <dd>
              {qty(spotTok ? spotTok.total : 0)}
              <small>{base}</small>
            </dd>
          </div>
        ) : (
          <div>
            <dt>Current position</dt>
            <dd>
              {myPos ? (
                <span className={myPos.szi > 0 ? "tm-tk-up" : "tm-tk-down"}>
                  {myPos.szi > 0 ? "Long" : "Short"} {Math.abs(myPos.szi)}
                  <small>{label}</small>
                </span>
              ) : (
                <>
                  0.00<small>{label}</small>
                </>
              )}
            </dd>
          </div>
        )}
      </dl>

      {/* prices */}
      {isTrig && (
        <label className="tm-tk-row">
          <span className="tm-tk-row-label">{type.startsWith("stop") ? "Stop price" : "TP price"}</span>
          <TkNum className="tm-tk-input" inputMode="decimal" value={trigger} onValue={(v) => setTrigger(v.replace(/[^0-9.]/g, ""))} placeholder={mid ? fmtPx(mid) : ""} autoComplete="off" />
          <button type="button" className="tm-tk-act" onClick={() => mid && setTrigger(String(Number(mid.toPrecision(7))))} disabled={!mid}>
            Mark
          </button>
        </label>
      )}
      {isLimit && (
        <label className="tm-tk-row">
          <span className="tm-tk-row-label">Limit price</span>
          <TkNum className="tm-tk-input" inputMode="decimal" value={price} onValue={(v) => setPrice(v.replace(/[^0-9.]/g, ""))} placeholder={mid ? fmtPx(mid) : ""} autoComplete="off" />
          <button type="button" className="tm-tk-act" onClick={() => mid && setPrice(String(Number(mid.toPrecision(7))))} disabled={!mid}>
            Mid
          </button>
          {pxFlash > 0 && <span key={pxFlash} className="tm-tk-flash" aria-hidden />}
        </label>
      )}
      {type === "scale" && (
        <div className="tm-tk-grid2">
          <MiniField label="Start · USDC">
            <TkNum className="tm-tk-input" inputMode="decimal" value={scale.start} onValue={(v) => setScale({ ...scale, start: v })} placeholder={mid ? fmtPx(mid * (side === "LONG" ? 0.99 : 1.01)) : ""} autoComplete="off" />
          </MiniField>
          <MiniField label="End · USDC">
            <TkNum className="tm-tk-input" inputMode="decimal" value={scale.end} onValue={(v) => setScale({ ...scale, end: v })} placeholder={mid ? fmtPx(mid * (side === "LONG" ? 0.95 : 1.05)) : ""} autoComplete="off" />
          </MiniField>
          <MiniField label="Orders">
            <input className="tm-tk-input" inputMode="numeric" value={scale.count} onChange={(e) => setScale({ ...scale, count: e.target.value })} autoComplete="off" />
          </MiniField>
          <MiniField label="Size skew">
            <input className="tm-tk-input" inputMode="decimal" value={scale.skew} onChange={(e) => setScale({ ...scale, skew: e.target.value })} autoComplete="off" />
          </MiniField>
        </div>
      )}
      {type === "chase" && (
        <>
          <div className="tm-tk-grid2">
            <MiniField label="Time limit" hint={<span className="tm-tk-hint-k">MIN</span>}>
              <input className="tm-tk-input" inputMode="numeric" value={chaseMin} onChange={(e) => setChaseMin(e.target.value.replace(/[^0-9]/g, ""))} aria-label="chase minutes" autoComplete="off" />
            </MiniField>
            <div className="tm-tk-mini tm-tk-mini-read" data-tone={side === "LONG" ? "up" : "down"}>
              <span className="tm-tk-mini-label">Best {side === "LONG" ? "bid" : "ask"}</span>
              <span className="tm-tk-mini-body">
                {chaseAt ? (
                  <>
                    <span className="tm-tk-mini-val tm-tk-mini-px">{fmtPx(chaseAt)}</span>
                    <i className="tm-tk-live" aria-hidden />
                  </>
                ) : (
                  <span className="tm-tk-mini-val tm-tk-mini-quiet">Maker only</span>
                )}
              </span>
            </div>
          </div>
          <p className="tm-tk-chase-copy">Post-only at the best {side === "LONG" ? "bid" : "ask"}, re-priced every few seconds until filled.</p>
        </>
      )}
      {type === "twap" && (
        <div className="tm-tk-grid2">
          <MiniField label="Running time" hint={<span className="tm-tk-hint-k">MIN</span>}>
            <input className="tm-tk-input" inputMode="numeric" value={twap.minutes} onChange={(e) => setTwap({ ...twap, minutes: e.target.value })} autoComplete="off" />
          </MiniField>
          <label className="tm-tk-mini tm-tk-mini-switch">
            <span className="tm-tk-mini-label">Randomize</span>
            <span className="tm-tk-mini-body">
              <span className="tm-tk-mini-val" aria-hidden>
                {twap.randomize ? "On" : "Off"}
              </span>
              <Switch on={twap.randomize} onChange={(v) => setTwap({ ...twap, randomize: v })} />
            </span>
          </label>
        </div>
      )}

      {/* size */}
      <div className="tm-tk-size" onClick={() => sizeRef.current?.focus()}>
        <div className="tm-tk-size-head">
          <label htmlFor={`${uid}-size`} className="tm-tk-size-label">
            Size
          </label>
          {signedIn && maxCoin > 0 ? (
            <button
              type="button"
              className="tm-tk-max"
              onClick={(e) => {
                e.stopPropagation();
                setPctAndSize(100);
              }}
              title="Fill the maximum size"
            >
              Max <b>{unit === "usd" ? fmtUsd(maxUsd, { compact: true }) : `${Number(maxCoin.toFixed(szDec))} ${base}`}</b>
            </button>
          ) : refPx ? (
            <span className="tm-tk-ref" title="Price used to convert between USDC and the coin">
              @ <b>{fmtPx(refPx)}</b>
            </span>
          ) : null}
        </div>
        <div className="tm-tk-size-main">
          {unit === "usd" && (
            <span className="tm-tk-size-cur" data-on={!!size} aria-hidden>
              $
            </span>
          )}
          <TkNum id={`${uid}-size`} ref={sizeRef} className="tm-tk-size-input" inputMode="decimal" value={size} onValue={onSize} placeholder="0" aria-label="size" autoComplete="off" />
          <button
            type="button"
            className="tm-tk-unit"
            onClick={(e) => {
              e.stopPropagation();
              switchUnit(unit === "usd" ? "coin" : "usd");
            }}
            aria-label={`Size in ${unit === "usd" ? "USDC" : base}. Switch to ${unit === "usd" ? base : "USDC"}`}
            title={`Switch to ${unit === "usd" ? base : "USDC"}`}
          >
            {unit === "usd" ? "USDC" : base}
            <TkIcon.swap size={11} sw={2} />
          </button>
        </div>
        <div className="tm-tk-size-sub">{sizeSub}</div>
        {sizeNudge > 0 && <span key={sizeNudge} className="tm-tk-flash" aria-hidden />}
      </div>

      <div className="tm-tk-quick" aria-label="Quick size">
        {QUICK.map((v) => (
          <button key={v} type="button" className="tm-tk-chip" aria-pressed={unit === "usd" && Number(size) === v} onClick={() => pickUsd(v)}>
            {fmtQuick(v)}
          </button>
        ))}
      </div>

      <div className="tm-tk-field tm-tk-pct" data-disabled={!signedIn}>
        <div className="tm-tk-field-head">
          <label htmlFor={`${uid}-pct`}>{`Of ${pctOf}`}</label>
          <span className="tm-tk-pctval" data-on={pct > 0}>
            <input value={pct} onChange={(e) => setPctAndSize(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} aria-label="percent" inputMode="numeric" disabled={!signedIn} />%
          </span>
        </div>
        <input id={`${uid}-pct`} type="range" min={0} max={100} step={1} value={pct} onChange={(e) => setPctAndSize(Number(e.target.value))} className="slider" style={{ ["--pct" as string]: `${pct}%` }} aria-label={`size percent of ${pctOf}`} disabled={!signedIn} />
        <div className="tm-tk-ticks">
          {[0, 25, 50, 75, 100].map((p) => (
            <button key={p} type="button" onClick={() => setPctAndSize(p)} style={{ "--at": p / 100 } as CSSProperties} data-on={signedIn && pct === p && p > 0} data-past={signedIn && p > 0 && pct > p} disabled={!signedIn}>
              {p}%
            </button>
          ))}
        </div>
      </div>

      {/* flags */}
      <div className="tm-tk-flags">
        <Switch on={reduceOnly} onChange={setReduceOnly} label="Reduce only" className="tm-tk-sw" />
        {isLimit && (
          <div className="tm-tk-tif">
            <span id={`${uid}-tif`}>Time in force</span>
            <span className="seg" role="group" aria-labelledby={`${uid}-tif`}>
              {(["Gtc", "Ioc", "Alo"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={tif === t} className={`seg-item ${tif === t ? "seg-active" : ""}`} onClick={() => setTif(t)} title={TIF_HINT[t]}>
                  {t.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
        )}
        {(type === "market" || type === "limit") && !isSpot && <Switch on={tpsl} onChange={setTpsl} label="Take profit / Stop loss" className="tm-tk-sw" />}
        {(type === "market" || type === "limit") && !isSpot && tpsl && (
          <div className="tm-tk-grid2">
            <MiniField label="Take profit" tone="up" hint={tpGain === null ? null : <Hint v={tpGain} />}>
              <TkNum className="tm-tk-input" inputMode="decimal" value={tp} onValue={(v) => setTp(v.replace(/[^0-9.]/g, ""))} placeholder="Price" autoComplete="off" aria-label="Take profit price" />
            </MiniField>
            <MiniField label="Stop loss" tone="down" hint={slLoss === null ? null : <Hint v={slLoss} />}>
              <TkNum className="tm-tk-input" inputMode="decimal" value={sl} onValue={(v) => setSl(v.replace(/[^0-9.]/g, ""))} placeholder="Price" autoComplete="off" aria-label="Stop loss price" />
            </MiniField>
          </div>
        )}
        <Switch on={postThesis} onChange={setPostThesis} label="Post thesis to the feed" className="tm-tk-sw" />
      </div>

      {/* thesis */}
      {postThesis && (
        <div className="tm-tk-why" data-live={thesis.trim().length > 0} onClick={() => thesisRef.current?.focus()}>
          <div className="tm-tk-why-head">
            <TkIcon.pen size={13} sw={2} />
            <label htmlFor={`${uid}-why`}>Why this trade?</label>
            <span className="tm-tk-why-count" data-level={thesisLevel}>
              {thesis.length}/280
            </span>
          </div>
          <textarea id={`${uid}-why`} ref={thesisRef} className="tm-tk-why-input" maxLength={280} rows={2} value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="Optional. Bound to this position." />
          {/* a chase goes out without a thesis; a position that is already open can take one right now */}
          {(type === "chase" || myPos) && (
            <div className="tm-tk-why-foot" onClick={(e) => e.stopPropagation()}>
              {type === "chase" && <p className="tm-tk-why-note">{myPos ? "A chase goes out without the thesis." : "A chase goes out without the thesis. Post it here once it fills."}</p>}
              {myPos && (
                <div className="tm-tk-why-pos">
                  <span className="min-w-0" title={liveThesis ? `Your live thesis: ${liveThesis.text}` : undefined}>
                    {liveThesis ? "Thesis live ·" : "On your open"} <b className={myPos.szi > 0 ? "tm-tk-up" : "tm-tk-down"}>{myPos.szi > 0 ? "Long" : "Short"}</b> {Math.abs(myPos.szi)} {label}
                  </span>
                  <button type="button" className="tm-tk-why-post" onClick={postOnPosition} disabled={thesisBusy || !thesis.trim()} aria-busy={thesisBusy} title={`Post this thesis on your open ${label} position now, without a new order`}>
                    {thesisBusy ? "Posting…" : liveThesis ? "Add" : "Post now"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* summary */}
      <dl className="tm-tk-sum">
        <SumRow k="Order value" tip="Size × price" v={sizeUsd ? fmtUsd(sizeUsd) : null} tone={ready && sizeCoin > 0 && sizeUsd < 10 && !reduceOnly ? "warn" : undefined} />
        {isSpot ? (
          <SumRow k={side === "LONG" ? "Cost" : "Proceeds"} tip={side === "LONG" ? "Paid from your spot USDC" : "Paid into your spot USDC, before fees"} v={sizeUsd ? fmtUsd(sizeUsd) : null} tone={overSpot ? "warn" : undefined} />
        ) : (
          <>
            <SumRow k="Margin required" tip="Order value ÷ leverage" v={sizeUsd ? fmtUsd(margin) : null} tone={overMargin ? "warn" : undefined} />
            <SumRow k="Liq. price" tip="Estimated liquidation price if this order fills" v={liq && sizeCoin ? `≈ ${fmtPx(liq)}` : null} tone={liq && sizeCoin && refPx && Math.abs(liq - refPx) / refPx < 0.05 ? "warn" : undefined} />
          </>
        )}
        {isMarketish && (
          <SumRow
            k="Slippage"
            tip="Estimated from the live book · maximum allowed"
            v={
              <>
                Est <span className={slip > 0.005 ? "tm-tk-warn" : ""}>{(slip * 100).toFixed(2)}%</span>
                <span className="tm-tk-dim"> / </span>Max {(MAX_SLIP * 100).toFixed(2)}%
              </>
            }
          />
        )}
        <SumRow
          k="Fees"
          tip={isSpot ? `Spot taker ${(SPOT_TAKER * 100).toFixed(2)}% · maker ${(SPOT_MAKER * 100).toFixed(2)}% · builder ${(BUILDER * 100).toFixed(2)}%` : `Taker ${(TAKER * 100).toFixed(3)}% · maker ${(MAKER * 100).toFixed(3)}% · builder ${(BUILDER * 100).toFixed(2)}%`}
          v={
            <>
              {(baseFee * 100).toFixed(feeDigits)}% + <span className="tm-tk-builder">{(BUILDER * 100).toFixed(2)}% builder</span>
              {sizeUsd ? <span className="tm-tk-dim"> · {fmtUsd(sizeUsd * feeRate)}</span> : null}
            </>
          }
        />
      </dl>

      {/* the call to action. it docks to the bottom of the column whenever the ticket runs past the fold,
          and results land just above it, so the button and what it did are always in view */}
      <div ref={dockRef} className="tm-tk-dock" data-stuck={stuck || undefined}>
        {msg && (
          <div key={`${msg.ok}${msg.text}`} className="tm-tk-toast" data-tone={msg.ok ? "ok" : "err"} role={msg.ok ? "status" : "alert"}>
            {msg.ok ? <TkIcon.check size={14} sw={2.2} /> : <TkIcon.alert size={14} />}
            <span className="min-w-0">{msg.text}</span>
            <button type="button" className="tm-tk-msg-x" onClick={() => setMsg(null)} aria-label="Dismiss">
              <TkIcon.close size={11} sw={2} />
            </button>
            {msg.ok && <span className="tm-tk-toast-timer" aria-hidden onAnimationEnd={() => setMsg((m) => (m === msg ? null : m))} />}
          </div>
        )}
        <button type="button" className={`btn tm-tk-cta ${ctaCls} ${ctaGlow ? "btn-glow" : ""}`} onClick={onCta} disabled={ctaDisabled} aria-busy={busy || ob.busy} aria-expanded={!ready && ob.Panel ? showStep : undefined} data-rest={needSize || undefined}>
          {ready ? (
            busy ? (
              <>
                <TkIcon.spin size={15} className="tm-tk-spin" />
                Placing order…
              </>
            ) : (
              <span className="tm-tk-cta-label">
                {sideWord(side)} {base}
                {sizeUsd >= 0.01 && (
                  <>
                    <span className="tm-tk-cta-sep">·</span>
                    {fmtCta(sizeUsd)}
                  </>
                )}
              </span>
            )
          ) : (
            <>
              {ob.busy ? <TkIcon.spin size={15} className="tm-tk-spin" /> : <StageIcon stage={ob.stage} />}
              {ob.cta}
              {ob.Panel && <TkIcon.chev size={15} sw={2} className="tm-tk-cta-chev" />}
            </>
          )}
        </button>
        {ready ? (
          invalid && sizeCoin > 0 ? (
            <p className="tm-tk-note" data-tone="warn" role="status">
              <TkIcon.alert size={11} sw={2} />
              <span className="min-w-0">{invalidIsMargin ? `Margin exceeds ${fmtUsd(avail)} available` : invalid}</span>
              {invalidIsMargin && (
                <button type="button" className="tm-tk-note-act" onClick={() => openFunds("deposit")}>
                  Deposit
                </button>
              )}
            </p>
          ) : lowNote ? (
            <p className="tm-tk-note" data-tone="info">
              {lowNote.kind === "enable" ? <TkIcon.bolt size={11} sw={2} /> : lowNote.kind === "deposit" ? <TkIcon.down size={11} sw={2} /> : <TkIcon.alert size={11} sw={2} />}
              <span className="min-w-0">{lowNote.text}</span>
              {lowNote.kind === "deposit" && (
                <button type="button" className="tm-tk-note-act" onClick={() => openFunds("deposit")}>
                  Deposit
                </button>
              )}
              {lowNote.kind === "enable" && (
                <button type="button" className="tm-tk-note-act" onClick={enableDexMargin} disabled={dexBusy || !walletClient}>
                  {dexBusy ? "Confirm in wallet" : "Enable"}
                </button>
              )}
            </p>
          ) : (
            <p className="tm-tk-note">
              <TkIcon.lock size={11} sw={2} />
              Signed by your agent wallet
            </p>
          )
        ) : stepOpen ? null : ob.stage === "connect" || ob.stage === "signin" ? (
          <p className="tm-tk-note">
            <TkIcon.lock size={11} sw={2} />
            {STAGE_NOTE[ob.stage]}
          </p>
        ) : (
          <p className="tm-tk-note">
            <span className="tm-tk-dots" aria-hidden>
              {[1, 2, 3, 4].map((n) => (
                <i key={n} data-on={n <= step} />
              ))}
            </span>
            Step {step} of 4 · {STAGE_NOTE[ob.stage]}
          </p>
        )}
      </div>
      <span ref={dockEndRef} className="tm-tk-dock-end" aria-hidden />
      {stepOpen && ob.Panel && (
        <div ref={stepRef} className="tm-tk-stepwrap">
          <ob.Panel />
        </div>
      )}

      {/* funds: only once a wallet is connected (the modal needs one) */}
      {ob.stage !== "connect" && (
        <div className="tm-tk-funds">
          <button type="button" className={`btn tm-tk-fund ${nudgeDeposit ? "btn-primary" : ""}`} onClick={() => openFunds("deposit")}>
            <TkIcon.down size={14} />
            Deposit
          </button>
          <button type="button" className="btn tm-tk-fund" onClick={() => openFunds("withdraw")}>
            <TkIcon.up size={14} />
            Withdraw
          </button>
        </div>
      )}

      {/* the account, the block hyperliquid shows under its ticket (for a builder dex: that dex's account) */}
      {signedIn && bal.data && (
        <div className="tm-tk-acct" role="group" aria-label={acctTitle} data-testid="account-summary">
          <p className="tm-tk-acct-title">{acctTitle}</p>
          <dl>
            <AcctRow k="Portfolio value" tip="Perps account value plus spot holdings" v={fmtUsd(bal.data.accountValue + spotAll.reduce((a, r) => a + (r.usd ?? 0), 0))} />
            <AcctRow k="Unrealized PnL" v={fmtUsd(upnlAll, { sign: true })} tone={upnlAll > 0 ? "up" : upnlAll < 0 ? "down" : undefined} />
            <AcctRow k="Perps maintenance margin" v={bal.data.maintenanceMargin !== null && bal.data.maintenanceMargin !== undefined ? fmtUsd(bal.data.maintenanceMargin) : "–"} />
            <AcctRow k="Margin ratio" tip="Maintenance margin ÷ account value" v={bal.data.accountValue > 0 && bal.data.maintenanceMargin ? `${((bal.data.maintenanceMargin / bal.data.accountValue) * 100).toFixed(2)}%` : "0.00%"} />
            <AcctRow k="Account leverage" tip="Open notional ÷ account value" v={bal.data.accountValue > 0 ? `${((bal.data.totalNtlPos ?? 0) / bal.data.accountValue).toFixed(2)}x` : "0.00x"} />
          </dl>
        </div>
      )}
      {/* coins held in spot (native deposits land there): sold for USDC they become margin */}
      {spotHeld.length > 0 && (
        <p className="tm-tk-spotline" data-testid="ticket-spot">
          <span className="tm-tk-spotline-k">Spot</span>
          <span className="min-w-0">
            <b>{spotHeld.map((r) => `${fmtQty(r.total)} ${r.name}`).join(" · ")}</b>.{" "}
            <button type="button" className="tm-tk-link" onClick={() => openConvert()}>
              Sell for USDC
            </button>{" "}
            to trade perps with it.
          </span>
        </p>
      )}
    </section>
  );
}

/** re-renders once a second while something on screen counts down */
function useTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

/** chases running on this market (lib/chase keeps them in this browser): what is left, where it rests, the time left, a stop */
function ChaseLive({ coin, base }: { coin: string; base: string }) {
  const running = useChases().filter((c) => c.coin === coin && c.status === "running");
  useTick(running.length > 0);
  if (!running.length) return null;
  const now = Date.now();
  return (
    <ul className="tm-tk-chases" aria-label="Running chases">
      {running.map((c) => (
        <li key={c.id} className="tm-tk-chase" data-side={c.side}>
          <span className="tm-tk-chase-dot" aria-hidden />
          <span className="tm-tk-chase-body">
            <span className="tm-tk-chase-line">
              <b>
                {c.side === "LONG" ? "Buy" : "Sell"} {c.remaining} {base}
              </b>
              {c.px !== null && <span className="tm-tk-chase-px"> @ {fmtPx(c.px)}</span>}
            </span>
            <small>
              Chasing · {c.reprices} re-price{c.reprices === 1 ? "" : "s"} · {clock(c.startedAt + c.maxMs - now)} left
            </small>
          </span>
          <button type="button" className="tm-tk-chase-stop" onClick={() => void stopChase(c.id)} aria-label={`Stop chasing ${c.remaining} ${base}`}>
            Stop
          </button>
        </li>
      ))}
    </ul>
  );
}

function StageIcon({ stage }: { stage: Stage }) {
  if (stage === "connect") return <Icon.wallet />;
  if (stage === "signin") return <TkIcon.key size={15} />;
  if (stage === "invite") return <TkIcon.ticket size={15} />;
  if (stage === "handle") return <TkIcon.at size={15} />;
  return <TkIcon.bolt size={15} />;
}

/** roe at the tp / sl price, coloured by sign */
function Hint({ v }: { v: number }) {
  return (
    <span className="tm-tk-hint" data-tone={v >= 0 ? "up" : "down"}>
      <span className="tm-tk-hint-k">ROE</span>
      {v > 0 ? "+" : ""}
      {(v * 100).toFixed(1)}%
    </span>
  );
}

function MiniField({ label, hint, tone, children }: { label: string; hint?: ReactNode; tone?: "up" | "down"; children: ReactNode }) {
  return (
    <label className="tm-tk-mini" data-tone={tone}>
      <span className="tm-tk-mini-label">{label}</span>
      <span className="tm-tk-mini-body">
        {children}
        {hint}
      </span>
    </label>
  );
}

function SumRow({ k, v, tip, tone }: { k: string; v: ReactNode; tip?: string; tone?: "warn" }) {
  const empty = v === null || v === undefined;
  return (
    <div>
      <dt title={tip}>{k}</dt>
      <dd data-empty={empty} data-tone={tone}>
        {empty ? "–" : v}
      </dd>
    </div>
  );
}

function AcctRow({ k, v, tip, tone }: { k: string; v: ReactNode; tip?: string; tone?: "up" | "down" }) {
  return (
    <div>
      <dt title={tip}>{k}</dt>
      <dd data-tone={tone}>{v}</dd>
    </div>
  );
}
