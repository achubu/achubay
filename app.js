window.onerror = function(msg, url, line) {
  updateStatus(`Error: ${msg} (Line ${line})`, true);
};

const STORAGE_KEY = 'buyee_inventory_data_v1';

const historicalFxTable = {
  "2026-10": 0.00632, "2026-09": 0.00638, "2026-08": 0.00635, "2026-07": 0.00623,
  "2026-06": 0.00628, "2026-05": 0.00638, "2026-04": 0.00628, "2026-03": 0.00633,
  "2025-10": 0.00685, "2025-09": 0.00676, "2025-08": 0.00680, "2025-07": 0.00678,
  "2024-05": 0.00645, "2023-02": 0.00755
};

let store = {
  activeProjectId: 'Default_Project',
  projects: {
    'Default_Project': {
      id: 'Default_Project',
      name: 'Default Project',
      tariffRate: 10.0,
      items: []
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  loadStoreFromLocalStorage();
  safeCreateIcons();
  renderProjectDropdown();
  loadProjectUI();
  setupGlobalInputs();
  setupDropZone();
});

function safeCreateIcons() {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function updateStatus(msg, isError = false) {
  const statusEl = document.getElementById('uploadStatus');
  if (statusEl) {
    statusEl.innerText = msg;
    statusEl.className = isError 
      ? "text-[11px] font-mono text-rose-300 mt-3 bg-rose-950/80 px-3 py-1 rounded border border-rose-800/50"
      : "text-[11px] font-mono text-indigo-300 mt-3 bg-slate-900/80 px-3 py-1 rounded border border-indigo-900/50";
  }
}

// CORS-compliant translation via MyMemory API
async function fetchTranslation(text) {
  if (!text || typeof text !== 'string') return text;
  const hasJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(text);
  if (!hasJapanese) return text;

  try {
    const cleanQuery = encodeURIComponent(text.trim());
    const url = `https://api.mymemory.translated.net/get?q=${cleanQuery}&langpair=ja|en`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.responseData && data.responseData.translatedText) {
      let result = data.responseData.translatedText;
      // Filter out API quota error messages if rate limited
      if (!result.includes("QUERY LENGTH LIMIT EXCEEDED") && !result.includes("MYMEMORY WARNING")) {
        return result;
      }
    }
  } catch (err) {
    console.warn("Translation API error:", err);
  }
  return text;
}

// Sequential item-by-item translation with live status progress
async function translateItemList(items) {
  if (!items || items.length === 0) return;

  const total = items.length;
  for (let i = 0; i < total; i++) {
    updateStatus(`Translating item ${i + 1} of ${total}...`);
    const item = items[i];
    
    if (item.itemTitle) {
      item.itemTitle = await fetchTranslation(item.itemTitle);
    }
    if (item.seller && item.seller !== "Buyee Seller") {
      item.seller = await fetchTranslation(item.seller);
    }
  }
}

window.translateAllExistingItems = async function() {
  const p = getCurrentProject();
  if (!p.items || p.items.length === 0) {
    alert("No items in list to translate.");
    return;
  }
  
  const button = document.getElementById('translateBtn');
  if (button) button.innerText = "Translating...";

  await translateItemList(p.items);

  updateCalculations();
  if (button) button.innerText = "Translate Titles to English";
  updateStatus("Finished translating item titles!");
  alert(`Finished translating titles!`);
};

window.handleFileSelect = async function(event) {
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    updateStatus(`Selected: ${file.name}. Reading PDF...`);
    await window.processPdfFile(file);
    event.target.value = '';
  } catch(err) {
    updateStatus("File selection error: " + err.message, true);
  }
};

