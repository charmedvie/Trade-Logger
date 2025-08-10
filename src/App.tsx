// Trade Logger PWA – React single-file app (mobile-first)
// Excel on OneDrive via Microsoft Graph; no servers required.
// - Reads/writes your Tradelog table in /My files/Trade/Log1.xlsx
// - Dropdowns read from Excel tables on your "Ref" sheet (Typelist, Acclist, Tradetypelist, Statuslist)
// - Formula columns are skipped so Excel calculates them
// -----------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";

// -------------------- CONFIG (CUSTOMISE THESE) --------------------
const CONFIG = {
  clientId: "19a3021d-6ea2-4436-8a84-e73362b14135",              // ← paste your Application (client) ID
  authority: "https://login.microsoftonline.com/consumers", // personal Microsoft account
  redirectUri: "https://trade-logger-omega.vercel.app/",

  filePath: "/Trade/Log1.xlsx",        // ← your OneDrive path, keep leading '/'
  tableName: "Tradelog",                         // ← your Excel table name (case-sensitive)

  // Column mapping (must match Excel table order exactly)
  colMapping: [
    { key: "type", header: "Type" },
    { key: "acc", header: "Acc" },
    { key: "inDate", header: "In date" },
    { key: "ticker", header: "Ticker" },
    { key: "strike", header: "Strike" },
    { key: "position", header: "Position" },
    { key: "avgPrice", header: "Avg price" },
    { key: "costBasis", header: "Cost Basis" },
    { key: "margin", header: "Margin" },
    { key: "fees", header: "Fees" },
    { key: "expDate", header: "Exp date" },
    { key: "status", header: "Status" },
    { key: "outDate", header: "Out date" },
    { key: "outWk", header: "Out wk" },
    { key: "outYr", header: "Out YR" },
    { key: "exitPrice", header: "Exit price" },
    { key: "proceeds", header: "Proceeds" },
    { key: "pnl", header: "P&L" },
    { key: "tradeType", header: "Trade type" },
    { key: "roiCb", header: "ROI cb" },
    { key: "roi", header: "Roi" },
    { key: "time", header: "Time" },
    { key: "term", header: "Term" },
    { key: "notes", header: "Notes" },
  ],
};

// Columns calculated by Excel (we won't render inputs; we send blanks so formulas populate)
const FORMULA_COLS = new Set([
  "Cost Basis",
  "Margin",
  "Out wk",
  "Out YR",
  "Proceeds",
  "P&L",
  "ROI cb",
  "Roi",
  "Time",
  "Term",
]);

// List-restricted columns → Excel tables with allowed values (sheet name is irrelevant; table names matter)
const LIST_COL_TABLE = {
  "Type": "Typelist",
  "Acc": "Acclist",
  "Trade type": "Tradetypelist",
  "Status": "Statuslist",
  // Position intentionally free-text
};

// Columns to hide in the "Recent (from Excel)" view (mobile+desktop)
const HIDE_IN_RECENT = new Set([
  "Margin",
  "Fees",
  "Out YR",
  "Proceeds",
  "ROI cb",
  "Roi",
  "Notes",
  "Cost Basis",
  "Out date",
  "Exit price",
]);

// Helper: indices of columns we DO show in Recent
function getRecentVisibleIndices() {
  return CONFIG.colMapping
    .map((c, i) => (!HIDE_IN_RECENT.has(c.header) ? i : -1))
    .filter(i => i !== -1);
}

// -------------------- MSAL + Graph helpers --------------------
const msal = new PublicClientApplication({
  auth: {
    clientId: CONFIG.clientId,
    authority: CONFIG.authority,
    redirectUri: CONFIG.redirectUri,
    navigateToLoginRequestUrl: false
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true   // <-- important for Safari/ITP
  }
});

// Ensure MSAL v3 is initialized before any calls
async function ensureMsalInitialized() {
  await msal.initialize();
}

