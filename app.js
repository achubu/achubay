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
      tariffRate: 12.566,
      items: []
    }
  }
};

if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

document.addEventListener('DOMContentLoaded', () => {
  loadStoreFromLocalStorage();
  safeCreateIcons();
  renderProjectDropdown();
  loadProjectUI();
  setupGlobalInputs();
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
      ? "text-[11px] font-mono text-rose-300 mt-4 bg-rose-950/80 px-3 py-1.5 rounded border border-rose-800/50 truncate text-center"
      : "text-[11px] font-mono text-indigo-300 mt-4 bg-slate-900/80 px-3 py-1.5 rounded border border-indigo-900/50 truncate text-center";
  }
}

function sanitizeStore(rawStore) {
  if (!rawStore || typeof rawStore !== 'object') {
    return {
      activeProjectId: 'Default_Project',
      projects: {
        'Default_Project': { id: 'Default_Project', name: 'Default Project', tariffRate: 12.566, items: [] }
      }
    };
  }
  if (!rawStore.projects || typeof rawStore.projects !== 'object') {
    rawStore.projects = {
      'Default_Project': { id: 'Default_Project', name: 'Default Project', tariffRate: 12.566, items: [] }
    };
  }
  if (!rawStore.activeProjectId || !rawStore.projects[rawStore.activeProjectId]) {
    rawStore.activeProjectId = Object.keys(rawStore.projects)[0] || 'Default_Project';
  }
  Object.values(rawStore.projects).forEach(p => {
    if (typeof p.tariffRate !== 'number') p.tariffRate = 12.566;
    if (!Array.isArray(p.items)) p.items = [];
    p.items.forEach(item => {
      if (typeof item.qty !== 'number') item.qty = parseInt(item.qty, 10) || 1;
      if (typeof item.priceJPY !== 'number') item.priceJPY = parseFloat(item.priceJPY) || 0;
      if (typeof item.printedUSD !== 'number' && item.printedUSD !== null) item.printedUSD = parseFloat(item.printedUSD) || null;
      if (typeof item.shippingUSD !== 'number') item.shippingUSD = parseFloat(item.shippingUSD) || 0;
      if (typeof item.tariffPercent !== 'number') item.tariffPercent = p.tariffRate;
      if (typeof item.selected !== 'boolean') item.selected = false;
      if (!item.itemTitle) item.itemTitle = 'Proxy Purchase Item';
      if (!item.seller) item.seller = 'Buyee Seller';
      if (!item.orderId) item.orderId = 'N/A';
      if (!item.orderDate) item.orderDate = 'N/A';
    });
  });
  return rawStore;
}

function loadStoreFromLocalStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      store = sanitizeStore(parsed);
    } else {
      store = sanitizeStore(null);
    }
  } catch (e) {
    console.error('Failed to parse saved state:', e);
    store = sanitizeStore(null);
  }
}

function saveStoreToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.error('Failed to save to local storage:', e);
  }
}

function getCurrentProject() {
  if (!store || !store.projects) store = sanitizeStore(null);
  if (!store.projects[store.activeProjectId]) {
    store.activeProjectId = Object.keys(store.projects)[0] || 'Default_Project';
  }
  return store.projects[store.activeProjectId];
}

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
      if (!result.includes("QUERY LENGTH LIMIT EXCEEDED") && !result.includes("MYMEMORY WARNING")) {
        return result;
      }
    }
  } catch (err) {
    console.warn("Translation API error:", err);
  }
  return text;
}

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

// -------------------------------------------------------------
// SEPARATE PDF FILE SELECT HANDLERS FOR ORDERS & SHIPPING
// -------------------------------------------------------------

window.handleOrderFileSelect = async function(event) {
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    updateStatus(`Selected Order PDF: ${file.name}...`);
    await window.processOrderPdfFile(file);
    event.target.value = '';
  } catch(err) {
    updateStatus("Order PDF error: " + err.message, true);
  }
};

window.handleShippingFileSelect = async function(event) {
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    updateStatus(`Selected Shipping PDF: ${file.name}...`);
    await window.processShippingPdfFile(file);
    event.target.value = '';
  } catch(err) {
    updateStatus("Shipping PDF error: " + err.message, true);
  }
};

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error("PDF.js library failed to load.");
  }
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  updateStatus("Opening PDF file...");
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  updateStatus(`Extracting ${pdf.numPages} PDF page(s)...`);
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += " " + textContent.items.map(item => item.str).join(' ');
  }
  return fullText;
}

window.processOrderPdfFile = async function(file) {
  try {
    const fullText = await extractPdfText(file);
    updateStatus("Parsing Buyee order receipts...");
    const parsed = parseBuyeeTextStream(fullText);
    
    if (parsed.length > 0) {
      await translateItemList(parsed);

      getCurrentProject().items = [...parsed, ...getCurrentProject().items];
      updateCalculations();
      updateStatus(`Success: Imported ${parsed.length} order items!`);
      alert(`Successfully imported and translated ${parsed.length} order items!`);
    } else {
      updateStatus("No order records found in PDF.", true);
      alert("PDF read successfully, but no order records were matched in this file.");
    }
  } catch (err) {
    updateStatus("Order PDF Error: " + err.message, true);
    alert("Error processing Order PDF: " + err.message);
  }
};

window.processShippingPdfFile = async function(file) {
  try {
    const fullText = await extractPdfText(file);
    updateStatus("Processing Package Shipping Manifest...");
    const result = parseBuyeeShippingPdf(fullText, getCurrentProject());
    
    if (result.success) {
      updateCalculations();
      updateStatus(`Allocated ${result.shippingJPY} JPY shipping across ${result.matchedCount} items!`);
      alert(`Success! Allocated ${result.shippingJPY} JPY International Shipping Fee across ${result.matchedCount} items.`);
    } else {
      updateStatus(result.message, true);
      alert(result.message);
    }
  } catch (err) {
    updateStatus("Shipping PDF Error: " + err.message, true);
    alert("Error processing Shipping Manifest: " + err.message);
  }
};

function parseBuyeeShippingPdf(text, project) {
  let intlShippingJPY = 0;

  const shipMatch = text.match(/International\s*Shipping\s*Fee\s*\|?\s*([\d,]+)/i);
  if (shipMatch) {
    intlShippingJPY = parseFloat(shipMatch[1].replace(/,/g, '')) || 0;
  } else {
    const altMatch = text.match(/Shipping\s*Expenses[\s\S]*?International\s*Shipping\s*Fee[\s\S]*?([\d,]+)/i);
    if (altMatch) intlShippingJPY = parseFloat(altMatch[1].replace(/,/g, '')) || 0;
  }

  if (intlShippingJPY <= 0) {
    return {
      success: false,
      message: "Could not locate 'International Shipping Fee' in this Shipping Manifest PDF."
    };
  }

  const items = project.items || [];
  if (items.length === 0) {
    return { 
      success: false, 
      message: "No items found in active project to apply shipping to. Please import your Order receipts first!" 
    };
  }

  const siteIds = (text.match(/(M\d{10,12}|\b126\d{9,11}\b|\bW26\d{8,10}\b)/gi) || []).map(x => x.toUpperCase());
  const itemCodes = (text.match(/([A-Z0-9]{3,8}-[A-Z0-9-]+)/gi) || []).map(x => x.toUpperCase()).filter(c => !c.includes('2026') && !c.includes('VALUE'));

  let matchedItems = items.filter(item => {
    const orderId = (item.orderId || '').toUpperCase();
    const title = (item.itemTitle || '').toUpperCase();

    if (orderId && siteIds.some(id => orderId.includes(id) || id.includes(orderId))) return true;
    if (itemCodes.some(code => title.includes(code))) return true;

    return false;
  });

  if (matchedItems.length === 0) {
    matchedItems = items;
  }

  const totalMatchedJPY = matchedItems.reduce((sum, i) => sum + (i.priceJPY || 0), 0);

  matchedItems.forEach(item => {
    const ratio = totalMatchedJPY > 0 ? ((item.priceJPY || 0) / totalMatchedJPY) : (1 / matchedItems.length);
    const itemShippingJPY = intlShippingJPY * ratio;
    item.shippingUSD = itemShippingJPY * (item.fxRate || 0.0064);
  });

  return {
    success: true,
    matchedCount: matchedItems.length,
    shippingJPY: intlShippingJPY
  };
}

// Flexible, Decoupled Order Receipt Stream Parser
function parseBuyeeTextStream(text) {
  const items = [];
  const currentTariff = getCurrentProject().tariffRate || 12.566;
  const cleanText = text.replace(/\s+/g, ' ');

  // Locate slice anchors for every item or order entry
  const idMatches = listAllMatches(/(?:Order\s*(?:ID|number|No\.?)|Site\(ID\)|Shopping\s*Site\(ID\))\s*:?\s*([A-Z0-9]{8,20})|(?:\b|\bOrder\s*)([MYRJ]\d{9,13}|\b126\d{9,11}\b)/gi, cleanText);
  const dateMatches = listAllMatches(/(?:Order\s*date|Date\s*of\s*Order)\s*:?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})/gi, cleanText);

  let sliceIndices = [];
  idMatches.forEach(m => sliceIndices.push(m.index));
  dateMatches.forEach(m => sliceIndices.push(m.index));

  sliceIndices = [...new Set(sliceIndices)].sort((a, b) => a - b);

  // Merge slice points that are too close (< 40 chars)
  const filteredIndices = [];
  sliceIndices.forEach(idx => {
    if (filteredIndices.length === 0 || (idx - filteredIndices[filteredIndices.length - 1]) > 40) {
      filteredIndices.push(idx);
    }
  });

  if (filteredIndices.length === 0) {
    filteredIndices.push(0);
  }

  const blocks = [];
  for (let i = 0; i < filteredIndices.length; i++) {
    const start = filteredIndices[i];
    const end = (i < filteredIndices.length - 1) ? filteredIndices[i + 1] : cleanText.length;
    const block = cleanText.slice(start, end).trim();
    if (block.length > 10) {
      blocks.push(block);
    }
  }

  blocks.forEach((block, index) => {
    if (block.toLowerCase().includes('out of stock') || block.toLowerCase().includes('order was cancelled')) {
      return;
    }

    // Extract Order Date
    let orderDate = "N/A";
    const dateMatch = block.match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})/i);
    if (dateMatch) {
      orderDate = dateMatch[1].trim();
    }

    // Extract Order ID
    let orderId = "N/A";
    const idMatch = block.match(/(?:Order\s*(?:ID|number|No\.?)|Site\(ID\)|Shopping\s*Site\(ID\))\s*:?\s*([A-Z0-9]{8,20})/i) || block.match(/\b([MYRJ]\d{9,13}|\b126\d{9,11}\b)\b/i);
    if (idMatch) {
      orderId = (idMatch[1] || idMatch[0]).trim();
    }

    // Extract Seller
    let seller = "Buyee Seller";
    const sellerMatch = block.match(/(?:Shop Name|Seller|Store Name)\s*:?\s*([^\r\n]+?)(?=\s*(?:Total Amount|After your|Details|Purchase|Transaction|Quantity|Order date|Requested Item Price|Item Price|$))/i);
    if (sellerMatch && sellerMatch[1]) {
      seller = sellerMatch[1].replace(/[-–—]\s*$/, '').trim();
    }

    // Extract JPY Price
    let priceJPY = 0;
    const jpyMatch = block.match(/(?:Requested Item Price|Item Price)\s*:?\s*([\d,]+)\s*YEN/i) || block.match(/Total Amount\s*:?\s*([\d,]+)\s*YEN/i) || block.match(/([\d,]+)\s*YEN/i);
    if (jpyMatch) {
      priceJPY = parseFloat(jpyMatch[1].replace(/,/g, '')) || 0;
    }

    // Extract Printed USD
    let printedUSD = null;
    const usdMatches = listAllMatches(/\(US\$\s*([\d,]+\.\d{2})\)/gi, block);
    if (usdMatches.length > 0) {
      printedUSD = parseFloat(usdMatches[usdMatches.length - 1][1].replace(/,/g, ''));
    }

    // Extract Quantity
    let qty = 1;
    const qtyMatch = block.match/Quantity\s*:?\s*(\d+|[lI])\s*item\(s\)?/i || block.match/Quantity\s*:?\s*(\d+)/i;
    if (qtyMatch) {
      const rawQty = qtyMatch[1];
      qty = (rawQty === 'l' || rawQty === 'I') ? 1 : (parseInt(rawQty, 10) || 1);
    }

    // Extract Item Title
    let rawTitle = "Proxy Purchase Item";
    const qtyIdx = block.search(/Quantity\s*:?\s*(\d+|[lI])\s*item\(s\)?/i);
    if (qtyIdx > 0) {
      let snippet = block.slice(Math.max(0, qtyIdx - 160), qtyIdx).trim();
      snippet = snippet.replace(/.*?(?:Purchase request items|Transaction Delivery|Arrived at Warehouse|Shipped|Order Completed|Order Received|Details|Shop Name|Seller)[^\n]*/gi, '').trim();
      if (snippet.length > 0) {
        rawTitle = snippet.slice(-120).replace(/^[\s•:-]+/, '').trim();
      }
    } else {
      const itemMatch = block.match(/(?:Purchase request items|Item Name|Product Name)\s*:?\s*([^\r\n]+?)(?=\s*(?:Quantity|Item Price|Requested Item Price|Total Amount|$))/i);
      if (itemMatch && itemMatch[1]) {
        rawTitle = itemMatch[1].trim();
      }
    }

    if (priceJPY > 0 || orderId !== "N/A") {
      items.push({
        id: String(Date.now() + index + Math.random()),
        orderDate: orderDate,
        orderId: orderId,
        itemTitle: rawTitle,
        seller: seller,
        qty: qty,
        priceJPY: priceJPY,
        printedUSD: printedUSD,
        shippingUSD: 0.00,
        tariffPercent: currentTariff,
        selected: false
      });
    }
  });

  return items;
}

