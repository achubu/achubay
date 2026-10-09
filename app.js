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

// Helper to translate single text string (Client-Side)
async function translateText(text) {
  if (!text || typeof text !== 'string') return text;
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
    console.warn("Translation skipped for item:", err);
  }
  return text;
}

// Function triggered by "Translate to English" button
window.translateAllExistingItems = async function() {
  const p = getCurrentProject();
  if (!p.items || p.items.length === 0) {
    alert("No items in list to translate.");
    return;
  }
  
  const button = document.getElementById('translateBtn');
  if (button) button.innerText = "Translating...";

  let translatedCount = 0;
  for (let item of p.items) {
    item.itemTitle = await translateText(item.itemTitle);
    item.seller = await translateText(item.seller);
    translatedCount++;
  }

  updateCalculations();
  if (button) button.innerText = "Translate to English";
  alert(`Finished translating ${translatedCount} items!`);
};

// Force apply global settings (Tariff %, Shipping, Fees) across imported lines
window.applyGlobalChangesToAllRows = function() {
  const p = getCurrentProject();
  if (!p.items || p.items.length === 0) {
    alert("No imported lines to update.");
    return;
  }

  const tariffVal = parseFloat(document.getElementById('globalTariffInput')?.value) || 0;
  p.tariffRate = tariffVal;
  p.shippingUSD = parseFloat(document.getElementById('globalShippingInput')?.value) || 0;
  p.feesUSD = parseFloat(document.getElementById('globalFeesInput')?.value) || 0;
  p.allocationStrategy = document.getElementById('allocationStrategy')?.value || 'proportional';
  p.fxMode = document.getElementById('fxMode')?.value || 'receipt';

  p.items.forEach(item => {
    item.tariffPercent = tariffVal;
  });

  updateCalculations();
  alert(`Applied global settings (${tariffVal}% Tariff, $${p.shippingUSD.toFixed(2)} Shipping, $${p.feesUSD.toFixed(2)} Fees) to all ${p.items.length} items!`);
};

function setupGlobalInputs() {
  const tariffInput = document.getElementById('globalTariffInput');
  if (tariffInput) tariffInput.addEventListener('input', updateCalculations);

  const shippingInput = document.getElementById('globalShippingInput');
  if (shippingInput) shippingInput.addEventListener('input', updateCalculations);

  const feesInput = document.getElementById('globalFeesInput');
  if (feesInput) feesInput.addEventListener('input', updateCalculations);

  const allocSelect = document.getElementById('allocationStrategy');
  if (allocSelect) allocSelect.addEventListener('change', updateCalculations);

  const fxSelect = document.getElementById('fxMode');
  if (fxSelect) fxSelect.addEventListener('change', updateCalculations);
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
  if (document.getElementById('globalTariffInput')) document.getElementById('globalTariffInput').value = p.tariffRate;
  if (document.getElementById('globalShippingInput')) document.getElementById('globalShippingInput').value = p.shippingUSD;
  if (document.getElementById('globalFeesInput')) document.getElementById('globalFeesInput').value = p.feesUSD;
  if (document.getElementById('allocationStrategy')) document.getElementById('allocationStrategy').value = p.allocationStrategy;
  if (document.getElementById('fxMode')) document.getElementById('fxMode').value = p.fxMode;
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
  if (document.getElementById('globalTariffInput')) p.tariffRate = parseFloat(document.getElementById('globalTariffInput').value) || 0;
  if (document.getElementById('globalShippingInput')) p.shippingUSD = parseFloat(document.getElementById('globalShippingInput').value) || 0;
  if (document.getElementById('globalFeesInput')) p.feesUSD = parseFloat(document.getElementById('globalFeesInput').value) || 0;
  if (document.getElementById('allocationStrategy')) p.allocationStrategy = document.getElementById('allocationStrategy').value;
  if (document.getElementById('fxMode')) p.fxMode = document.getElementById('fxMode').value;

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

    pdfjsLib.GlobalWorkerOptions.workerSrc = '