async function getAccessToken() {
  const accounts = msal.getAllAccounts();
  const request = {
    scopes: ["User.Read", "Files.ReadWrite.All", "Sites.ReadWrite.All", "offline_access"],
    account: accounts[0]
  };

  try {
    const res = await msal.acquireTokenSilent(request);
    return res.accessToken;
  } catch (e) {
    const res = await msal.acquireTokenPopup({
      scopes: request.scopes,
      redirectUri: CONFIG.redirectUri,
      account: accounts[0]
    });
    return res.accessToken;
  }
}

async function graphFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`${res.status} ${res.statusText}: ${text}`); }
  return res.json();
}

function wbPath() { return `/me/drive/root:${encodeURI(CONFIG.filePath)}:/workbook`; }

async function listRows(top = 25) {
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows?$top=${top}`;
  return graphFetch(path, { method: "GET" });
}

async function addRow(valuesArray) {
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/add`;
  return graphFetch(path, { method: "POST", body: JSON.stringify({ index: null, values: [valuesArray] }) });
}

// Find the first row where all manual-entry columns are blank
function _isBlank(v) {
  return v === null || String(v).trim() === "";
}

// Find first row where **In date** is blank (your template row)
async function findFirstBlankRowIndex(top = 1000) {
  const data = await listRows(top);
  const rows = data.value || [];
  const inDateIdx = CONFIG.colMapping.findIndex(c => c.header === "In date");
  if (inDateIdx < 0) return null;

  for (let i = 0; i < rows.length; i++) {
    const vals = rows[i]?.values?.[0] || [];
    if (_isBlank(vals[inDateIdx])) return i;
  }
  return null;
}

// Session version (for Preview)
async function findFirstBlankRowIndexInSession(sessionId, top = 1000) {
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows?$top=${top}`;
  const data = await graphFetchSession(path, { method: "GET" }, sessionId);
  const rows = data.value || [];
  const inDateIdx = CONFIG.colMapping.findIndex(c => c.header === "In date");
  if (inDateIdx < 0) return null;

  for (let i = 0; i < rows.length; i++) {
    const vals = rows[i]?.values?.[0] || [];
    if (_isBlank(vals[inDateIdx])) return i;
  }
  return null;
}

// Update a specific table row by index; only write manual columns
async function patchRowAtIndex(index, rowValues) {
  const values = CONFIG.colMapping.map((c, i) =>
    FORMULA_COLS.has(c.header) ? null : (rowValues[i] ?? "")
  );
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/itemAt(index=${index})/range`;
  return graphFetch(path, {
    method: "PATCH",
    body: JSON.stringify({ values: [values] }),
  });
}

// Session version (for Preview)
async function patchRowAtIndexInSession(index, rowValues, sessionId) {
  const values = CONFIG.colMapping.map((c, i) =>
    FORMULA_COLS.has(c.header) ? null : (rowValues[i] ?? "")
  );
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/itemAt(index=${index})/range`;
  return graphFetchSession(path, {
    method: "PATCH",
    body: JSON.stringify({ values: [values] }),
  }, sessionId);
}

// ---- Preview helpers using a NON-persistent Excel session ----
async function createSession(persist = false) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${wbPath()}/createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ persistChanges: persist })
  });
  if (!res.ok) throw new Error(await res.text());
  const j = await res.json();
  return j.id; // workbook-session-id
}

async function graphFetchSession(path, options = {}, sessionId) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "workbook-session-id": sessionId,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  // If no content, skip parsing JSON
  if (res.status === 204) return {};
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

async function addRowInSession(valuesArray, sessionId) {
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/add`;
  return graphFetchSession(path, { method: "POST", body: JSON.stringify({ index: null, values: [valuesArray] }) }, sessionId);
}

async function calculateInSession(sessionId) {
  const path = `${wbPath()}/application/calculate`;
  return graphFetchSession(path, { method: "POST", body: JSON.stringify({ calculationType: "Full" }) }, sessionId);
}