function listAllMatches(regex, text) {
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
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
      id, name: name.trim(), tariffRate: 12.566, items: []
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

function getFxRate(item) {
  if (item.printedUSD && item.priceJPY > 0) {
    return item.printedUSD / item.priceJPY;
  }
  if (item.orderDate && item.orderDate !== 'N/A') {
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

  const items = p.items || [];

  let totalBaseUSD = 0, totalShippingUSD = 0, totalTariffUSD = 0, totalLandedUSD = 0;
  items.forEach(item => {
    item.fxRate = getFxRate(item);
    item.unitPriceUSD = (item.priceJPY || 0) * item.fxRate;
    item.itemCostUSD = item.unitPriceUSD * (item.qty || 1);
    item.shippingUSD = typeof item.shippingUSD === 'number' ? item.shippingUSD : 0.00;

    if (typeof item.tariffPercent !== 'number') item.tariffPercent = p.tariffRate;
    item.tariffUSD = item.itemCostUSD * (item.tariffPercent / 100);
    item.landedCostUSD = item.itemCostUSD + item.shippingUSD + item.tariffUSD;

    totalBaseUSD += item.itemCostUSD;
    totalShippingUSD += item.shippingUSD;
    totalTariffUSD += item.tariffUSD;
    totalLandedUSD += item.landedCostUSD;
  });

  const statCount = document.getElementById('statCount');
  if (statCount) statCount.innerText = items.length;

  const statTotalUSD = document.getElementById('statTotalUSD');
  if (statTotalUSD) statTotalUSD.innerText = '$' + totalBaseUSD.toFixed(2);

  const statTotalShipping = document.getElementById('statTotalShipping');
  if (statTotalShipping) statTotalShipping.innerText = '$' + totalShippingUSD.toFixed(2);

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

  const items = p.items || [];
  const filtered = items.filter(i => 
    (i.itemTitle||'').toLowerCase().includes(q) || (i.seller||'').toLowerCase().includes(q) || (i.orderId||'').toLowerCase().includes(q)
  );

  const countDisplay = document.getElementById('displayedCountText');
  if (countDisplay) countDisplay.innerText = `Showing ${filtered.length} of ${items.length} items`;

  filtered.forEach((item) => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-700/40 border-b border-slate-700/50";

    const unitPrice = typeof item.unitPriceUSD === 'number' ? item.unitPriceUSD : 0;
    const itemCost = typeof item.itemCostUSD === 'number' ? item.itemCostUSD : 0;
    const shipping = typeof item.shippingUSD === 'number' ? item.shippingUSD : 0;
    const tariffPct = typeof item.tariffPercent === 'number' ? item.tariffPercent : (p.tariffRate || 12.566);
    const tariffVal = typeof item.tariffUSD === 'number' ? item.tariffUSD : 0;
    const landedCost = typeof item.landedCostUSD === 'number' ? item.landedCostUSD : 0;

    tr.innerHTML = `
      <td class="p-3 text-center"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleRowSelect('${item.id}')"></td>
      <td class="p-3 text-slate-300 font-mono text-[11px]">${escapeHtml(item.orderDate || 'N/A')}</td>
      <td class="p-3 text-slate-400 font-mono text-[11px]">${escapeHtml(item.orderId || 'N/A')}</td>
      <td class="p-3 font-medium text-slate-100">
        <input type="text" value="${escapeHtml(item.itemTitle)}" onchange="updateItemValue('${item.id}', 'itemTitle', this.value)" class="bg-transparent border-none w-full text-xs text-slate-100 focus:bg-slate-900 rounded px-1">
      </td>
      <td class="p-3 text-slate-300 truncate max-w-[120px]">${escapeHtml(item.seller)}</td>
      <td class="p-3 text-right"><input type="number" value="${item.qty || 1}" min="1" onchange="updateItemValue('${item.id}', 'qty', parseInt(this.value)||1)" class="w-12 bg-slate-900 text-right px-1 text-xs rounded"></td>
      <td class="p-3 text-right font-mono text-amber-300">$${unitPrice.toFixed(2)}</td>
      <td class="p-3 text-right font-mono font-semibold text-sky-300">$${itemCost.toFixed(2)}</td>
      <td class="p-3 text-right"><input type="number" step="0.01" value="${shipping.toFixed(2)}" onchange="updateItemValue('${item.id}', 'shippingUSD', parseFloat(this.value)||0)" class="w-16 bg-slate-900 text-right px-1 text-xs text-amber-300 rounded"></td>
      <td class="p-3 text-right"><input type="number" step="0.001" value="${tariffPct}" onchange="updateItemValue('${item.id}', 'tariffPercent', parseFloat(this.value)||0)" class="w-16 bg-slate-900 text-right px-1 text-xs text-rose-300 rounded"></td>
      <td class="p-3 text-right font-mono text-rose-400">$${tariffVal.toFixed(2)}</td>
      <td class="p-3 text-right font-mono font-bold text-emerald-400">$${landedCost.toFixed(2)}</td>
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
    shippingUSD: 0.00, tariffPercent: p.tariffRate, selected: false
  });
  updateCalculations();
}

function toggleRowSelect(id) { const i = getCurrentProject().items.find(x => String(x.id) === String(id)); if(i) i.selected = !i.selected; }
function toggleSelectAll(chk) { getCurrentProject().items.forEach(i => i.selected = chk.checked); renderTable(); }
function deleteSingleRow(id) { getCurrentProject().items = getCurrentProject().items.filter(i => String(i.id) !== String(id)); updateCalculations(); }
function deleteSelectedRows() { getCurrentProject().items = getCurrentProject().items.filter(i => !i.selected); updateCalculations(); }
function clearAllItems() { if(confirm('Clear all items in active project?')) { getCurrentProject().items = []; updateCalculations(); } }

function exportToExcel() {
  const items = getCurrentProject().items || [];
  const exportData = items.map((item, idx) => ({
    'Row #': idx + 1, 'Date': item.orderDate, 'Order ID': item.orderId,
    'Item Title': item.itemTitle, 'Seller': item.seller, 'Qty': item.qty,
    'Unit Price ($ USD)': (item.unitPriceUSD || 0).toFixed(2),
    'Base Cost ($USD)': (item.itemCostUSD \vert{}\vert{} 0).toFixed(2),     'Shipping ($ USD)': (item.shippingUSD || 0).toFixed(2),
    'Tariff Rate (%)': (item.tariffPercent || 12.566) + '%',
    'Tariff ($USD)': (item.tariffUSD \vert{}\vert{} 0).toFixed(2),     'Landed Cost ($ USD)': (item.landedCostUSD || 0).toFixed(2)
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
      const parsed = JSON.parse(e.target.result);
      store = sanitizeStore(parsed);
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