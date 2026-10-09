// PDF.js Worker Configuration
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

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
      shippingUSD: 0.0,
      feesUSD: 0.0,
      allocationStrategy: 'proportional',
      fxMode: 'receipt',
      items: []
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  loadStoreFromLocalStorage();
  lucide.createIcons();
  renderProjectDropdown();
  loadProjectUI();
  setupGlobalInputs();
  setupFileInputs();
  setupDropZone();
});

// Free client-side translation helper (Japanese to English)
async function translateText(text) {
  if (!text || typeof text !== 'string') return text;
  // Check if text contains Japanese Kanji, Hiragana, or Katakana
  const hasJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(text);
  if (!hasJapanese) return text;

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data[0]) {
      return data[0].map(item => item[0]).join('');
    }
  } catch (err) {
    console.warn("Translation failed, keeping original:", err);
  }
  return text;
}

// Function to translate all saved items in the active project
async function translateAllExistingItems() {
  const p = getCurrentProject();
  if (!p.items || p.items.length === 0) {
    alert("No items to translate.");
    return;
  }
  
  const button = document.getElementById('translateBtn');
  if (button) button.innerText = "Translating...";

  for (let item of p.items) {
    item.itemTitle = await translateText(item.itemTitle);
    item.seller = await translateText(item.seller);
  }

  updateCalculations();
  if (button) button.innerText = "Translate to English";
  alert("Translation complete!");
}

function setupGlobalInputs() {
  const tariffInput = document.getElementById('globalTariffInput');
  if (tariffInput) tariffInput.addEventListener('input', handleGlobalTariffChange);

  const shippingInput = document.getElementById('globalShippingInput');
  if (shippingInput) shippingInput.addEventListener('input', updateCalculations);

  const feesInput = document.getElementById('globalFeesInput');
  if (feesInput) feesInput.addEventListener('input', updateCalculations);

  const allocSelect = document.getElementById('allocationStrategy');
  if (allocSelect) allocSelect.addEventListener('change', updateCalculations);

  const fxSelect = document.getElementById('fxMode');
  if (fxSelect) fxSelect.addEventListener('change', updateCalculations);
}

function handleGlobalTariffChange() {
  const val = parseFloat(document.getElementById('globalTariffInput').value) || 0;
  const p = getCurrentProject();
  p.tariffRate = val;
  p.items.forEach(item => { item.tariffPercent = val; });
  updateCalculations();
}

