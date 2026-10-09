/**
 * Buyee Shipping Manifest & Landed Cost Parser Engine (Robust Version)
 */

// Configure PDF.js Worker safely for both local file:// and web servers
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

let currentParsedData = null;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  setupEventListeners();
});

function setupEventListeners() {
  const dropZone = document.getElementById('dropZone');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const searchInput = document.getElementById('searchInput');
  const tabPdf = document.getElementById('tabPdf');
  const tabPaste = document.getElementById('tabPaste');
  const pasteZone = document.getElementById('pasteZone');
  const parseTextBtn = document.getElementById('parseTextBtn');

  // Tab Switching
  tabPdf.addEventListener('click', () => {
    dropZone.classList.remove('hidden');
    pasteZone.classList.add('hidden');
    tabPdf.className = "text-xs font-semibold text-brand-400 border-b-2 border-brand-500 pb-1";
    tabPaste.className = "text-xs font-semibold text-slate-400 hover:text-slate-200 pb-1";
  });

  tabPaste.addEventListener('click', () => {
    dropZone.classList.add('hidden');
    pasteZone.classList.remove('hidden');
    tabPaste.className = "text-xs font-semibold text-brand-400 border-b-2 border-brand-500 pb-1";
    tabPdf.className = "text-xs font-semibold text-slate-400 hover:text-slate-200 pb-1";
  });

  // File Selection
  dropZone.addEventListener('click', () => pdfFileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-brand-500');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-brand-500');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-brand-500');
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  parseTextBtn.addEventListener('click', () => {
    const text = document.getElementById('rawTextArea').value;
    if (text.trim()) {
      parseManifestText(text, "Pasted_Manifest.txt");
      showStatus("Parsed pasted text successfully!", false);
    } else {
      showStatus("Please paste text into the box first.", true);
    }
  });

  searchInput.addEventListener('input', (e) => {
    renderTable(e.target.value.toLowerCase());
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
  document.getElementById('exportJsonBtn').addEventListener('click', exportToJSON);
}

async function handleFileUpload(file) {
  showStatus(`Processing file: ${file.name}...`, false);

  try {
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      const arrayBuffer = await file.arrayBuffer();
      
      // Load PDF document safely
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Extract items preserving spacing
        const pageStrings = textContent.items.map(item => item.str);
        fullText += pageStrings.join('\n') + '\n';
      }
      
      parseManifestText(fullText, file.name);
      showStatus(`Successfully parsed ${file.name} (${pdf.numPages} pages)`, false);
    } else {
      // Direct text file
      const text = await file.text();
      parseManifestText(text, file.name);
      showStatus(`Successfully parsed ${file.name}`, false);
    }
  } catch (err) {
    console.error("PDF Parsing Error:", err);
    showStatus(`Failed to parse PDF (${err.message}). Switch to 'Paste Raw Text' tab to paste contents directly.`, true);
  }
}

function showStatus(msg, isError) {
  const alertEl = document.getElementById('statusAlert');
  const msgEl = document.getElementById('statusMessage');

  alertEl.classList.remove('hidden');
  msgEl.textContent = msg;

  if (isError) {
    alertEl.className = "p-3 rounded-lg text-xs flex items-center justify-between bg-red-950/80 border border-red-800 text-red-200";
  } else {
    alertEl.className = "p-3 rounded-lg text-xs flex items-center justify-between bg-emerald-950/80 border border-emerald-800 text-emerald-200";
  }
}

/**
 * Parser Engine for Buyee Manifest Format
 */
function parseManifestText(rawText, fileName) {
  const cleanText = rawText.replace(/\r/g, '');

  const packageRef = extractRegex(cleanText, /Package Reference No\.\s*\n?\s*([A-Z0-9]+)/i, "N/A");
  const delivDate = extractRegex(cleanText, /Date of Delivery\s*:?\s*(\d{4}[-\/]\d{2}[-\/]\d{2})/i, "N/A");

  const intlShipping = extractNumber(cleanText, /International Shipping Fee\s*\n?\s*\|?\s*([\d,\.]+)/i);
  const customsDuty = extractNumber(cleanText, /Customs Duty\s*\n?\s*\|?\s*\|?\s*([\d,\.]+)/i);
  const buyeeFee = extractNumber(cleanText, /Buyee Service Fee\s*\n?\s*\|?\s*\|?\s*([\d,\.]+)/i);
  const clearanceFee = extractNumber(cleanText, /Customs Clearance Fee\s*\n?\s*\|?\s*\|?\s*([\d,\.]+)/i);
  const otherFees = buyeeFee + clearanceFee;

  const siteParts = cleanText.split(/Shopping Site\(ID\)/i);
  const rawItems = [];

  for (let i = 1; i < siteParts.length; i++) {
    const part = siteParts[i].split(/(?:Buyee Service Fee|Invoice Information|Shipping Expenses|Breakdown of Other)/i)[0];

    // Order ID
    const siteMatch = part.match(/\|\s*([^\(\n]+?)\s*\(([^)]+)\)/);
    let siteName = "Buyee Site";
    let orderId = "N/A";
    if (siteMatch) {
      siteName = siteMatch[1].trim();
      orderId = siteMatch[2].replace(/[\s|]+/g, '').trim();
    }

    // Item Name
    const nameMatch = part.match(/Item Name\s*\n([\s\S]+?)(?=\n\s*(?:\||\s)*Quantity)/i);
    let itemName = "Item";
    if (nameMatch) {
      const lines = nameMatch[1].split('\n')
        .map(l => l.replace(/^\s*\|\s*/, '').trim())
        .filter(l => l && l !== '|');
      itemName = lines.join(' ');
    }

    // Quantities & Prices
    const qtyMatch = part.match(/Quantity\s*\n?[\s|]*(\d+)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    const origPrice = extractNumber(part, /Item Price\s*\n?[\s|]*([\d,\.]+)/i);
    const coupon = extractNumber(part, /Coupon discount\s*\n?[\s|]*-?([\d,\.]+)/i);
    let netPrice = origPrice - coupon;

    const netMatch = part.match(/Total Amount\s*\n?[\s|]*([\d,\.]+)/i);
    if (netMatch) {
      const parsedNet = parsePriceString(netMatch[1]);
      if (parsedNet > 0) netPrice = parsedNet;
    }

    if (orderId !== "N/A" || netPrice > 0) {
      rawItems.push({ orderId, siteName, itemName, qty, origPrice, coupon, netPrice });
    }
  }

  const totalNetItemsCost = rawItems.reduce((acc, item) => acc + item.netPrice, 0);

  const items = rawItems.map(item => {
    const ratio = totalNetItemsCost > 0 ? (item.netPrice / totalNetItemsCost) : (1 / rawItems.length);
    const splitShipping = Math.round(intlShipping * ratio);
    const splitDuty = Math.round(customsDuty * ratio);
    const splitFees = Math.round(otherFees * ratio);
    const landedCost = item.netPrice + splitShipping + splitDuty + splitFees;

    return { ...item, splitShipping, splitDuty, splitFees, landedCost };
  });

  const grandTotalLanded = items.reduce((acc, item) => acc + item.landedCost, 0);

  currentParsedData = {
    fileName,
    packageRef,
    delivDate,
    intlShipping,
    customsDuty,
    otherFees,
    totalNetItemsCost,
    grandTotalLanded,
    items
  };

  updateMetrics();
  renderTable();
}

function extractRegex(text, regex, defaultValue) {
  const match = text.match(regex);
  return match ? match[1].trim() : defaultValue;
}

function extractNumber(text, regex) {
  const match = text.match(regex);
  if (!match) return 0;
  return parsePriceString(match[1]);
}

function parsePriceString(str) {
  if (!str) return 0;
  const clean = str.replace(/,/g, '').replace(/\./g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function updateMetrics() {
  if (!currentParsedData) return;

  document.getElementById('metricTotalItems').textContent = currentParsedData.items.length;
  document.getElementById('metricManifestRef').textContent = `Ref: ${currentParsedData.packageRef}`;
  document.getElementById('metricNetCost').textContent = `¥${currentParsedData.totalNetItemsCost.toLocaleString()}`;
  document.getElementById('metricShipping').textContent = `¥${currentParsedData.intlShipping.toLocaleString()}`;
  document.getElementById('metricDuty').textContent = `¥${currentParsedData.customsDuty.toLocaleString()}`;
  document.getElementById('metricGrandTotal').textContent = `¥${currentParsedData.grandTotalLanded.toLocaleString()}`;
}

function renderTable(filterQuery = '') {
  const tbody = document.getElementById('manifestTableBody');
  tbody.innerHTML = '';

  if (!currentParsedData || currentParsedData.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-500">No items found in manifest.</td></tr>`;
    return;
  }

  const filtered = currentParsedData.items.filter(item => {
    return item.orderId.toLowerCase().includes(filterQuery) ||
           item.itemName.toLowerCase().includes(filterQuery) ||
           item.siteName.toLowerCase().includes(filterQuery);
  });

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-800/40 transition-colors";
    tr.innerHTML = `
      <td class="p-3 text-slate-200 font-semibold">${escapeHtml(item.orderId)}</td>
      <td class="p-3 text-slate-400">${escapeHtml(item.siteName)}</td>
      <td class="p-3 text-slate-100 max-w-xs truncate" title="${escapeHtml(item.itemName)}">${escapeHtml(item.itemName)}</td>
      <td class="p-3 text-right text-slate-400">¥${item.origPrice.toLocaleString()}</td>
      <td class="p-3 text-right text-emerald-400 font-medium">¥${item.netPrice.toLocaleString()}</td>
      <td class="p-3 text-right text-blue-400">+¥${item.splitShipping.toLocaleString()}</td>
      <td class="p-3 text-right text-amber-400">+¥${item.splitDuty.toLocaleString()}</td>
      <td class="p-3 text-right text-slate-400">+¥${item.splitFees.toLocaleString()}</td>
      <td class="p-3 text-right text-purple-300 font-bold bg-purple-950/20">¥${item.landedCost.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  });

  lucide.createIcons();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function exportToCSV() {
  if (!currentParsedData) return;
  const headers = ["Package Ref", "Date", "Order ID", "Site Name", "Item Name", "Qty", "Base Price", "Net Price", "Split Shipping", "Split Duty", "Split Fees", "Total Landed Cost"];
  const rows = currentParsedData.items.map(i => [
    currentParsedData.packageRef, currentParsedData.delivDate, `"${i.orderId}"`, `"${i.siteName}"`, `"${i.itemName.replace(/"/g, '""')}"`, i.qty, i.origPrice, i.netPrice, i.splitShipping, i.splitDuty, i.splitFees, i.landedCost
  ]);
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(csvContent));
  link.setAttribute('download', `Buyee_Landed_Cost_${currentParsedData.packageRef}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportToJSON() {
  if (!currentParsedData) return;
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentParsedData, null, 2));
  const link = document.createElement('a');
  link.setAttribute("href", dataStr);
  link.setAttribute("download", `Buyee_Landed_Cost_${currentParsedData.packageRef}.json`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}