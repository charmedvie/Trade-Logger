// Trade Logger PWA – React single-file app (mobile-first)
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";

// -------------------- CONFIG --------------------
const CONFIG = {
  clientId: "19a3021d-6ea2-4436-8a84-e73362b14135",
  authority: "https://login.microsoftonline.com/consumers",
  redirectUri: "https://trade-logger-omega.vercel.app/",
  filePath: "/Trade/Log1.xlsx",
  tableName: "Tradelog",
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

// Excel-calculated columns
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

// Dropdown sources
const LIST_COL_TABLE: Record<string, string> = {
  Type: "Typelist",
  Acc: "Acclist",
  "Trade type": "Tradetypelist",
  Status: "Statuslist",
};

// ⬇️ EXACT columns to show in "Recent (from Excel)"
const SHOW_IN_RECENT = new Set([
  "Type",
  "In date",
  "Ticker",
  "Strike",
  "Position",
  "Avg price",
  "Status",
  "P&L",
]);

function getRecentVisibleIndices() {
  return CONFIG.colMapping
    .map((c, i) => (SHOW_IN_RECENT.has(c.header) ? i : -1))
    .filter((i) => i !== -1);
}

// -------------------- MSAL + Graph --------------------
const msal = new PublicClientApplication({
  auth: {
    clientId: CONFIG.clientId,
    authority: CONFIG.authority,
    redirectUri: CONFIG.redirectUri,
    navigateToLoginRequestUrl: false,
  },
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true },
});

async function ensureMsalInitialized() {
  await msal.initialize();
}

async function getAccessToken() {
  const accounts = msal.getAllAccounts();
  const request = {
    scopes: ["User.Read", "Files.ReadWrite.All", "Sites.ReadWrite.All", "offline_access"],
    account: accounts[0],
  };
  try {
    const res = await msal.acquireTokenSilent(request);
    return res.accessToken;
  } catch {
    const res = await msal.acquireTokenPopup({ ...request, redirectUri: CONFIG.redirectUri });
    return res.accessToken;
  }
}

async function graphFetch(path: string, options: any = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

function wbPath() {
  return `/me/drive/root:${encodeURI(CONFIG.filePath)}:/workbook`;
}

async function listRows(top = 20) {
  return graphFetch(
    `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows?$top=${top}`,
    { method: "GET" }
  );
}
async function addRow(valuesArray: any[]) {
  return graphFetch(
    `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/add`,
    { method: "POST", body: JSON.stringify({ index: null, values: [valuesArray] }) }
  );
}
function _isBlank(v: any) {
  return v === null || String(v).trim() === "";
}
async function findFirstBlankRowIndex(top = 1000) {
  const data = await listRows(top);
  const rows = data.value || [];
  const inDateIdx = CONFIG.colMapping.findIndex((c) => c.header === "In date");
  if (inDateIdx < 0) return null;
  for (let i = 0; i < rows.length; i++) {
    const vals = rows[i]?.values?.[0] || [];
    if (_isBlank(vals[inDateIdx])) return i;
  }
  return null;
}
async function patchRowAtIndex(index: number, rowValues: any[]) {
  const values = CONFIG.colMapping.map((c, i) => (FORMULA_COLS.has(c.header) ? null : rowValues[i] ?? ""));
  return graphFetch(
    `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/itemAt(index=${index})/range`,
    { method: "PATCH", body: JSON.stringify({ values: [values] }) }
  );
}

// Session utils
async function createSession(persist = false) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${wbPath()}/createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ persistChanges: persist }),
  });
  if (!res.ok) throw new Error(await res.text());
  const j = await res.json();
  return j.id as string;
}
async function graphFetchSession(path: string, options: any = {}, sessionId: string) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "workbook-session-id": sessionId,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  if (res.status === 204) return {};
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}
async function addRowInSession(valuesArray: any[], sessionId: string) {
  return graphFetchSession(
    `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/add`,
    { method: "POST", body: JSON.stringify({ index: null, values: [valuesArray] }) },
    sessionId
  );
}
async function calculateInSession(sessionId: string) {
  return graphFetchSession(
    `${wbPath()}/application/calculate`,
    { method: "POST", body: JSON.stringify({ calculationType: "Full" }) },
    sessionId
  );
}
async function getRowByIndexInSession(index: number, sessionId: string) {
  return graphFetchSession(
    `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/itemAt(index=${index})`,
    { method: "GET" },
    sessionId
  );
}
async function findFirstBlankRowIndexInSession(sessionId: string, top = 1000) {
  const data = await graphFetchSession(
    `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows?$top=${top}`,
    { method: "GET" },
    sessionId
  );
  const rows = (data as any).value || [];
  const inDateIdx = CONFIG.colMapping.findIndex((c) => c.header === "In date");
  if (inDateIdx < 0) return null;
  for (let i = 0; i < rows.length; i++) {
    const vals = rows[i]?.values?.[0] || [];
    if (_isBlank(vals[inDateIdx])) return i;
  }
  return null;
}
async function fetchListOptions(tableName: string) {
  const data = await graphFetch(
    `${wbPath()}/tables('${encodeURIComponent(tableName)}')/rows`,
    { method: "GET" }
  );
  return ((data.value || []) as any[]).map((r) => r.values[0][0]);
}

// -------------------- App --------------------
export default function App() {
  const [account, setAccount] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [listOptions, setListOptions] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<{ headers: string[]; values: string[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const msgRef = useRef<HTMLDivElement | null>(null);
  const statusColumnIndex = CONFIG.colMapping.findIndex(
    (c) => c.header.toLowerCase() === "status");

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  
  useEffect(() => {
  if (err || notice) {
    // after paint so the element exists
    setTimeout(() => {
      msgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	  msgRef.current?.focus({ preventScroll: true });
    }, 0);
  }
}, [err, notice]);

  // Defaults
  const defaultForm = () => ({
    type: "",
    acc: "",
    inDate: new Date().toISOString().slice(0, 10),
    ticker: "",
    strike: "",
    position: "",
    avgPrice: "",
    fees: "0",
    expDate: "",
    status: "",
    outDate: "",
    outWk: "",
    outYr: "",
    exitPrice: "",
    proceeds: "",
    pnl: "",
    tradeType: "CC",
    roiCb: "",
    roi: "",
    time: "",
    term: "",
    notes: "",
    costBasis: "",
    margin: "",
  });
  const [form, setForm] = useState(defaultForm());

  const OUT_FIELDS = useMemo(() => new Set(["Out date", "Status", "Exit price"]), []);
  const [showOut, setShowOut] = useState(false);

  // Init + load
  useEffect(() => {
    (async () => {
      await ensureMsalInitialized();
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
  }, []);

  // Fields/columns
  const headers = useMemo(() => CONFIG.colMapping.map((c) => c.header), []);
  const editableCols = useMemo(
    () => CONFIG.colMapping.filter((c) => !FORMULA_COLS.has(c.header)),
    []
  );
  const mainFields = useMemo(
    () => editableCols.filter((c) => !OUT_FIELDS.has(c.header)),
    [editableCols, OUT_FIELDS]
  );
  const outFields = useMemo(
    () => editableCols.filter((c) => OUT_FIELDS.has(c.header)),
    [editableCols, OUT_FIELDS]
  );

  // Recent visible columns
  const recentVisibleIdxs = useMemo(() => getRecentVisibleIndices(), []);

  // --- Data ops ---
  async function refresh() {
    setErr("");
    try {
      const data = await listRows(5000);
      const inDateIdx = CONFIG.colMapping.findIndex((c) => c.header === "In date");
      const sorted = (data.value || [])
        .slice()
        .sort((a: any, b: any) => {
          const aDate = toJsDate(a.values[0][inDateIdx]);
          const bDate = toJsDate(b.values[0][inDateIdx]);
          const at = aDate ? aDate.getTime() : -Infinity;
          const bt = bDate ? bDate.getTime() : -Infinity;
          return bt - at;
        })
        .slice(0, 20)
        .map((r: any) => {
          const row = [...r.values[0]];
          const d = toJsDate(row[inDateIdx]);
          row[inDateIdx] = fmtDDMMMYYYY(d);
          return row;
        });
      setRecent(sorted);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  async function loadLists() {
    try {
      const entries = await Promise.all(
        Object.entries(LIST_COL_TABLE).map(async ([header, table]) => [header, await fetchListOptions(table)])
      );
      setListOptions(Object.fromEntries(entries));
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  function onChange(name: string, value: any) {
    setForm((f) => ({ ...f, [name]: value }));
  }

  function toValues() {
    return CONFIG.colMapping.map((c) => (FORMULA_COLS.has(c.header) ? null : form[c.key as keyof typeof form] ?? ""));
  }

  async function save(e?: React.FormEvent) {
    if (e && (e as any).preventDefault) (e as any).preventDefault();
    setErr("");
    setSaving(true);
    try {
      const values = toValues();
      const blankIdx = await findFirstBlankRowIndex();
      if (blankIdx !== null) {
        await patchRowAtIndex(blankIdx, values);
      } else {
        await addRow(values);
      }
      await refresh();
      setForm(defaultForm());
      setPreview(null);
      setNotice("Saved successfully ✅");
      setTimeout(() => setNotice(""), 2000);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

	async function patchRowAtIndexInSession(index, rowValues, sessionId) {
	  const values = CONFIG.colMapping.map((c, i) =>
		FORMULA_COLS.has(c.header) ? null : (rowValues[i] ?? "")
	  );
	  const path = `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows/itemAt(index=${index})/range`;
	  return graphFetchSession(
		path,
		{ method: "PATCH", body: JSON.stringify({ values: [values] }) },
		sessionId
	  );
	}

  async function handlePreview() {
    setErr("");
    setPreview(null);
    setPreviewBusy(true);
    try {
      const rowValues = toValues();
      const sessionId = await createSession(false);
      let blankIdx = await findFirstBlankRowIndexInSession(sessionId);
      let targetIdx: number | null = null;

      if (blankIdx !== null) {
        await patchRowAtIndexInSession(blankIdx, rowValues as any[], sessionId);
        targetIdx = blankIdx;
      } else {
        const added: any = await addRowInSession(rowValues as any[], sessionId);
        targetIdx = added?.index ?? added?.value?.[0]?.index ?? null;
      }

      await calculateInSession(sessionId);
      await new Promise((r) => setTimeout(r, 300));

      let row: any[] = [];
      if (targetIdx !== null) {
        const got: any = await getRowByIndexInSession(targetIdx, sessionId);
        row = got?.values?.[0] || got?.value?.[0]?.values?.[0] || [];
      } else {
        const recent = (await graphFetchSession(
          `${wbPath()}/tables('${encodeURIComponent(CONFIG.tableName)}')/rows?$top=1&$orderby=index desc`,
          { method: "GET" },
          sessionId
        )) as any;
        row = (recent.value || [])[0]?.values?.[0] || [];
      }

      const headers = CONFIG.colMapping.map((c) => c.header);
      const valuesDisp = (row || []).map((v) => String(v ?? ""));
      setPreview({ headers, values: valuesDisp });
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function signIn() {
  if (authBusy) return;            // hard guard
  setAuthBusy(true);
  setErr("");

  try {
    await ensureMsalInitialized();

    // If already signed in, just load data
    const active = msal.getActiveAccount() || msal.getAllAccounts()[0];
    if (active) {
      msal.setActiveAccount(active);
      setAccount(active);
      await Promise.all([refresh(), loadLists()]);
      return;
    }

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const request: any = {
      scopes: ["User.Read", "Files.ReadWrite.All", "Sites.ReadWrite.All", "offline_access"],
      prompt: "select_account",
      redirectUri: CONFIG.redirectUri,
    };

    if (isSafari) {
      await msal.loginRedirect(request);
      return; // continues after redirect
    }

    // Try popup first
    const res = await msal.loginPopup(request);
    if (res?.account) {
      msal.setActiveAccount(res.account);
      setAccount(res.account);
      await Promise.all([refresh(), loadLists()]);
      return;
    }
  } catch (e: any) {
    // If another interaction is already running, just ignore (prevents second window)
    if (e?.errorCode === "interaction_in_progress") {
      return;
    }
    // Popup blocked by browser? Fall back to redirect once.
    if (e?.errorCode === "popup_window_error" || e?.errorCode === "popup_window_open_error") {
      try {
        await msal.loginRedirect({
          scopes: ["User.Read", "Files.ReadWrite.All", "Sites.ReadWrite.All", "offline_access"],
          redirectUri: CONFIG.redirectUri,
        } as any);
        return;
      } catch (e2: any) {
        setErr(e2.message || String(e2));
      }
    } else {
      setErr(e?.message || String(e));
    }
  } finally {
    setAuthBusy(false);
  }
}

  async function signOut() {
    try {
      const acc = msal.getActiveAccount();
      if (acc) {
        await msal.logoutPopup({ account: acc, postLogoutRedirectUri: CONFIG.redirectUri } as any);
      }
    } finally {
      setAccount(null);
      setRecent([]);
      setListOptions({});
      setPreview(null);
    }
  }

  // --- render ---
  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        padding: 12,
        maxWidth: 720,
        margin: "0 auto",
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, rgba(255,240,245,0.8) 0%, rgba(240,255,250,0.8) 33%, rgba(240,248,255,0.8) 66%, rgba(255,250,240,0.8) 100%)",
      }}
    >
      <style>{` 
		/* --- FORM GRID --- */
		.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:12px;row-gap:12px}
			@media (max-width:360px){.form-grid{grid-template-columns:1fr}}

			/* Label-above style */
			.field2{display:flex;flex-direction:column;gap:6px;min-width:0}
			.field2--full{grid-column:1 / -1}
			.field2-label{font-weight:700;font-size:14px;color:#1f2937}

			/* White inputs, consistent height */
			.fi-input{
			  width:100%;min-width:0;box-sizing:border-box;appearance:none;
			  background:#fff;color:#0f172a;
			  border:1px solid #e5e7eb;border-radius:12px;
			  height:52px;padding:12px 14px;font-size:16px;line-height:22px;
			  outline:none;transition:border-color .15s,box-shadow .15s,background .15s
			}
			.fi-input:focus{border-color:#cbd5e1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
			.is-select{padding-right:34px}

			/* Recent tweaks you already wanted */
			.k{font-weight:700}
			.recent-table th{font-weight:700}
		/* --- PREVIEW (no horizontal scroll) --- */
			.preview-grid{
			  display:grid;
			  grid-template-columns:repeat(2,minmax(0,1fr)); /* 2 cols on phones */
			  gap:8px;
			}
			@media (min-width:640px){ .preview-grid{ grid-template-columns:repeat(3,minmax(0,1fr)); } }
			@media (min-width:960px){ .preview-grid{ grid-template-columns:repeat(4,minmax(0,1fr)); } }

			.pv{
			  background:rgba(255,255,255,.7);
			  border:1px solid #eee;
			  border-radius:10px;
			  padding:8px 10px;
			  min-width:0; /* allow wrapping */
			}
			.pv-k{ font-size:12px; color:#6b7280; font-weight:600; margin-bottom:2px; }
			.pv-v{ font-weight:600; word-break:break-word; overflow-wrap:anywhere; }

			/* --- RECENT: stacked cards, responsive grid inside --- */
			.recent-stack{display:grid;grid-template-columns:1fr;row-gap:12px}

			.recent-card{
			  background:rgba(255,255,255,.55);
			  border:1px solid rgba(0,0,0,.06);
			  border-radius:12px;
			  padding:10px 12px;
			  box-shadow:0 1px 4px rgba(0,0,0,.04);  /* very subtle separator */
			}

			/* fields grid inside a card */
			.recent-fields{
			  display:grid;
			  grid-template-columns:repeat(2,minmax(0,1fr)); /* phones: 2 cols */
			  column-gap:12px; row-gap:6px; align-items:baseline;
			}
			@media (min-width:640px){ .recent-fields{ grid-template-columns:repeat(3,minmax(0,1fr)); } }
			@media (min-width:960px){ .recent-fields{ grid-template-columns:repeat(4,minmax(0,1fr)); } }

			/* label/value on one line */
			.rf{display:flex;gap:6px;min-width:0}
			.rf .k{font-weight:400;color:#838991;white-space:nowrap}
			.rf .v{font-weight:500;overflow-wrap:anywhere}
			
			/* Inline minus toggle for numeric inputs */
			.num-wrap{ position:relative; }
			.num-wrap .neg-btn{
			  position:absolute; right:8px; top:50%; transform:translateY(-50%);
			  border:1px solid #e5e7eb; background:#fff; border-radius:8px;
			  padding:2px 6px; font-weight:700; line-height:1; cursor:pointer;
			  box-shadow:0 1px 3px rgba(0,0,0,.06);
			}
			.num-wrap .neg-btn:active{ transform:translateY(-50%) scale(.98); }
		`}
		</style>

      <Header account={account} onSignIn={signIn} onSignOut={signOut} onRefresh={refresh} authBusy={authBusy} />
		<div
		  ref={msgRef}
		  tabIndex={-1}
		  aria-live="assertive"
		  aria-atomic="true"
		  style={{ outline: "none" }}
		>
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
		</div>
     
      <Card tint="rgba(224,255,255,0.6)">
        <h3 style={{ marginTop: 0 }}>Quick Add Trade</h3>
        <form
			onSubmit={save}
			className="form-grid"
			style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
		>
          {mainFields.map((c) => (
			  <Field
				key={c.header}
				label={c.header}
				value={(form as any)[c.key]}
				full={c.header === "Notes"}
			  >
				{renderInput(c, form as any, onChange, listOptions)}
			  </Field>
			))}

          {/* Trade Out toggle */}
          <div style={{ gridColumn: "1 / -1" }}>
            <div
              role="button"
              onClick={() => setShowOut((s) => !s)}
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
                fontWeight: 600,
              }}
            >
              <span>Trade Out</span>
              <span>{showOut ? "▾" : "▸"}</span>
            </div>
          </div>

          {showOut &&
            outFields.map((c) => (
              <Field key={c.header} label={c.header}  value={(form as any)[c.key]}>
                {renderInput(c, form as any, onChange, listOptions)}
              </Field>
            ))}

          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
            <button disabled={!account || previewBusy} onClick={handlePreview} style={btn()}>
              {previewBusy ? "Preparing preview…" : "Preview"}
            </button>
            <button disabled={!account || saving} onClick={(e) => save(e)} style={btn()}>
              {saving ? "Saving…" : "Save Trade"}
            </button>
          </div>
        </form>
      </Card>

      {preview && (
		  <Card tint="rgba(255,228,225,0.6)">
			<h3 style={{ marginTop: 0 }}>Preview (not saved yet)</h3>

			{(() => {
			  // Pair up headers + values and drop blanks, but always show key fields.
			  const ALWAYS_SHOW = new Set([
				"Type","In date","Ticker","Strike","Position","Avg price",
				"Fees","Exp date","Status","Exit price","Proceeds","P&L","Notes"
			  ]);

			  const pairs = (preview.headers || []).map((h, i) => {
				const raw = (preview.values || [])[i];
				const disp = prettyCell(raw, h);
				const isBlank = disp === "" || disp == null;
				return { h, v: disp, isBlank };
			  });

			  const visible = pairs.filter(p => !p.isBlank || ALWAYS_SHOW.has(p.h));

			  return (
				<div className="preview-grid">
				  {visible.map(({ h, v }) => (
					<div className="pv" key={h}>
					  <div className="pv-k">{h}</div>
					  <div className="pv-v">{v}</div>
					</div>
				  ))}
				</div>
			  );
			})()}

			<div style={{ marginTop: 10, display: "flex", gap: 8 }}>
			  <button
				onClick={async () => { await save(new Event("submit") as any); setPreview(null); }}
				style={btn()}
				{...btnHoverProps()}
			  >
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

        {/* Desktop/tablet: compact table with only selected columns */}
        {!isMobile && (
		  <div className="recent-stack">
			{recent.map((row, i) => {
			  const isBlankStatus =
				statusColumnIndex >= 0 &&
				(row[statusColumnIndex] == null ||
				 String(row[statusColumnIndex]).trim() === "");

			  return (
				<div
				  key={i}
				  className="recent-card"
				  style={{ background: isBlankStatus ? "#ffffff" : undefined }}
				>
				  <div className="recent-fields">
					{recentVisibleIdxs.map((j) => {
					  const header = CONFIG.colMapping[j].header;
					  const cell = row[j];
					  const val = prettyCell(cell, header);
					  return (
						<div key={j} className="rf">
						  <span className="k">{header}:</span>
						  <span className="v" style={cellStyle(header, cell)}>
							{val || "-"}
						  </span>
						</div>
					  );
					})}
				  </div>
				</div>
			  );
			})}
		  </div>
		)}


        {/* Mobile: stacked cards, NO horizontal scroll */}
        {isMobile && (
		  <div className="recent-stack">
			{recent.map((row, i) => {
			  const isBlankStatus =
				statusColumnIndex >= 0 &&
				(row[statusColumnIndex] == null ||
				 String(row[statusColumnIndex]).trim() === "");

			  return (
				<div
				  key={i}
				  className="recent-card"
				  style={{ background: isBlankStatus ? "#ffffff" : undefined }}
				>
				  <div className="recent-fields">
					{recentVisibleIdxs.map((j) => {
					  const header = CONFIG.colMapping[j].header;
					  const cell = row[j];
					  const val = prettyCell(cell, header);
					  return (
						<div key={j} className="rf">
						  <span className="k">{header}:</span>
						  <span className="v" style={cellStyle(header, cell)}>
							{val || "-"}
						  </span>
						</div>
					  );
					})}
				  </div>
				</div>
			  );
			})}
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
function Header({ account, onSignIn, onSignOut, onRefresh, authBusy }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
      {!account ? (
        <button onClick={onSignIn} disabled={authBusy} style={btn()} {...btnHoverProps()}>
          {authBusy ? "Signing in…" : "Sign in with Microsoft"}
        </button>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <small style={{ color: "#555" }}>{account.username}</small>
          <button onClick={onRefresh} style={btn("#eee", "#111")} {...btnHoverProps()}>
            Refresh
          </button>
          <button onClick={onSignOut} style={btn("#fee", "#a00")} {...btnHoverProps()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, full }: any) {
  return (
    <label
      className={`field2${full ? " field2--full" : ""}`}
    >
      <span className="field2-label">{label}</span>
      {children}
    </label>
  );
}


function Card({ children, tint = "rgba(255,255,255,0.6)" }: any) {
  return (
    <div
      style={{
        background: tint,
        border: "1px solid rgba(255,255,255,0.45)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        backdropFilter: "blur(10px)",
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function Alert({ children }: any) {
  return (
    <div style={{ background: "#fee", border: "1px solid #fcc", padding: 8, borderRadius: 8, color: "#a00", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function renderInput(c: any, form: any, onChange: any, listOptions: Record<string, string[]>) {
  if (LIST_COL_TABLE[c.header]) {
    const opts = listOptions[c.header] || [];
    const value = form[c.key] ?? "";
    if (!value && opts.length && c.header !== "Status" && form[c.key] === "") onChange(c.key, opts[0]);
    return (
      <select className="fi-input is-select" value={form[c.key] || ""} onChange={(e) => onChange(c.key, e.target.value)}>
        <option value=""></option>
        {opts.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (/date/i.test(c.header)) {
    return <input type="date" className="fi-input" value={form[c.key] || ""} onChange={(e) => onChange(c.key, e.target.value)} />;
  }
  
  // Numeric-ish fields (allow negatives like -1.23) + iOS minus toggle
	if (/price|fees|strike|exit|proceeds|p&l|roi/i.test(c.header)) {
	  const val = form[c.key] ?? "";
	  const toggleNeg = () => {
		const s = String(val || "");
		const next = s.startsWith("-") ? s.slice(1) : ("-" + s.replace(/^-/,""));
		onChange(c.key, next);
	  };
	  return (
		<div className="num-wrap">
		  <input
			type="text"
			inputMode="decimal"
			className="fi-input"
			value={form[c.key] ?? ""}
			onChange={(e) => {
			  const v = e.target.value;
			  if (/^-?$|^-?\.$|^\.$|^-?\d+(\.\d*)?$/.test(v)) onChange(c.key, v);
			}}
		  />
		  <button
			type="button"
			className="neg-btn"
			onClick={() => {
			  const s = String(form[c.key] ?? "");
			  const next = s.startsWith("-") ? s.slice(1) : "-" + s.replace(/^-/,"");
			  onChange(c.key, next);
			}}
		  >
			±
		  </button>
		</div>

	  );
	}

  return (
    <input
	  className="fi-input"
      value={form[c.key] || ""}
      onChange={(e) => onChange(c.key, c.header === "Ticker" ? e.target.value.toUpperCase() : e.target.value)}
      placeholder={c.header === "Ticker" ? "AMZN" : ""}
    />
  );
}

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
    fontWeight: 500,
  } as React.CSSProperties;
}
function btnHoverProps() {
  return {
    onMouseOver: (e: any) => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.15)"),
    onMouseOut: (e: any) => (e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.05)"),
  };
}

// -------------------- formatting helpers --------------------
function toJsDate(val: any) {
  if (val === null || val === "") return null;
  if (typeof val === "number") return new Date(Math.round((val - 25569) * 86400 * 1000));
  const t = Date.parse(val);
  return Number.isNaN(t) ? null : new Date(t);
}
function fmtDDMMMYYYY(dateObj: Date | null) {
  if (!(dateObj instanceof Date) || isNaN(dateObj as any)) return "";
  const d = String(dateObj.getDate()).padStart(2, "0");
  const m = dateObj.toLocaleString("en-GB", { month: "short" });
  const y = dateObj.getFullYear();
  return `${d}-${m}-${y}`;
}
const ZERO_DEC_HEADERS = new Set(["Cost Basis", "Proceeds", "P&L", "Margin"]);
const PCT_HEADERS = new Set(["ROI cb", "Roi"]);
const OUT_YR_HEADER = "Out YR";
const ZERO_DEC_NO_COMMA_HEADERS = new Set(["Out wk", "Time"]);
function isFalseText(v: any) {
  return typeof v === "string" && v.trim().toUpperCase() === "FALSE";
}
function toNumber(v: any) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").trim().replace(/%$/, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
function fmtNumber(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}
function parsePct(v: any) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s.endsWith("%")) return parseFloat(s) / 100;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
function isNumberLike(v: any) {
  if (typeof v === "number") return true;
  if (v == null || v === "") return false;
  return !Number.isNaN(parseFloat(String(v).replace(/,/g, "")));
}
function cellStyle(header: string, raw: any) {
  const h = (header || "").toLowerCase();
  if (h === "p&l") {
    const n = isNumberLike(raw) ? parseFloat(String(raw).replace(/,/g, "")) : null;
    if (n == null) return {};
    if (n > 0) return { background: n > 1000 ? "rgba(34,197,94,0.30)" : "rgba(34,197,94,0.18)" };
    if (n < 0) return { background: "rgba(239,68,68,0.20)" };
    return {};
  }
  if (header.toLowerCase() === "status") {
	  if (raw == null || String(raw).trim() === "") {
		return { background: "#ffffff" }; // blank → white
	  }
	}
  if (h === "roi" || h === "roi cb") {
    const p = parsePct(raw);
    if (p == null) return {};
    return p >= 0 ? { background: "rgba(34,197,94,0.18)" } : { background: "rgba(239,68,68,0.20)" };
    }
  if (h === "status") {
    const COLORS: any = { sold: "#111", assigned: "#e67e22", expired: "#2ecc71", hold: "#1e90ff", savlage: "#b00020" };
    const clr = COLORS[String(raw || "").trim().toLowerCase()];
    return clr ? { color: clr, fontWeight: 600 } : {};
  }
  if (h === "acc") {
    const n = isNumberLike(raw) ? Math.round(parseFloat(String(raw))) : null;
    const ACC_COLORS: any = { 524: "#1aa64a", 577: "#ff8c00", 458: "#7856ff", 44: "#000000" };
    const clr = n != null ? ACC_COLORS[n] : null;
    return { color: clr || "#333", fontWeight: 600 };
  }
  if (h === "term") {
    if (String(raw || "").toUpperCase().includes("LT")) {
      return { background: "rgba(99,102,241,0.20)", fontWeight: 600, borderRadius: 10, padding: "4px 8px" };
    }
  }
  return {};
}
function prettyCell(cell: any, header: string) {
  if (cell === null || cell === undefined || isFalseText(cell)) return "";
  if (/date/i.test(header)) return fmtDDMMMYYYY(toJsDate(cell));
  if (header === OUT_YR_HEADER) {
    const n = toNumber(cell);
    if (n === null || n === 1900) return "";
    return String(n);
  }
  if (ZERO_DEC_NO_COMMA_HEADERS.has(header)) {
    const n = toNumber(cell);
    return n === null ? "" : String(Math.round(n));
  }
  if (PCT_HEADERS.has(header)) {
    const p = parsePct(cell);
    if (p == null) return "";
    return `${fmtNumber((p as number) * 100, 0)}%`;
  }
  if (ZERO_DEC_HEADERS.has(header)) {
    const n = toNumber(cell);
    return n === null ? "" : fmtNumber(n!, 0);
  }
  if (header === "Acc") {
    const n = toNumber(cell);
    return n === null ? String(cell) : String(Math.round(n));
  }
  if (/^position$/i.test(header)) {
    return Number(cell || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (header === "Term") return String(cell);
  const n = toNumber(cell);
  if (n !== null && Number.isFinite(n)) return fmtNumber(n!, 2);
  return String(cell);
}
