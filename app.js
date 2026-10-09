/**
 * Buyee Shipping Manifest & Landed Cost Parser
 * Parses Buyee "Breakdown of Expenses" PDFs (or pasted text) into line items,
 * then allocates shipping, customs duty and service fees to each item.
 */

const PDFJS_VERSION = '3.11.174';

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
}

let currentParsedData = null;

/* ------------------------------------------------------------------ */
/* Pure parsing helpers (no DOM) — also usable from Node for testing   */
/* ------------------------------------------------------------------ */

function normalizeLine(s) {
  return String(s)
    .replace(/：/g, ':')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[ \t　 ]+/g, ' ')
    .trim();
}

function toNum(s) {
  if (s == null) return 0;
  const neg = /^\s*[-−–]/.test(s);
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

const NUM = '-?[\\d,]+';
const LABEL_VALUE_RE = new RegExp(`^(.+?)\\s+(${NUM})\\s*(?:YEN|円|JPY)?$`, 'i');
const ONLY_NUM_RE = new RegExp(`^(${NUM})\\s*(?:YEN|円|JPY)?$`, 'i');
const SITE_RE = /^Shopping\s*Site\s*\(ID\)\s*(.+?)\s*\(\s*([A-Za-z0-9_-]{6,})\s*\)\s*$/i;
const ORDER_ID_RE = /\(\s*([A-Za-z]{0,3}\d{6,}[A-Za-z0-9_-]*)\s*\)/g;

/** Turn pdf.js text items into reading-order lines (grouped by Y, sorted by X). */
function itemsToLines(items) {
  const parts = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str }));
  parts.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  for (const p of parts) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - p.y) <= 2) {
      last.parts.push(p);
    } else {
      lines.push({ y: p.y, parts: [p] });
    }
  }
  return lines.map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.s.trim()).join('  '));
}

/** Parse a label/value section (e.g. "Other Service Fees") until the next heading. */
function parseAmountSection(lines) {
  const rows = [];
  let total = null;
  let pendingLabel = null;
  for (const line of lines) {
    if (/^\(?Currency/i.test(line)) continue;
    let m = line.match(LABEL_VALUE_RE);
    if (m) {
      const label = m[1].trim();
      const amount = toNum(m[2]);
      if (/^Total\s*Amount$/i.test(label)) total = amount;
      else rows.push({ label, amount });
      pendingLabel = null;
      continue;
    }
    m = line.match(ONLY_NUM_RE);
    if (m && pendingLabel) {
      if (/^Total\s*Amount$/i.test(pendingLabel)) total = toNum(m[1]);
      else rows.push({ label: pendingLabel, amount: toNum(m[1]) });
      pendingLabel = null;
      continue;
    }
    pendingLabel = line;
  }
  if (total === null) total = rows.reduce((a, r) => a + r.amount, 0);
  return { rows, total };
}

/** Split an integer total across weights so the parts add up exactly (largest remainder). */
function allocate(total, weights) {
  const n = weights.length;
  if (!n || !total) return new Array(n).fill(0);
  let sumW = weights.reduce((a, w) => a + Math.max(w, 0), 0);
  const w = sumW > 0 ? weights.map(x => Math.max(x, 0)) : new Array(n).fill(1);
  sumW = sumW > 0 ? sumW : n;
  const raw = w.map(x => (total * x) / sumW);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && rem > 0; k++, rem--) out[order[k][1]]++;
  return out;
}

