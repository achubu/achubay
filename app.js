pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
});

function loadStoreFromLocalStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      store = JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse saved state:', e);
    }
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
      id,
      name: name.trim(),
      tariffRate: 10.0,
      shippingUSD: 0.0,
      feesUSD: 0.0,
      allocationStrategy: 'proportional',
      fxMode: 'receipt',
      items: []
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
      const monthStr = monthMap[parts[1]] || '10';
      const key = `${parts[2]}-${monthStr}`;
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
    item.itemCostUSD = (item.priceJPY * item.fxRate) * (item.qty || 1);
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

    item.tariffPercent = item.tariffPercent !== undefined ? item.tariffPercent : p.tariffRate;
    item.tariffUSD = item.itemCostUSD * (item.tariffPercent / 100);
    item.landedCostUSD = item.itemCostUSD + item.shippingUSD + item.feeUSD + item.tariffUSD;
  });

  let totalJPY = 0, totalBaseUSD = 0, totalFreightFeesUSD = 0, totalTariffUSD = 0, totalLandedUSD = 0;
  items.forEach(i => {
    totalJPY += i.priceJPY * (i.qty || 1);
    totalBaseUSD += i.itemCostUSD;
    totalFreightFeesUSD += (i.shippingUSD + i.feeUSD);
    totalTariffUSD += i.tariffUSD;
    totalLandedUSD += i.landedCostUSD;
  });

  document.getElementById('statCount').innerText = items.length;
  document.getElementById('statTotalJPY').innerText = '¥' + totalJPY.toLocaleString();
  document.getElementById('statTotalUSD').innerText = '$' + totalBaseUSD.toFixed(2);
  document.getElementById('statTotalFreightFees').innerText = '$' + totalFreightFeesUSD.toFixed(2);
  document.getElementById('statTotalTariff').innerText = '$' + totalTariffUSD.toFixed(2);
  document.getElementById('statTotalLanded').innerText = '$' + totalLandedUSD.toFixed(2);

  saveStoreToLocalStorage();
  renderTable();
}

function renderTable() {
  const p = getCurrentProject();
  const tbody = document.getElementById('inventoryTbody');
  if (!tbody) return;
  const q = document.getElementById('searchInput').value.toLowerCase();
  tbody.innerHTML = '';

  const filtered = p.items.filter(i => 
    (i.itemTitle||'').toLowerCase().includes(q) || (i.seller||'').toLowerCase().includes(q) || (i.orderId||'').toLowerCase().includes(q)
  );

  document.getElementById('displayedCountText').innerText = `Showing ${filtered.length} of ${p.items.length} items`;

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
      <td class="p-3 text-right font-mono text-amber-300"><input type="number" value="${item.priceJPY}" onchange="updateItemValue('${item.id}', 'priceJPY', parseFloat(this.value)||0)" class="w-20 bg-slate-900 text-right px-1 text-xs font-bold text-amber-300 rounded"></td>
      <td class="p-3 text-right font-mono text-slate-400 text-[11px]">$${item.fxRate.toFixed(5)}</td>
      <td class="p-3 text-right font-mono font-semibold text-sky-300">$${item.itemCostUSD.toFixed(2)}</td>
      <td class="p-3 text-right font-mono text-slate-300 text-[11px]">$${item.shippingUSD.toFixed(2)}</td>
      <td class="p-3 text-right font-mono text-slate-300 text-[11px]">$${item.feeUSD.toFixed(2)}</td>
      <td class="p-3 text-right"><input type="number" value="${item.tariffPercent}" onchange="updateItemValue('${item.id}', 'tariffPercent', parseFloat(this.value)||0)" class="w-14 bg-slate-900 text-right px-1 text-xs text-rose-300 rounded"></td>
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
  getCurrentProject().items.unshift({
    id: String(Date.now() + Math.random()),
    orderDate: '7 Oct 2026', orderId: `ORD-${Math.floor(Math.random()*90000)}`,
    itemTitle: 'New Item Description', seller: 'Mercari Seller', qty: 1, priceJPY: 10000,
    shippingUSD: 0, feeUSD: 0, tariffPercent: getCurrentProject().tariffRate, selected: false
  });
  updateCalculations();
}

function toggleRowSelect(id) { const i = getCurrentProject().items.find(x => String(x.id) === String(id)); if(i) i.selected = !i.selected; }
function toggleSelectAll(chk) { getCurrentProject().items.forEach(i => i.selected = chk.checked); renderTable(); }
function deleteSingleRow(id) { getCurrentProject().items = getCurrentProject().items.filter(i => String(i.id) !== String(id)); updateCalculations(); }
function deleteSelectedRows() { getCurrentProject().items = getCurrentProject().items.filter(i => !i.selected); updateCalculations(); }
function clearAllItems() { if(confirm('Clear all items in active project?')) { getCurrentProject().items = []; updateCalculations(); } }

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += " " + textContent.items.map(item => item.str).join(' ');
    }

    const parsed = parseBuyeeTextStream(fullText);
    
    if (parsed.length > 0) {
      getCurrentProject().items = [...parsed, ...getCurrentProject().items];
      updateCalculations();
      alert(`Successfully imported ${parsed.length} orders from PDF!`);
    } else {
      alert("No matching Buyee order records could be extracted from this PDF.");
    }
  } catch (err) {
    console.error("PDF Parsing Error:", err);
    alert("Error reading PDF file: " + err.message);
  }
}

function parseBuyeeTextStream(text) {
  const items = [];
  
  // Clean spacing artifacts around "Order date"
  const cleanText = text.replace(/Order\s*date([0-9])/gi, 'Order date $1');

  // Match Order IDs (12-digit numbers, M-prefix, F-prefix, etc.) followed by Order date
  const orderHeaderRegex = /([A-Z0-9]{10,14})\s*Order\s*date\s*(\d{1,2}\s+[A-Za-z]{3}\s+20\d{2})/gi;
  const matches = [...cleanText.matchAll(orderHeaderRegex)];

  if (matches.length === 0) return items;

  matches.forEach((match, index) => {
    const orderId = match[1].trim();
    const orderDate = match[2].trim();
    const startIndex = match.index;
    const endIndex = (index < matches.length - 1) ? matches[index + 1].index : cleanText.length;
    const block = cleanText.slice(startIndex, endIndex);

    // Bypasses cancelled or out-of-stock orders
    if (block.includes('out of stock') || block.includes('Order was cancelled')) {
      return;
    }

    // 1. Seller / Shop Name
    let seller = "Buyee Seller";
    const sellerMatch = block.match(/(?:Shop Name|Seller)\s*([^\n\r]+?)(?=\s*(?:Total Amount|After your|Details|Purchase|Transaction|Quantity|Order date|$))/i);
    if (sellerMatch && sellerMatch[1]) {
      seller = sellerMatch[1].replace(/[-–—]\s*$/, '').trim();
    }

    // 2. Price JPY
    let priceJPY = 0;
    const jpyMatch = block.match(/(?:Requested Item Price|Item Price)\s*:?\s*([\d,]+)\s*YEN/i) || 
                     block.match(/Total Amount\s*:?\s*([\d,]+)\s*YEN/i);
    if (jpyMatch) {
      priceJPY = parseFloat(jpyMatch[1].replace(/,/g, '')) || 0;
    }

    // 3. Printed USD Conversion Rate
    let printedUSD = null;
    const usdMatches = [...block.matchAll(/\(US\$\s*([\d,]+\.\d{2})\)/gi)];
    if (usdMatches.length > 0) {
      printedUSD = parseFloat(usdMatches[usdMatches.length - 1][1].replace(/,/g, ''));
    }

    // 4. Quantity (Handles '1', 'l', or 'I')
    let qty = 1;
    const qtyMatch = block.match(/Quantity\s*(\d+|[lI])\s*item\(s\)/i);
    if (qtyMatch) {
      const rawQty = qtyMatch[1];
      qty = (rawQty === 'l' || rawQty === 'I') ? 1 : (parseInt(rawQty, 10) || 1);
    }

    // 5. Item Title
    let itemTitle = "Proxy Purchase Item";
    const qtyIdx = block.search(/Quantity\s*(\d+|[lI])\s*item\(s\)/i);
    
    if (qtyIdx > 0) {
      let snippet = block.slice(Math.max(0, qtyIdx - 160), qtyIdx).trim();
      
      // Clean up order status and system text preceding the title
      snippet = snippet.replace(/.*(?:Purchase request items|Transaction Delivery|Arrived at Warehouse|Shipped|Order Completed|Order Received|Details)\s*/gi, '').trim();
      
      if (snippet.length > 0) {
        itemTitle = snippet.slice(-120).replace(/^[\s•:-]+/, '').trim();
      }
    }

    if (priceJPY > 0) {
      items.push({
        id: String(Date.now() + index + Math.random()),
        orderDate: orderDate,
        orderId: orderId,
        itemTitle: itemTitle,
        seller: seller,
        qty: qty,
        priceJPY: priceJPY,
        printedUSD: printedUSD,
        shippingUSD: 0,
        feeUSD: 0,
        tariffPercent: store.projects[store.activeProjectId]?.tariffRate || 10,
        selected: false
      });
    }
  });

  return items;
}

function exportToExcel() {
  const items = getCurrentProject().items;
  const exportData = items.map((item, idx) => ({
    'Row #': idx + 1, 'Date': item.orderDate, 'Order ID': item.orderId,
    'Item Title': item.itemTitle, 'Seller': item.seller, 'Qty': item.qty,
    'Price (JPY)': item.priceJPY, 'FX Rate': item.fxRate.toFixed(5),
    'Base Cost ($)': item.itemCostUSD.toFixed(2), 'Shipping ($)': item.shippingUSD.toFixed(2),
    'Fees ($)': item.feeUSD.toFixed(2), 'Tariff ($)': item.tariffUSD.toFixed(2),
    'Landed Cost ($)': item.landedCostUSD.toFixed(2)
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