function setupFileInputs() {
  const inputs = document.querySelectorAll('input[type="file"]');
  inputs.forEach(input => {
    input.removeEventListener('change', window.handleFileSelect);
    input.addEventListener('change', window.handleFileSelect);
  });
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
  document.getElementById('globalTariffInput').value = p.tariffRate;
  document.getElementById('globalShippingInput').value = p.shippingUSD;
  document.getElementById('globalFeesInput').value = p.feesUSD;
  document.getElementById('allocationStrategy').value = p.allocationStrategy;
  document.getElementById('fxMode').value = p.fxMode;
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
      id, name: name.trim(), tariffRate: 10.0, shippingUSD: 0.0,
      feesUSD: 0.0, allocationStrategy: 'proportional', fxMode: 'receipt', items: []
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

function getFxRate(item, fxMode) {
  if (fxMode === 'fixed') return 1 / 150;
  if (fxMode === 'receipt' && item.printedUSD && item.priceJPY > 0) return item.printedUSD / item.priceJPY;
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
  p.tariffRate = parseFloat(document.getElementById('globalTariffInput').value) || 0;
  p.shippingUSD = parseFloat(document.getElementById('globalShippingInput').value) || 0;
  p.feesUSD = parseFloat(document.getElementById('globalFeesInput').value) || 0;
  p.allocationStrategy = document.getElementById('allocationStrategy').value;
  p.fxMode = document.getElementById('fxMode').value;

  const items = p.items;
  const totalQty = items.reduce((acc, i) => acc + (i.qty || 1), 0);

  let totalItemCostUSD = 0;
  items.forEach(item => {
    item.fxRate = getFxRate(item, p.fxMode);
    item.unitPriceUSD = item.priceJPY * item.fxRate;
    item.itemCostUSD = item.unitPriceUSD * (item.qty || 1);
    totalItemCostUSD += item.itemCostUSD;
  });

  items.forEach(item => {
    if (totalQty > 0) {
      if (p.allocationStrategy === 'equal') {
        item.shippingUSD = p.shippingUSD / totalQty;
        item.feeUSD = p.feesUSD / totalQty;
      } else {
        const ratio = totalItemCostUSD > 0 ? (item.itemCostUSD / totalItemCostUSD) : (1 / totalQty);
        item.shippingUSD = p.shippingUSD * ratio;
        item.feeUSD = p.feesUSD * ratio;
      }
    } else {
      item.shippingUSD = 0;
      item.feeUSD = 0;
    }

    if (item.tariffPercent === undefined) item.tariffPercent = p.tariffRate;
    item.tariffUSD = item.itemCostUSD * (item.tariffPercent / 100);
    item.landedCostUSD = item.itemCostUSD + item.shippingUSD + item.feeUSD + item.tariffUSD;
  });

  let totalBaseUSD = 0, totalFreightFeesUSD = 0, totalTariffUSD = 0, totalLandedUSD = 0;
  items.forEach(i => {
    totalBaseUSD += i.itemCostUSD;
    totalFreightFeesUSD += (i.shippingUSD + i.feeUSD);
    totalTariffUSD += i.tariffUSD;
    totalLandedUSD += i.landedCostUSD;
  });

  const statCount = document.getElementById('statCount');
  if (statCount) statCount.innerText = items.length;

  const statTotalJPY = document.getElementById('statTotalJPY');
  if (statTotalJPY) statTotalJPY.innerText = '$' + totalBaseUSD.toFixed(2); // Convert metric box to USD

  const statTotalUSD = document.getElementById('statTotalUSD');
  if (statTotalUSD) statTotalUSD.innerText = '$' + totalBaseUSD.toFixed(2);

  const statFreight = document.getElementById('statTotalFreightFees');
  if (statFreight) statFreight.innerText = '$' + totalFreightFeesUSD.toFixed(2);

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
      <td class="p-3 text-right font-mono text-slate-400 text-[11px]">$${item.fxRate.toFixed(5)}</td>
      <td class="p-3 text-right font-mono font-semibold text-sky-300">$${item.itemCostUSD.toFixed(2)}</td>
      <td class="p-3 text-right font-mono text-slate-300 text-[11px]">$${item.shippingUSD.toFixed(2)}</td>
      <td class="p-3 text-right font-mono text-slate-300 text-[11px]">$${item.feeUSD.toFixed(2)}</td>
      <td class="p-3 text-right"><input type="number" step="0.1" value="${item.tariffPercent}" onchange="updateItemValue('${item.id}', 'tariffPercent', parseFloat(this.value)||0)" class="w-14 bg-slate-900 text-right px-1 text-xs text-rose-300 rounded"></td>
      <td class="p-3 text-right font-mono text-rose-400">$${item.tariffUSD.toFixed(2)}</td>
      <td class="p-3 text-right font-mono font-bold text-emerald-400">$${item.landedCostUSD.toFixed(2)}</td>
      <td class="p-3 text-center"><button onclick="deleteSingleRow('${item.id}')" class="text-slate-400 hover:text-rose-400"><i data-lucide="x" class="w-4 h-4"></i></button></td>
    `;
    tbody.appendChild(tr);
  });
  lucide.createIcons();
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
    shippingUSD: 0, feeUSD: 0, tariffPercent: p.tariffRate, selected: false
  });
  updateCalculations();
}

function toggleRowSelect(id) { const i = getCurrentProject().items.find(x => String(x.id) === String(id)); if(i) i.selected = !i.selected; }
function toggleSelectAll(chk) { getCurrentProject().items.forEach(i => i.selected = chk.checked); renderTable(); }
function deleteSingleRow(id) { getCurrentProject().items = getCurrentProject().items.filter(i => String(i.id) !== String(id)); updateCalculations(); }
function deleteSelectedRows() { getCurrentProject().items = getCurrentProject().items.filter(i => !i.selected); updateCalculations(); }
function clearAllItems() { if(confirm('Clear all items in active project?')) { getCurrentProject().items = []; updateCalculations(); } }

window.handleFileSelect = async function(event) {
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    await window.processPdfFile(file);
    event.target.value = '';
  } catch(err) {
    alert("Error selecting file: " + err.message);
  }
};

window.processPdfFile = async function(file) {
  if (!file) return;

  try {
    if (typeof pdfjsLib === 'undefined') {
      alert("Error: PDF.js library is not loaded.");
      return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += " " + textContent.items.map(item => item.str).join(' ');
    }

    const parsed = await parseBuyeeTextStream(fullText);
    
    if (parsed.length > 0) {
      getCurrentProject().items = [...parsed, ...getCurrentProject().items];
      updateCalculations();
      alert(`Successfully imported and translated ${parsed.length} orders!`);
    } else {
      alert("PDF opened, but no orders matched the expected Buyee format.");
    }
  } catch (err) {
    alert("Error reading PDF: " + err.message);
  }
};

async function parseBuyeeTextStream(text) {
  const items = [];
  const currentTariff = getCurrentProject().tariffRate || 10;
  const cleanText = text.replace(/Order\s*date([0-9])/gi, 'Order date $1');
  const orderHeaderRegex = /([A-Z0-9]{10,14})\s*Order\s*date\s*(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})/gi;
  const matches = [...cleanText.matchAll(orderHeaderRegex)];

  if (matches.length === 0) return items;

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const orderId = match[1].trim();
    const orderDate = match[2].trim();
    const startIndex = match.index;
    const endIndex = (index < matches.length - 1) ? matches[index + 1].index : cleanText.length;
    const block = cleanText.slice(startIndex, endIndex);

    if (block.includes('out of stock') || block.includes('Order was cancelled')) continue;

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

    // Automatic translation to English
    const EnglishTitle = await translateText(rawTitle);
    const EnglishSeller = await translateText(seller);

    if (priceJPY > 0) {
      items.push({
        id: String(Date.now() + index + Math.random()),
        orderDate: orderDate,
        orderId: orderId,
        itemTitle: EnglishTitle,
        seller: EnglishSeller,
        qty: qty,
        priceJPY: priceJPY,
        printedUSD: printedUSD,
        shippingUSD: 0,
        feeUSD: 0,
        tariffPercent: currentTariff,
        selected: false
      });
    }
  }

  return items;
}

function exportToExcel() {
  const items = getCurrentProject().items;
  const exportData = items.map((item, idx) => ({
    'Row #': idx + 1, 'Date': item.orderDate, 'Order ID': item.orderId,
    'Item Title (EN)': item.itemTitle, 'Seller (EN)': item.seller, 'Qty': item.qty,
    'Unit Price ($USD)': item.unitPriceUSD.toFixed(2), 'FX Rate': item.fxRate.toFixed(5),     'Base Cost ($ USD)': item.itemCostUSD.toFixed(2), 'Shipping ($USD)': item.shippingUSD.toFixed(2),     'Fees ($ USD)': item.feeUSD.toFixed(2), 'Tariff Rate (%)': item.tariffPercent + '%',
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