function baseLabel(label) {
  return label.replace(/\(.*$/, '').trim().toLowerCase();
}

function parseManifest(rawText, fileName) {
  const lines = rawText.replace(/\r/g, '').split('\n').map(normalizeLine).filter(Boolean);
  const text = lines.join('\n');

  const pick = (re, def = 'N/A') => { const m = text.match(re); return m ? m[1].trim() : def; };
  // Value may sit on a later line (two-column layout), so allow a short gap and require digits.
  let packageRef = pick(/Package\s*Reference\s*No\.?\s*:?[\s\S]{0,60}?\b([A-Z]{0,4}\d{6,}[A-Z0-9]*)\b/i);
  if (packageRef === 'N/A') {
    const fm = String(fileName || '').match(/[A-Z]\d{8,}/);
    if (fm) packageRef = fm[0];
  }
  const delivDate = pick(/Date\s*of\s*Delivery\s*:?\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i);
  const trackingNo = pick(/Shipment\s*Tracking\s*No\.?\s*:?[\s\S]{0,60}?\b([A-Z]{0,6}\d{6,}[A-Z0-9]*)\b/i);
  const deliveryMethod = pick(/Delivery\s*Method\s*:?\s*([^\n]+)/i);
  const weightG = toNum(pick(/Total\s*Package\s*Weight\s*:?\s*([\d,]+)\s*g/i, '0'));

  // Locate section headings
  const findIdx = (re, from = 0) => {
    for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
    return -1;
  };
  const iOther = findIdx(/^Other\s*Service\s*Fees$/i);
  const iShip = findIdx(/^Shipping\s*Expenses$/i);
  const iDuty = findIdx(/^Customs\s*Duties/i);
  const iGrand = findIdx(/^Grand\s*Total\s*Payment\s*Amount/i);
  const iFeeBreak = findIdx(/Breakdown\s*of\s*Other\s*Service\s*Fees/i);
  const iPayBreak = findIdx(/Breakdown\s*of\s*Payment\s*amount/i);

  const headingIdx = [iOther, iShip, iDuty, iGrand, iFeeBreak, iPayBreak].filter(i => i >= 0);
  const nextHeading = (i) => {
    const after = headingIdx.filter(h => h > i);
    return after.length ? Math.min(...after) : lines.length;
  };

  /* ---------- Items ---------- */
  const firstItem = findIdx(SITE_RE);
  const itemsEnd = firstItem >= 0 ? (headingIdx.filter(h => h > firstItem).length ? nextHeading(firstItem) : lines.length) : -1;
  const rawItems = [];
  if (firstItem >= 0) {
    let cur = null;
    let pending = null;
    const assign = (label, val) => {
      if (!cur) return;
      if (/^Quantity$/i.test(label)) cur.qty = Math.abs(val) || 1;
      else if (/^Item\s*Price$/i.test(label)) cur.origPrice = val;
      else if (/^Coupon/i.test(label)) cur.coupon = Math.abs(val);
      else if (/^Total\s*Amount$/i.test(label)) cur.netPrice = val;
    };
    for (let i = firstItem; i < itemsEnd; i++) {
      const line = lines[i];
      const sm = line.match(SITE_RE);
      if (sm) {
        cur = { orderId: sm[2], siteName: sm[1].trim(), nameParts: [], qty: 1, origPrice: 0, coupon: 0, netPrice: null };
        rawItems.push(cur);
        pending = null;
        continue;
      }
      if (!cur) continue;
      const lm = line.match(/^(Quantity|Item\s*Price|Coupon\s*discount|Total\s*Amount)\s*:?\s*(-?[\d,]+)?\s*$/i);
      if (lm) {
        if (lm[2] !== undefined) assign(lm[1], toNum(lm[2]));
        else pending = lm[1];
        continue;
      }
      const om = line.match(ONLY_NUM_RE);
      if (om && pending) { assign(pending, toNum(om[1])); pending = null; continue; }
      if (/^Item\s*Name\b/i.test(line)) {
        const rest = line.replace(/^Item\s*Name\s*:?\s*/i, '');
        if (rest) cur.nameParts.push(rest);
        continue;
      }
      if (/^Item\s*Price$/i.test(line)) continue;
      if (cur.origPrice === 0) cur.nameParts.push(line); // still inside the name block
    }
  }
  rawItems.forEach(it => {
    it.itemName = it.nameParts.join(' ').replace(/\s+/g, ' ').trim() || 'Item';
    delete it.nameParts;
    if (it.netPrice === null) it.netPrice = it.origPrice - it.coupon;
  });

  /* ---------- Charge sections ---------- */
  const section = (i) => (i >= 0 ? parseAmountSection(lines.slice(i + 1, nextHeading(i))) : { rows: [], total: 0 });
  const otherFees = section(iOther);
  const shipping = section(iShip);
  const duties = section(iDuty);

  let grandTotal = null;
  if (iGrand >= 0) {
    const m = lines.slice(iGrand, iGrand + 3).join(' ').match(/([\d,]{3,})\s*(?:YEN|円|JPY)/i);
    if (m) grandTotal = toNum(m[1]);
  }

  /* ---------- Per-item fee breakdown ---------- */
  const knownIds = new Set(rawItems.map(i => i.orderId));
  const feeAssignments = {}; // orderId -> [{label, amount}]
  const allocatedFeeLabels = new Set();
  if (iFeeBreak >= 0 && otherFees.rows.length) {
    const end = iPayBreak > iFeeBreak ? iPayBreak : lines.length;
    const block = lines.slice(iFeeBreak + 1, end);
    const feeBases = otherFees.rows.map(r => ({ base: baseLabel(r.label), row: r }));

    // split into sub-sections, each starting with "<fee label> <total>"
    const subs = [];
    for (const line of block) {
      const m = line.match(LABEL_VALUE_RE);
      const fee = m && feeBases.find(f => f.base && baseLabel(m[1]) === f.base);
      if (fee) { subs.push({ fee: fee.row, total: toNum(m[2]), lines: [] }); continue; }
      if (subs.length) subs[subs.length - 1].lines.push(line);
    }

    for (const sub of subs) {
      const body = sub.lines.filter(l => !/^(Shopping\s*Site|\(ID\)|\(?Currency)/i.test(l));
      const ids = [];
      const prices = [];
      for (const l of body) {
        for (const m of l.matchAll(ORDER_ID_RE)) if (knownIds.has(m[1])) ids.push(m[1]);
        const pm = l.match(/(?:^|\s)([\d,]+)\s*$/);
        if (pm && !/\)\s*$/.test(l)) prices.push(toNum(pm[1]));
      }
      let pairs = null;
      if (ids.length && ids.length === prices.length) {
        pairs = ids.map((id, k) => [id, prices[k]]);
      } else if (ids.length && sub.total % ids.length === 0) {
        pairs = ids.map(id => [id, sub.total / ids.length]);
      }
      if (pairs && pairs.reduce((a, p) => a + p[1], 0) === sub.total) {
        for (const [id, amt] of pairs) {
          (feeAssignments[id] = feeAssignments[id] || []).push({ label: baseLabel(sub.fee.label), amount: amt });
        }
        allocatedFeeLabels.add(sub.fee.label);
      }
    }
  }

  /* ---------- Allocation ---------- */
  const weights = rawItems.map(i => i.netPrice);
  const shipSplit = allocate(shipping.total, weights);
  const dutySplit = allocate(duties.total, weights);
  const sharedFeeRows = otherFees.rows.filter(r => !allocatedFeeLabels.has(r.label));
  const sharedFeeTotal = sharedFeeRows.reduce((a, r) => a + r.amount, 0);
  const sharedFeeSplit = allocate(sharedFeeTotal, weights);

  const items = rawItems.map((item, idx) => {
    const direct = feeAssignments[item.orderId] || [];
    const directTotal = direct.reduce((a, f) => a + f.amount, 0);
    const splitShipping = shipSplit[idx];
    const splitDuty = dutySplit[idx];
    const splitFees = directTotal + sharedFeeSplit[idx];
    const feeDetail = [
      ...direct.map(f => `${f.label}: ¥${f.amount.toLocaleString()}`),
      ...(sharedFeeSplit[idx] ? [`share of ${sharedFeeRows.map(r => baseLabel(r.label)).join(' + ')}: ¥${sharedFeeSplit[idx].toLocaleString()}`] : []),
    ].join('\n');
    const landedCost = item.netPrice + splitShipping + splitDuty + splitFees;
    return { ...item, splitShipping, splitDuty, splitFees, feeDetail, landedCost };
  });

  const totalNetItemsCost = items.reduce((a, i) => a + i.netPrice, 0);
  const grandTotalLanded = items.reduce((a, i) => a + i.landedCost, 0);

  return {
    fileName,
    packageRef,
    delivDate,
    trackingNo,
    deliveryMethod,
    weightG,
    intlShipping: shipping.total,
    customsDuty: duties.total,
    otherFees: otherFees.total,
    charges: {
      otherFees: otherFees.rows,
      shipping: shipping.rows,
      duties: duties.rows,
    },
    totalNetItemsCost,
    grandTotalLanded,
    invoiceGrandTotal: grandTotal,
    reconciles: grandTotal === null ? null : grandTotal === grandTotalLanded,
    items,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseManifest, itemsToLines, allocate };
}

/* ------------------------------------------------------------------ */
/* Browser UI                                                          */
/* ------------------------------------------------------------------ */

function refreshIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    try { lucide.createIcons(); } catch (e) { /* icons are cosmetic */ }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    refreshIcons();
  });
}

function setupEventListeners() {
  const dropZone = document.getElementById('dropZone');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const searchInput = document.getElementById('searchInput');
  const tabPdf = document.getElementById('tabPdf');
  const tabPaste = document.getElementById('tabPaste');
  const pasteZone = document.getElementById('pasteZone');
  const parseTextBtn = document.getElementById('parseTextBtn');

  const activeTab = "text-xs font-semibold text-brand-400 border-b-2 border-brand-500 pb-1";
  const idleTab = "text-xs font-semibold text-slate-400 hover:text-slate-200 pb-1";

  tabPdf.addEventListener('click', () => {
    dropZone.classList.remove('hidden');
    pasteZone.classList.add('hidden');
    tabPdf.className = activeTab;
    tabPaste.className = idleTab;
  });

  tabPaste.addEventListener('click', () => {
    dropZone.classList.add('hidden');
    pasteZone.classList.remove('hidden');
    tabPaste.className = activeTab;
    tabPdf.className = idleTab;
  });

  dropZone.addEventListener('click', () => pdfFileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-brand-500'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-brand-500'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-brand-500');
    if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  });

  pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
    e.target.value = ''; // allow re-selecting the same file
  });

  parseTextBtn.addEventListener('click', () => {
    const text = document.getElementById('rawTextArea').value;
    if (text.trim()) runParse(text, 'Pasted_Manifest.txt');
    else showStatus('Please paste text into the box first.', true);
  });

  searchInput.addEventListener('input', (e) => renderTable(e.target.value.toLowerCase()));

  document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
  document.getElementById('exportJsonBtn').addEventListener('click', exportToJSON);
}

async function handleFileUpload(file) {
  showStatus(`Reading file: ${file.name}...`, false);

  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF library failed to load. Check your internet connection and reload.');
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/standard_fonts/`,
      }).promise;

      let fullText = '';
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        fullText += itemsToLines(textContent.items).join('\n') + '\n';
      }

      if (fullText.trim().length < 30) {
        showStatus(`Scanned image PDF detected in ${file.name}. Running OCR...`, false);
        fullText = await performOcrOnPdf(pdf);
      }

      document.getElementById('rawTextArea').value = fullText;
      runParse(fullText, file.name);
    } else {
      const text = await file.text();
      document.getElementById('rawTextArea').value = text;
      runParse(text, file.name);
    }
  } catch (err) {
    console.error('PDF Processing Error:', err);
    showStatus(`Error reading file: ${err.message}`, true);
  }
}

async function performOcrOnPdf(pdf) {
  if (typeof Tesseract === 'undefined') {
    showStatus('OCR engine not loaded. Check internet connection.', true);
    return '';
  }
  const worker = await Tesseract.createWorker('eng');
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  let ocrText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    showStatus(`OCR: scanning page ${pageNum} of ${pdf.numPages}...`, false);
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise;
    const { data } = await worker.recognize(canvas);
    ocrText += data.text + '\n';
  }
  await worker.terminate();
  return ocrText;
}

function runParse(text, fileName) {
  try {
    currentParsedData = parseManifest(text, fileName);
  } catch (err) {
    console.error(err);
    showStatus(`Parse error: ${err.message}`, true);
    return;
  }
  updateMetrics();
  renderCharges();
  renderTable(document.getElementById('searchInput').value.toLowerCase());

  const d = currentParsedData;
  if (!d.items.length) {
    showStatus("Document read, but no line items matched. Open 'Paste / View Raw Text' to inspect the extracted text.", true);
    return;
  }
  let msg = `Extracted ${d.items.length} item(s) from ${fileName}.`;
  if (d.reconciles === true) msg += ` Totals match the invoice grand total (¥${d.invoiceGrandTotal.toLocaleString()}).`;
  else if (d.reconciles === false) msg += ` Warning: computed total ¥${d.grandTotalLanded.toLocaleString()} differs from invoice ¥${d.invoiceGrandTotal.toLocaleString()}.`;
  showStatus(msg, d.reconciles === false);
}

function showStatus(msg, isError) {
  const alertEl = document.getElementById('statusAlert');
  document.getElementById('statusMessage').textContent = msg;
  alertEl.classList.remove('hidden');
  alertEl.className = isError
    ? 'p-3 rounded-lg text-xs flex items-center justify-between bg-red-950/80 border border-red-800 text-red-200'
    : 'p-3 rounded-lg text-xs flex items-center justify-between bg-emerald-950/80 border border-emerald-800 text-emerald-200';
}

const yen = (n) => `¥${(n || 0).toLocaleString()}`;

function updateMetrics() {
  const d = currentParsedData;
  if (!d) return;
  document.getElementById('metricTotalItems').textContent = d.items.length;
  document.getElementById('metricManifestRef').textContent = `Ref: ${d.packageRef}`;
  document.getElementById('metricNetCost').textContent = yen(d.totalNetItemsCost);
  document.getElementById('metricShipping').textContent = yen(d.intlShipping);
  document.getElementById('metricDuty').textContent = yen(d.customsDuty);
  document.getElementById('metricFees').textContent = yen(d.otherFees);
  document.getElementById('metricGrandTotal').textContent = yen(d.grandTotalLanded);
  const rec = document.getElementById('metricReconcile');
  if (d.reconciles === true) { rec.textContent = '✓ matches invoice'; rec.className = 'text-[11px] text-emerald-400 mt-1'; }
  else if (d.reconciles === false) { rec.textContent = `Invoice: ${yen(d.invoiceGrandTotal)}`; rec.className = 'text-[11px] text-red-400 mt-1'; }
  else { rec.textContent = ''; }
}

function renderCharges() {
  const el = document.getElementById('chargesBody');
  const wrap = document.getElementById('chargesSection');
  const d = currentParsedData;
  if (!d) return;
  const groups = [
    ['Shipping', d.charges.shipping, 'text-blue-400'],
    ['Customs / Tariffs', d.charges.duties, 'text-amber-400'],
    ['Service Fees', d.charges.otherFees, 'text-slate-300'],
  ];
  const info = [
    ['Delivery date', d.delivDate],
    ['Method', d.deliveryMethod],
    ['Tracking', d.trackingNo],
    ['Weight', d.weightG ? `${d.weightG.toLocaleString()} g` : 'N/A'],
  ];
  el.innerHTML = `
    <div>
      <h3 class="text-slate-400 text-[11px] uppercase tracking-wide mb-2">Package</h3>
      ${info.map(([k, v]) => `<div class="flex justify-between gap-4 py-0.5"><span class="text-slate-500">${k}</span><span class="text-slate-200 font-mono">${escapeHtml(v)}</span></div>`).join('')}
    </div>
    ${groups.map(([title, rows, cls]) => `
      <div>
        <h3 class="text-slate-400 text-[11px] uppercase tracking-wide mb-2">${title}</h3>
        ${rows.length ? rows.map(r => `<div class="flex justify-between gap-4 py-0.5"><span class="text-slate-300">${escapeHtml(r.label)}</span><span class="${cls} font-mono">${yen(r.amount)}</span></div>`).join('') : '<div class="text-slate-600">None</div>'}
      </div>`).join('')}
  `;
  wrap.classList.remove('hidden');
}

function renderTable(filterQuery = '') {
  const tbody = document.getElementById('manifestTableBody');
  tbody.innerHTML = '';

  if (!currentParsedData || currentParsedData.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-6 text-center text-slate-500">No line items found in manifest.</td></tr>`;
    return;
  }

  const filtered = currentParsedData.items.filter(item =>
    item.orderId.toLowerCase().includes(filterQuery) ||
    item.itemName.toLowerCase().includes(filterQuery) ||
    item.siteName.toLowerCase().includes(filterQuery));

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40 transition-colors';
    tr.innerHTML = `
      <td class="p-3 text-slate-200 font-semibold">${escapeHtml(item.orderId)}</td>
      <td class="p-3 text-slate-400">${escapeHtml(item.siteName)}</td>
      <td class="p-3 text-slate-100 max-w-xs truncate font-sans" title="${escapeHtml(item.itemName)}">${escapeHtml(item.itemName)}</td>
      <td class="p-3 text-right text-slate-400">${item.qty}</td>
      <td class="p-3 text-right text-slate-400">${yen(item.origPrice)}${item.coupon ? `<div class="text-[10px] text-rose-400">-${yen(item.coupon)}</div>` : ''}</td>
      <td class="p-3 text-right text-emerald-400 font-medium">${yen(item.netPrice)}</td>
      <td class="p-3 text-right text-blue-400">+${yen(item.splitShipping)}</td>
      <td class="p-3 text-right text-amber-400">+${yen(item.splitDuty)}</td>
      <td class="p-3 text-right text-slate-400 cursor-help" title="${escapeHtml(item.feeDetail)}">+${yen(item.splitFees)}</td>
      <td class="p-3 text-right text-purple-300 font-bold bg-purple-950/20">${yen(item.landedCost)}</td>
    `;
    tbody.appendChild(tr);
  });

  const d = currentParsedData;
  const tr = document.createElement('tr');
  tr.className = 'bg-slate-950/70 font-bold';
  tr.innerHTML = `
    <td class="p-3 text-slate-300" colspan="5">Total (${d.items.length} items)</td>
    <td class="p-3 text-right text-emerald-400">${yen(d.totalNetItemsCost)}</td>
    <td class="p-3 text-right text-blue-400">${yen(d.intlShipping)}</td>
    <td class="p-3 text-right text-amber-400">${yen(d.customsDuty)}</td>
    <td class="p-3 text-right text-slate-300">${yen(d.otherFees)}</td>
    <td class="p-3 text-right text-purple-300 bg-purple-950/20">${yen(d.grandTotalLanded)}</td>`;
  tbody.appendChild(tr);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportToCSV() {
  if (!currentParsedData) return showStatus('Nothing to export yet — load a manifest first.', true);
  const d = currentParsedData;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Package Ref', 'Delivery Date', 'Order ID', 'Site', 'Item Name', 'Qty', 'Item Price', 'Coupon', 'Net Price', 'Shipping', 'Duty', 'Fees', 'Fee Detail', 'Landed Cost'];
  const rows = d.items.map(i => [
    q(d.packageRef), q(d.delivDate), q(i.orderId), q(i.siteName), q(i.itemName), i.qty,
    i.origPrice, i.coupon, i.netPrice, i.splitShipping, i.splitDuty, i.splitFees, q(i.feeDetail.replace(/\n/g, '; ')), i.landedCost,
  ]);
  rows.push([q('TOTAL'), '', '', '', '', '', '', '', d.totalNetItemsCost, d.intlShipping, d.customsDuty, d.otherFees, '', d.grandTotalLanded]);
  // BOM so Excel shows Japanese item names correctly
  const csv = '﻿' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  downloadBlob(csv, 'text/csv;charset=utf-8', `Buyee_Landed_Cost_${d.packageRef}.csv`);
}

function exportToJSON() {
  if (!currentParsedData) return showStatus('Nothing to export yet — load a manifest first.', true);
  downloadBlob(JSON.stringify(currentParsedData, null, 2), 'application/json', `Buyee_Landed_Cost_${currentParsedData.packageRef}.json`);
}