async function getRowByIndexInSession(index, sessionId) {
  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/itemAt(index=${index})`;
  return graphFetchSession(path, { method: "GET" }, sessionId);
}

async function fetchListOptions(tableName) {
  const path = `${wbPath()}/tables('${encodeURIComponent(tableName)}')/rows`;
  const data = await graphFetch(path, { method: "GET" });
  return (data.value || []).map(r => r.values[0][0]); // 1st column of each row
}

// -------------------- App --------------------
export default function App() {
  const [account, setAccount] = useState(null);
  const [recent, setRecent] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [listOptions, setListOptions] = useState({});
  const [preview, setPreview] = useState(null); // will hold { headers, values }
  const [previewBusy, setPreviewBusy] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
useEffect(() => {
  const onResize = () => setIsMobile(window.innerWidth <= 640);
  onResize();
  window.addEventListener("resize", onResize);
  // ▼ Recent table: only show selected columns
const recentVisibleIdxs = useMemo(() => getRecentVisibleIndices(), []);
const recentHeaders = useMemo(
  () => recentVisibleIdxs.map(i => CONFIG.colMapping[i].header),
  [recentVisibleIdxs]
);
  return () => window.removeEventListener("resize", onResize);
}, []);


  // Default form values (manual-entry columns only)
  const defaultForm = () => ({
    // Defaults
    type: "stock option",   // from Typelist
    acc: "",                // choose from Acclist
    inDate: new Date().toISOString().slice(0, 10),
    ticker: "",
    strike: "",
    position: "",
    avgPrice: "",
    fees: "0",
    expDate: "",
    status: "",             // ← blank by default
    outDate: "",
    outWk: "",
    outYr: "",
    exitPrice: "",
    proceeds: "",
    pnl: "",
    tradeType: "CC",        // from Tradetypelist
    roiCb: "",
    roi: "",
    time: "",
    term: "",
    notes: "",
    costBasis: "",
    margin: "",
  });
  const [form, setForm] = useState(defaultForm);
  const [showOut, setShowOut] = useState(false);
  const OUT_FIELDS = new Set(["Out date", "Status", "Exit price"]);
  const [notice, setNotice] = useState(""); // shows a success toast

  useEffect(() => {
  (async () => {
    await ensureMsalInitialized();

    // Handle redirect result (also runs on Safari if we fall back to redirect)
    const resp = await msal.handleRedirectPromise();
    if (resp?.account) {
      msal.setActiveAccount(resp.account);
      setAccount(resp.account);
    } else {
      const accs = msal.getAllAccounts();
      if (accs.length) {
        msal.setActiveAccount(accs[0]);
        setAccount(accs[0]);
      }
    }

    if (msal.getActiveAccount()) {
      await Promise.all([refresh(), loadLists()]);
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);;

  async function signIn() {
  setErr("");
  try {
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    const request = {
      scopes: ["User.Read", "Files.ReadWrite.All", "Sites.ReadWrite.All", "offline_access"],
      prompt: "select_account",
      redirectUri: CONFIG.redirectUri
    };

    if (isSafari) {
      await msal.loginRedirect(request);
      return; // flow continues in handleRedirectPromise
    }

    const res = await msal.loginPopup(request);
    if (res?.account) {
      msal.setActiveAccount(res.account);
      setAccount(res.account);
      await Promise.all([refresh(), loadLists()]);
    } else {
      // If popup returned nothing, fall back to redirect
      await msal.loginRedirect(request);
    }
  } catch (e: any) {
    setErr(e.message || String(e));
  }
}

  async function signOut() {
  try {
    const acc = msal.getActiveAccount();
    if (acc) {
      await msal.logoutPopup({
        account: acc,
        postLogoutRedirectUri: CONFIG.redirectUri
      });
    }
  } finally {
    setAccount(null);
    setRecent([]);
    setListOptions({});
    setPreview(null);
  }
}
  
  // --- Helper to parse Excel dates ---
// Parse Excel date to a sortable timestamp (ms). Returns -Infinity if unknown.
function excelDateToTime(val) {
  if (val === null || val === "") return -Infinity;

  // Excel serial number (days since 1899-12-30)
  if (typeof val === "number") {
    return Math.round((val - 25569) * 86400 * 1000);
  }

  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y,m,d] = val.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  // dd-MMM-YYYY or d-MMM-YYYY (e.g., 09-Aug-2025)
  if (/^\d{1,2}[-/][A-Za-z]{3}[-/]\d{4}$/.test(val)) {
    const t = Date.parse(val);           // browser can parse with month name
    return Number.isNaN(t) ? -Infinity : t;
  }

  // Fallback
  const t = Date.parse(val);
  return Number.isNaN(t) ? -Infinity : t;
}

function toJsDate(val) {
  if (val === null || val === "") return null;
  if (typeof val === "number") {
    // Excel serial -> JS Date
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }
  // Try ISO (YYYY-MM-DD) or other strings
  const t = Date.parse(val);
  return Number.isNaN(t) ? null : new Date(t);
}

function fmtDDMMMYYYY(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj)) return "";
  const d = String(dateObj.getDate()).padStart(2, "0");
  const m = dateObj.toLocaleString("en-GB", { month: "short" });
  const y = dateObj.getFullYear();
  return `${d}-${m}-${y}`;
}

const ZERO_DEC_HEADERS = new Set(["Cost Basis", "Proceeds", "P&L", "Margin"]);
const PCT_HEADERS      = new Set(["ROI cb", "Roi"]);
const OUT_YR_HEADER    = "Out YR";
const ZERO_DEC_NO_COMMA_HEADERS = new Set(["Out wk", "Time"]);

function isFalseText(v) {
  return typeof v === "string" && v.trim().toUpperCase() === "FALSE";
}
function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").trim().replace(/%$/, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
function fmtNumber(n, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function prettyCell(cell, header) {
  if (cell === null || cell === undefined || isFalseText(cell)) return "";

  // Dates
  if (/date/i.test(header)) return fmtDDMMMYYYY(toJsDate(cell));

  // Out YR special case
  if (header === OUT_YR_HEADER) {
    const n = toNumber(cell);
    if (n === null || n === 1900) return "";
    return String(n); // no commas, no decimals
  }

  // Out wk / Time special case (whole numbers, no commas)
  if (ZERO_DEC_NO_COMMA_HEADERS.has(header)) {
    const n = toNumber(cell);
    return n === null ? "" : String(Math.round(n));
  }

  // Percent columns (ROI cb, Roi)
  if (PCT_HEADERS.has(header)) {
    const p = parsePct(cell);
    if (p == null) return "";
    return `${fmtNumber(p * 100, 0)}%`;
  }

  // Money-ish zero-decimal columns
  if (ZERO_DEC_HEADERS.has(header)) {
    const n = toNumber(cell);
    return n === null ? "" : fmtNumber(n, 0);
  }

  // Acc → force no decimals
  if (header === "Acc") {
    const n = toNumber(cell);
    return n === null ? String(cell) : String(Math.round(n));
  }
  
  // Position column → no decimals
  if (/^position$/i.test(header)) {
    return Number(cell || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  // Term: show as-is (LT highlighting done by cellStyle)
  if (header === "Term") return String(cell);

  // Generic numbers: commas + up to 2 decimals
  const n = toNumber(cell);
  if (n !== null && Number.isFinite(n)) return fmtNumber(n, 2);

  // Fallback: text
  return String(cell);
}

// ---- cell styling helpers ----
const STATUS_COLORS = {
  "sold": "#111",
  "assigned": "#e67e22", // orange
  "expired": "#2ecc71",  // green
  "hold": "#1e90ff",     // blue
  "savlage": "#b00020"   // deep red (as typed)
};

// account color map
const ACC_COLORS = {
  524: "#1aa64a",  // green
  577: "#ff8c00",  // orange
  458: "#7856ff",  // purple
  44:  "#000000"   // black
};

function parsePct(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;                  // could already be 0.12
  const s = String(v).trim();
  if (s.endsWith("%")) return parseFloat(s) / 100;      // "12%" -> 0.12
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;                    // "0.12" -> 0.12
}

function isNumberLike(v) {
  if (typeof v === "number") return true;
  if (v == null || v === "") return false;
  return !Number.isNaN(parseFloat(String(v).replace(/,/g,"")));
}

// returns extra style for a cell based on header+value
function cellStyle(header, raw) {
  const h = (header || "").toLowerCase();

  // P&L background (green/red, darker if > 1000)
  if (h === "p&l") {
    const n = isNumberLike(raw) ? parseFloat(String(raw).replace(/,/g,"")) : null;
    if (n == null) return {};
    if (n > 0) {
      return { background: n > 1000 ? "rgba(34,197,94,0.30)" : "rgba(34,197,94,0.18)" }; // darker for big wins
    } else if (n < 0) {
      return { background: "rgba(239,68,68,0.20)" };
    }
    return {};
  }

  // ROI / ROI cb background (green/red on sign)
  if (h === "roi" || h === "roi cb") {
    const p = parsePct(raw);
    if (p == null) return {};
    return p >= 0 ? { background: "rgba(34,197,94,0.18)" } : { background: "rgba(239,68,68,0.20)" };
  }

  // Status text color
  if (h === "status") {
    const clr = STATUS_COLORS[String(raw || "").trim().toLowerCase()];
    return clr ? { color: clr, fontWeight: 600 } : {};
  }

  // Acc: no decimals + color by code
  if (h === "acc") {
    const n = isNumberLike(raw) ? Math.round(parseFloat(String(raw))) : null;
    const clr = n != null ? ACC_COLORS[n] : null;
    return { color: clr || "#333", fontWeight: 600 };
  }

  // Term: highlight LT chip
  if (h === "term") {
    if (String(raw || "").toUpperCase().includes("LT")) {
      return { background: "rgba(99,102,241,0.20)", fontWeight: 600, borderRadius: 10, padding: "4px 8px" };
    }
  }

  return {};
}

// --- Refresh from Excel ---
async function refresh() {
  setErr("");
  try {
    const data = await listRows(5000);
    const inDateIdx = CONFIG.colMapping.findIndex(c => c.header === "In date");

    const sorted = (data.value || [])
      .slice()
      .sort((a, b) => {
        const aDate = toJsDate(a.values[0][inDateIdx]);
        const bDate = toJsDate(b.values[0][inDateIdx]);
        const at = aDate ? aDate.getTime() : -Infinity;
        const bt = bDate ? bDate.getTime() : -Infinity;
        return bt - at; // newest first
      })
      .slice(0, 25)
      .map(r => {
        const row = [...r.values[0]];
        const d = toJsDate(row[inDateIdx]);
        row[inDateIdx] = fmtDDMMMYYYY(d);
        return row;
      });

    setRecent(sorted);
  } catch (e) {
    setErr(e.message || String(e));
  }
}
  
  async function handlePreview() {
    setErr(""); setPreview(null); setPreviewBusy(true);
    try {
      const rowValues = toValues();                       // build values in table order
      const sessionId = await createSession(false);       // non-persistent session
  
      // Try to fill your template (blank) row first
      let blankIdx = await findFirstBlankRowIndexInSession(sessionId);
      let targetIdx = null;
  
      if (blankIdx !== null) {
        await patchRowAtIndexInSession(blankIdx, rowValues, sessionId);
        targetIdx = blankIdx;
      } else {
        const added = await addRowInSession(rowValues, sessionId); // fallback: append
        targetIdx = added?.index ?? added?.value?.[0]?.index ?? null;
      }
  
      // Recalc + small pause so calculated columns populate
      await calculateInSession(sessionId);
      await new Promise(r => setTimeout(r, 300));
  
      // Read back the row we just updated/added
      let row;
      if (targetIdx !== null) {
        const got = await getRowByIndexInSession(targetIdx, sessionId);
        row = got?.values?.[0] || got?.value?.[0]?.values?.[0];
      } else {
        const recent = await graphFetchSession(
          `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows?$top=1&$orderby=index desc`,
          { method: "GET" },
          sessionId
        );
        row = (recent.value || [])[0]?.values?.[0] || [];
      }
  
      const headers = CONFIG.colMapping.map(c => c.header);
      const valuesDisp = (row || []).map(v => String(v ?? ""));
      setPreview({ headers, values: valuesDisp });
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setPreviewBusy(false);
    }
  }
  async function loadLists() {
    try {
      const entries = await Promise.all(
        Object.entries(LIST_COL_TABLE).map(async ([header, table]) => [header, await fetchListOptions(table)])
      );
      setListOptions(Object.fromEntries(entries));
    } catch (e) { setErr(e.message); }
  }

  function onChange(name, value) { setForm(f => ({ ...f, [name]: value })); }

  function toValues() {
    // Use null for formula columns so Excel applies calculated-column formulas
    return CONFIG.colMapping.map(c =>
      FORMULA_COLS.has(c.header) ? null : (form[c.key] ?? "")
    );
  }

  async function save(e) {
    if (e && e.preventDefault) e.preventDefault();
    setErr(""); setSaving(true);
    try {
      const values = toValues();
      const blankIdx = await findFirstBlankRowIndex(); // persistent (no session)
      if (blankIdx !== null) {
        await patchRowAtIndex(blankIdx, values);
      } else {
        // no blank template row available → append at end
        await addRow(values);
      }
      await refresh();
      setForm(defaultForm());
      setPreview(null);
      // ✅ success toast
        setNotice("Saved successfully ✅");
        setTimeout(() => setNotice(""), 2000);
      } catch (e) {
        setErr(e.message || String(e));
      } finally {
        setSaving(false);
      }
    }
    //} catch (e) {
     // setErr(e.message);
    //} finally {
    //  setSaving(false);
   // }
 // }

  const headers = useMemo(() => CONFIG.colMapping.map(c => c.header), []);
  const editableCols = useMemo(() => CONFIG.colMapping.filter(c => !FORMULA_COLS.has(c.header)), []);
  const mainFields = useMemo(() => editableCols.filter(c => !OUT_FIELDS.has(c.header)), [editableCols]);
  const outFields  = useMemo(() => editableCols.filter(c =>  OUT_FIELDS.has(c.header)), [editableCols]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", padding: 12, maxWidth: 720, margin: "0 auto",minHeight: "100vh",
    background: "linear-gradient(135deg, rgba(255,240,245,0.8) 0%, rgba(240,255,250,0.8) 33%, rgba(240,248,255,0.8) 66%, rgba(255,250,240,0.8) 100%)"}}>
     <style>{`
      @media (max-width: 640px) {
        .form-grid { grid-template-columns: 1fr !important; }
        .mobile-card { border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.5); }
        .mobile-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .mobile-kv  { display: flex; justify-content: space-between; gap: 8px; }
        .mobile-kv .k { color: #666; }
        .mobile-kv .v { font-weight: 500; }
      }
    `}</style>
      <Header account={account} onSignIn={signIn} onSignOut={signOut} onRefresh={refresh} />

      {err && <Alert>{err}</Alert>}

      {notice && (
        <div style={{
          background: "rgba(46, 204, 113, 0.15)",
          border: "1px solid rgba(46, 204, 113, 0.35)",
          color: "#1B5E20",
          padding: 10,
          borderRadius: 10,
          marginBottom: 8,
          backdropFilter: "blur(6px)"
        }}>
          {notice}
        </div>
      )}

      <Card tint="rgba(224,255,255,0.6)"> 
        <h3 style={{ marginTop: 0 }}>Quick Add Trade</h3>
        <form onSubmit={save} className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {mainFields.map(c => (
          <Field key={c.header} label={c.header} full={c.header === "Notes"}>
            {renderInput(c, form, onChange, listOptions)}
          </Field>
        ))}

        {/* Fast-entry: collapsible Trade Out section */}
        <div style={{ gridColumn: "1 / -1" }}>
          <div
            role="button"
            onClick={() => setShowOut(s => !s)}
            style={{
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 4px 14px rgba(0,0,0,0.05)",
              backdropFilter: "blur(6px)",
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            <span>Trade Out</span>
            <span>{showOut ? "▾" : "▸"}</span>
          </div>
        </div>

        {showOut && outFields.map(c => (
        <Field key={c.header} label={c.header}>
          {renderInput(c, form, onChange, listOptions)}
        </Field>
        ))}
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              justifyContent: "center",
              gap: 8,
              marginTop: 10
            }}
          >
            <button
              disabled={!account || previewBusy}
              onClick={handlePreview}
              style={btn()}
            >
              {previewBusy ? "Preparing preview…" : "Preview"}
            </button>

            <button
              disabled={!account || saving}
              onClick={(e) => save(e)}
              style={btn()}
            >
              {saving ? "Saving…" : "Save Trade"}
            </button>
          </div>
        </form>
      </Card>
      {preview && (
  <Card tint="rgba(255,228,225,0.6)">
    <h3 style={{ marginTop: 0 }}>Preview (not saved yet)</h3>
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {(preview.headers || []).map((h, idx) => (
              <th
                key={idx}
                style={{ textAlign: "left", padding: "10px 12px", color: "#666", borderBottom: "1px solid #eee", background: "rgba(255,255,255,0.4)",
                backdropFilter: "blur(4px)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {(preview.values || []).map((cell, j) => {
              const header = (preview.headers && preview.headers[j]) || "";
              const val = typeof prettyCell === "function" ? prettyCell(cell, header) : String(cell ?? "");
              return (
                <td
                  key={j}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #f2f2f2",
                    whiteSpace: "nowrap"
                  }}
                >
                  {val}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
    <button onClick={async () => { await save(new Event("submit")); setPreview(null); }} style={btn()} {...btnHoverProps()}>
         Confirm & Save
    </button>
    <button onClick={() => setPreview(null)} style={btn("#eee", "#111")} {...btnHoverProps()}>
          Cancel
    </button>
    </div>
  </Card>
)}

  <Card tint="rgba(255,255,224,0.6)">
  <h3 style={{ marginTop: 0 }}>Recent (from Excel)</h3>

  {/* Desktop/tablet: compact table with hidden columns removed */}
  {!isMobile && (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {recentHeaders.map(h => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  color: "#555",
                  borderBottom: "1px solid #eee",
                  background: "rgba(255,255,255,0.45)",
                  backdropFilter: "blur(4px)"
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recent.map((row, i) => {
            const outWkIdx = CONFIG.colMapping.findIndex(c => c.header === "Out wk");
            const outWkVal = outWkIdx >= 0 ? row[outWkIdx] : null;
            const isOutWkZero = Number(String(outWkVal).replace(/,/g,"")) === 0;

            return (
              <tr
                key={i}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.4)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                style={isOutWkZero ? { background: "#ffffff" } : {}}
              >
                {recentVisibleIdxs.map(j => {
                  const header = CONFIG.colMapping[j].header;
                  const cell = row[j];
                  const val = prettyCell(cell, header);
                  return (
                    <td
                      key={j}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #f2f2f2",
                        whiteSpace: "nowrap",
                        ...cellStyle(header, cell)
                      }}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  )}

  {/* Mobile: stacked cards, NO horizontal scroll */}
  {isMobile && (
    <div style={{ display: "grid", gap: 8 }}>
      {recent.map((row, i) => (
        <div key={i} className="mobile-card">
          <div className="mobile-row">
            {recentVisibleIdxs.map(j => {
              const header = CONFIG.colMapping[j].header;
              const cell = row[j];
              const val = prettyCell(cell, header);
              return (
                <div key={j} className="mobile-kv">
                  <span className="k">{header}</span>
                  <span className="v" style={cellStyle(header, cell)}>{val}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  )}
</Card>

<p style={{ textAlign: "center", color: "#999", fontSize: 12, marginTop: 16 }}>
  Tip: add this site to your phone Home Screen to use it like an app.
</p>
</div>  
);        
}         

// -------------------- UI helpers --------------------
function Header({ account, onSignIn, onSignOut, onRefresh }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>Trade Logger (Excel)</h2>
      {!account ? (
        <button onClick={onSignIn} style={btn()} {...btnHoverProps()}>Sign in with Microsoft</button>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <small style={{ color: "#555" }}>{account.username}</small>
          <button onClick={onRefresh} style={btn("#eee", "#111")} {...btnHoverProps()}>Refresh</button>
          <button onClick={onSignOut} style={btn("#fee", "#a00")} {...btnHoverProps()}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, ...(full ? { gridColumn: "1 / -1" } : {}) }}>
      <span style={{ fontSize: 12, color: "#555" }}>{label}</span>
      {children}
    </label>
  );
}

function Card({ children, tint = "rgba(255,255,255,0.6)" }) {
  return (
    <div style={{
      background: tint,
      border: "1px solid rgba(255,255,255,0.45)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
      backdropFilter: "blur(10px)",
      borderRadius: 14,
      padding: 14,
      marginBottom: 14
    }}>
      {children}
    </div>
  );
}

function Alert({ children }) {
  return (
    <div style={{ background: "#fee", border: "1px solid #fcc", padding: 8, borderRadius: 8, color: "#a00", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function renderInput(c, form, onChange, listOptions) {
  // Dropdowns from Excel tables for specific headers
  if (LIST_COL_TABLE[c.header]) {
    const opts = listOptions[c.header] || [];
    const value = form[c.key] ?? "";
    // Auto-select first option for dropdowns EXCEPT Status (keep blank default)
    if (!value && opts.length && c.header !== "Status" && form[c.key] === "") {
      onChange(c.key, opts[0]);
    }
    return (
      <select
        value={form[c.key] || ""}
        onChange={e => onChange(c.key, e.target.value)}
        style={inputStyle()}
      >
        <option value=""></option>
        {opts.map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  // Date inputs
  if (/date/i.test(c.header)) {
    return (
      <input
        type="date"
        value={form[c.key] || ""}
        onChange={e => onChange(c.key, e.target.value)}
        style={inputStyle()}
      />
    );
  }

  // Numeric-ish fields
  if (/price|fees|strike|exit|proceeds|p&l|roi/i.test(c.header)) {
    return (
      <input
        inputMode="decimal"
        value={form[c.key] || ""}
        onChange={e => onChange(c.key, e.target.value)}
        style={inputStyle()}
      />
    );
  }

  // Default text
  return (
    <input
      value={form[c.key] || ""}
      onChange={e => onChange(c.key, c.header === "Ticker" ? e.target.value.toUpperCase() : e.target.value)}
      style={inputStyle()}
      placeholder={c.header === "Ticker" ? "AMZN" : ""}
    />
  );
}

function inputStyle() { return { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 10, fontSize: 14 }; }

function btn(bg = "linear-gradient(135deg, #ffd6e8, #d6f0ff)", color = "#333") {
  return {
    background: bg,
    color,
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,0.4)",
    borderRadius: 12,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(0,0,0,0.05)",
    backdropFilter: "blur(6px)",
    transition: "all 0.2s ease",
    fontWeight: 500
  };
}
function btnHoverProps() {
  return {
    onMouseOver: e => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.15)"),
    onMouseOut:  e => (e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.05)"),
  };
}