window.processPdfFile = async function(file) {
  if (!file) return;

  try {
    if (typeof pdfjsLib === 'undefined') {
      updateStatus("Error: PDF.js library failed to load.", true);
      alert("PDF.js engine is not loaded on this page.");
      return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    updateStatus("Opening PDF file...");
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    updateStatus(`PDF loaded (${pdf.numPages} pages). Extracting text...`);
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      updateStatus(`Extracting page ${i} of ${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += " " + textContent.items.map(item => item.str).join(' ');
    }

    updateStatus("Parsing Buyee order layout...");
    const parsed = parseBuyeeTextStream(fullText);
    
    if (parsed.length > 0) {
      await translateItemList(parsed);

      getCurrentProject().items = [...parsed, ...getCurrentProject().items];
      updateCalculations();
      updateStatus(`Success: Imported & translated ${parsed.length} orders!`);
      alert(`Successfully imported and translated ${parsed.length} orders!`);
    } else {
      updateStatus("No order records found in PDF format.", true);
      alert("PDF read successfully, but no orders matched the expected Buyee receipt format.");
    }
  } catch (err) {
    updateStatus("PDF Error: " + err.message, true);
    alert("Error reading PDF: " + err.message);
  }
};

function parseBuyeeTextStream(text) {
  const items = [];
  const currentTariff = getCurrentProject().tariffRate || 10;
  const cleanText = text.replace(/Order\s*date([0-9])/gi, 'Order date $1');
  const orderHeaderRegex = /([A-Z0-9]{10,14})\s*Order\s*date\s*(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})/gi;
  const matches = [...cleanText.matchAll(orderHeaderRegex)];

  if (matches.length === 0) return items;

  matches.forEach((match, index) => {
    const orderId = match[1].trim();
    const orderDate = match[2].trim();
    const startIndex = match.index;
    const endIndex = (index < matches.length - 1) ? matches[index + 1].index : cleanText.length;
    const block = cleanText.slice(startIndex, endIndex);

    if (block.includes('out of stock') || block.includes('Order was cancelled')) return;

    let seller = "Buyee Seller";
    const sellerMatch = block.match(/(?:Shop Name|Seller)\s*([^\n\r]+?)(?=\s*(?:Total Amount|After your|Details|Purchase|Transaction|Quantity|Order date|$))/i);
    if (sellerMatch && sellerMatch[1]) seller = sellerMatch[1].replace(/[-–—]\s*$/, '').trim();

    let priceJPY = 0;
    const jpyMatch = block.match(/(?:Requested Item Price|Item Price)\s*:?\s*([\d,]+)\s*YEN/i) || block.match(/Total Amount\s*:?\s*([\d,]+)\s*YEN/i);
    if (jpyMatch) priceJPY = parseFloat(jpyMatch[1].replace(/,/g, '')) || 0;

    let printedUSD = null;
    const usdMatches = [...block.matchAll(/\(US\$\s*([\d,]+\.\d{2})\)/gi)];
    if (usdMatches.length > 0) printedUSD = parseFloat(usdMatches[usdMatches.length - 1][1].replace(/,/g, ''));

    let qty = 1;
    const qtyMatch = block.match(/Quantity\s*(\d+|[lI])\s*item\(s\)/i);
    if (qtyMatch) {
      const rawQty = qtyMatch[1];
      qty = (rawQty === 'l' || rawQty === 'I') ? 1 : (parseInt(rawQty, 10) || 1);
    }

    let rawTitle = "Proxy Purchase Item";
    const qtyIdx = block.search(/Quantity\s*(\d+|[lI])\s*item\(s\)/i);
    if (qtyIdx > 0) {
      let snippet = block.slice(Math.max(0, qtyIdx - 160), qtyIdx).trim();
      snippet = snippet.replace(/.*(?:Purchase request items|Transaction Delivery|Arrived at Warehouse|Shipped|Order Completed|Order Received|Details)\s*/gi, '').trim();
      if (snippet.length > 0) rawTitle = snippet.slice(-120).replace(/^[\s•:-]+/, '').trim();
    }

    if (priceJPY > 0) {
      items.push({
        id: String(Date.now() + index + Math.random()),
        orderDate: orderDate,
        orderId: orderId,
        itemTitle: rawTitle,
        seller: seller,
        qty: qty,
        priceJPY: priceJPY,
        printedUSD: printedUSD,
        tariffPercent: currentTariff,
        selected: false
      });
    }
  });

  return items;
}

window.applyGlobalChangesToAllRows = function() {
  const p = getCurrentProject();
  if (!p.items || p.items.length === 0) {
    alert("No imported lines to update.");
    return;
  }

  const tariffVal = parseFloat(document.getElementById('globalTariffInput')?.value) || 0;
  p.tariffRate = tariffVal;

  p.items.forEach(item => {
    item.tariffPercent = tariffVal;
  });

  updateCalculations();
  alert(`Applied global tariff (${tariffVal}%) to all ${p.items.length} items!`);
};

function setupGlobalInputs() {
  const tariffInput = document.getElementById('globalTariffInput');
  if (tariffInput) tariffInput.addEventListener('input', updateCalculations);
}

function setupDropZone() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('border-indigo-500', 'bg-slate-700/60'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('border-indigo-500', 'bg-slate-700/60'), false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      window.processPdfFile(dt.files[0]);
    }
  }, false);
}

function loadStoreFromLocalStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { store = JSON.parse(saved); } catch (e) { console.error('Failed to parse saved state:', e); }
  }
}

function saveStoreToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getCurrentProject() {
  if (!store.projects[store.activeProjectId]) {
    store.activeProjectId = Object.keys(store.projects)[0] || 'Default_Project';
  }
  return store.projects[store.activeProjectId];
}

function renderProjectDropdown() {
  const select = document.getElementById('projectSelect');
  if (!select) return;
  select.innerHTML = Object.values(store.projects).map(p => 
    `<option value="${p.id}" ${p.id === store.activeProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
}

function loadProjectUI() {
  const p = getCurrentProject();
  if (document.getElementById('globalTariffInput')) document.getElementById('globalTariffInput').value = p.tariffRate;
  updateCalculations();
}

function switchProject(id) {
  store.activeProjectId = id;
  saveStoreToLocalStorage();
  loadProjectUI();
}

function createNewProjectPrompt() {
  const name = prompt("Enter new project name:");
  if (name && name.trim()) {
    const id = 'proj_' + Date.now();
    store.projects[id] = {
      id, name: name.trim(), tariffRate: 10.0, items: []
    };
    store.activeProjectId = id;
    saveStoreToLocalStorage();
    renderProjectDropdown();
    loadProjectUI();
  }
}

function deleteCurrentProject() {
  const keys = Object.keys(store.projects);
  if (keys.length <= 1) {
    alert("Cannot delete the only remaining project.");
    return;
  }
  if (confirm(`Delete project "${getCurrentProject().name}"?`)) {
    delete store.projects[store.activeProjectId];
    store.activeProjectId = Object.keys(store.projects)[0];
    saveStoreToLocalStorage();
    renderProjectDropdown();
    loadProjectUI();
  }
}

// Automatic FX calculation directly from printed receipt USD figure or historical lookup
function getFxRate(item) {
  if (item.printedUSD && item.priceJPY > 0) {
    return item.printedUSD / item.priceJPY;
  }
  if (item.orderDate) {
    const parts = item.orderDate.split(' ');
    if (parts.length >= 3) {
      const monthMap = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
      const key = `${parts[2]}-${monthMap[parts[1]] || '10'}`;
      if (historicalFxTable[key]) return historicalFxTable[key];
    }
  }
  return 0.0064;
}

function updateCalculations() {
  const p = getCurrentProject();
  if (document.getElementById('globalTariffInput')) p.tariffRate = parseFloat(document.getElementById('globalTariffInput').value) || 0;

  const items = p.items;

  let totalBaseUSD = 0, totalTariffUSD = 0, totalLandedUSD = 0;
  items.forEach(item => {
    item.fxRate = getFxRate(item);
    item.unitPriceUSD = item.priceJPY * item.fxRate;
    item.itemCostUSD = item.unitPriceUSD * (item.qty || 1);

    if (item.tariffPercent === undefined) item.tariffPercent = p.tariffRate;
    item.tariffUSD = item.itemCostUSD * (item.tariffPercent / 100);
    item.landedCostUSD = item.itemCostUSD + item.tariffUSD;

    totalBaseUSD += item.itemCostUSD;
    totalTariffUSD += item.tariffUSD;
    totalLandedUSD += item.landedCostUSD;
  });

  const statCount = document.getElementById('statCount');
  if (statCount) statCount.innerText = items.length;

  const statTotalUSD = document.getElementById('statTotalUSD');
  if (statTotalUSD) statTotalUSD.innerText = '$' + totalBaseUSD.toFixed(2);

  const statTariff = document.getElementById('statTotalTariff');
  if (statTariff) statTariff.innerText = '$' + totalTariffUSD.toFixed(2);

  const statLanded = document.getElementById('statTotalLanded');
  if (statLanded) statLanded.innerText = '$' + totalLandedUSD.toFixed(2);

  saveStoreToLocalStorage();
  renderTable();
}

function renderTable() {
  const p = getCurrentProject();
  const tbody = document.getElementById('inventoryTbody');
  if (!tbody) return;
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  tbody.innerHTML = '';

  const filtered = p.items.filter(i => 
    (i.itemTitle||'').toLowerCase().includes(q) || (i.seller||'').toLowerCase().includes(q) || (i.orderId||'').toLowerCase().includes(q)
  );

  const countDisplay = document.getElementById('displayedCountText');
  if (countDisplay) countDisplay.innerText = `Showing ${filtered.length} of ${p.items.length} items`;

  filtered.forEach((item) => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-700/40 border-b border-slate-700/50";
    tr.innerHTML = `
      <td class="p-3 text-center"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleRowSelect('${item.id}')"></td>
      <td class="p-3 text-slate-300 font-mono text-[11px]">${item.orderDate || 'N/A'}</td>
      <td class="p-3 text-slate-400 font-mono text-[11px]">${item.orderId || 'N/A'}</td>
      <td class="p-3 font-medium text-slate-100">
        <input type="text" value="${escapeHtml(item.itemTitle)}" onchange="updateItemValue('${item.id}', 'itemTitle', this.value)" class="bg-transparent border-none w-full text-xs text-slate-100 focus:bg-slate-900 rounded px-1">
      </td>
      <td class="p-3 text-slate-300 truncate max-w-[120px]">${escapeHtml(item.seller)}</td>
      <td class="p-3 text-right"><input type="number" value="${item.qty}" min="1" onchange="updateItemValue('${item.id}', 'qty', parseInt(this.value)||1)" class="w-12 bg-slate-900 text-right px-1 text-xs rounded"></td>
      <td class="p-3 text-right font-mono text-amber-300">$${(item.unitPriceUSD || 0).toFixed(2)}</td>
      <td class="p-3 text-right font-mono font-semibold text-sky-300">$${item.itemCostUSD.toFixed(2)}</td>
      <td class="p-3 text-right"><input type="number" step="0.1" value="${item.tariffPercent}" onchange="updateItemValue('${item.id}', 'tariffPercent', parseFloat(this.value)||0)" class="w-14 bg-slate-900 text-right px-1 text-xs text-rose-300 rounded"></td>
      <td class="p-3 text-right font-mono text-rose-400">$${item.tariffUSD.toFixed(2)}</td>
      <td class="p-3 text-right font-mono font-bold text-emerald-400">$${item.landedCostUSD.toFixed(2)}</td>
      <td class="p-3 text-center"><button onclick="deleteSingleRow('${item.id}')" class="text-slate-400 hover:text-rose-400"><i data-lucide="x" class="w-4 h-4"></i></button></td>
    `;
    tbody.appendChild(tr);
  });
  safeCreateIcons();
}

function updateItemValue(id, key, val) {
  const item = getCurrentProject().items.find(i => String(i.id) === String(id));
  if (item) { item[key] = val; updateCalculations(); }
}

function addNewRow() {
  const p = getCurrentProject();
  p.items.unshift({
    id: String(Date.now() + Math.random()),
    orderDate: '7 Oct 2026', orderId: `ORD-${Math.floor(Math.random()*90000)}`,
    itemTitle: 'New Item Description', seller: 'Mercari Seller', qty: 1, priceJPY: 10000,
    tariffPercent: p.tariffRate, selected: false
  });
  updateCalculations();
}

function toggleRowSelect(id) { const i = getCurrentProject().items.find(x => String(x.id) === String(id)); if(i) i.selected = !i.selected; }
function toggleSelectAll(chk) { getCurrentProject().items.forEach(i => i.selected = chk.checked); renderTable(); }
function deleteSingleRow(id) { getCurrentProject().items = getCurrentProject().items.filter(i => String(i.id) !== String(id)); updateCalculations(); }
function deleteSelectedRows() { getCurrentProject().items = getCurrentProject().items.filter(i => !i.selected); updateCalculations(); }
function clearAllItems() { if(confirm('Clear all items in active project?')) { getCurrentProject().items = []; updateCalculations(); } }

function exportToExcel() {
  const items = getCurrentProject().items;
  const exportData = items.map((item, idx) => ({
    'Row #': idx + 1, 'Date': item.orderDate, 'Order ID': item.orderId,
    'Item Title': item.itemTitle, 'Seller': item.seller, 'Qty': item.qty,
    'Unit Price ($USD)': item.unitPriceUSD.toFixed(2),     'Base Cost ($ USD)': item.itemCostUSD.toFixed(2), 'Tariff Rate (%)': item.tariffPercent + '%',
    'Tariff ($USD)': item.tariffUSD.toFixed(2), 'Landed Cost ($ USD)': item.landedCostUSD.toFixed(2)
  }));
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  XLSX.writeFile(wb, `${getCurrentProject().name}_Report.xlsx`);
}

function exportBackupJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(store, null, 2));
  const dlAnchor = document.createElement('a');
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `buyee_inventory_backup_${Date.now()}.json`);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();
}

function importBackupJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      store = JSON.parse(e.target.result);
      saveStoreToLocalStorage();
      renderProjectDropdown();
      loadProjectUI();
      alert('Backup restored successfully!');
    } catch (err) {
      alert('Invalid JSON backup file.');
    }
  };
  reader.readAsText(file);
}

function escapeHtml(s) { return (s||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }