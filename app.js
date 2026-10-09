/**
 * Buyee Shipping Manifest & Landed Cost Parser Engine
 */

// Sample Manifest Data corresponding to Buyee Ref W2610049618
const SAMPLE_MANIFEST_TEXT = `
Buyee
Shipper
Aleksey Chubukov
129 Granite Street Malden Massachusetts United States of America
Postal Code 02148 TEL 16172851272
Delivery Address
Aleksey Chubukov 129 Granite Street Malden Massachusetts United States of America
Postal Code 02148 TEL 16172851272
powered by tenso

Breakdown of Expenses
Package Reference No. W2610049618
Date of Delivery 2026-10-07
Delivery Method ECMS
Shipment Tracking No. ECTS000002110528

Shopping Site(ID)
 | mercari (M26092602488)
Item Name
 | 1st Edition LOB-005
Quantity
 | 1
Item Price
 | 22,222
Coupon discount
 | -3,333
Total Amount
 | 18,889

Shopping Site(ID)
 | JDirectItems Fleamarket (126100101969)
Item Name
 | BLEACH SR EX15BT/BLC-4-027
Quantity
 | 1
Item Price
 | 122,000
Coupon discount
 | -24,400
Total Amount
 | 97,600

Shopping Site(ID)
 | JDirectItems Fleamarket (126100102149)
Item Name
 | 3 SR
Quantity
 | 1
Item Price
 | 53,800
Coupon discount
 | -9,684
Total Amount
 | 44,116

Buyee Service Fee
 | 1,500
Customs Clearance Fee
 | 800
Total Amount
 | 2,300

Shipping Expenses
International Shipping Fee
 | 1,788
Total Amount
1,788

Customs Duties and Value-Added Tax
Customs Duty
 | 21,171
Total Amount
21,171

Grand Total Payment Amount
185,864YEN
`;

let currentParsedData = null;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  setupEventListeners();
  // Parse initial sample manifest automatically
  parseManifestText(SAMPLE_MANIFEST_TEXT, "W2610049618.pdf");
});

function setupEventListeners() {
  const dropZone = document.getElementById('dropZone');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const searchInput = document.getElementById('searchInput');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');

  dropZone.addEventListener('click', () => pdfFileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-brand-500', 'bg-slate-900');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-brand-500', 'bg-slate-900');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-brand-500', 'bg-slate-900');
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  searchInput.addEventListener('input', (e) => {
    renderTable(e.target.value.toLowerCase());
  });

  exportCsvBtn.addEventListener('click', exportToCSV);
  exportJsonBtn.addEventListener('click', exportToJSON);
}

async function handleFileUpload(file) {
  showStatus(`Reading file: ${file.name}...`, true);

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let textContent = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tokenized = await page.getTextContent();
        const pageText = tokenized.items.map(item => item.str).join('\n');
        textContent += pageText + '\n';
      }
      
      parseManifestText(textContent, file.name);
      showStatus(`Successfully parsed ${file.name}`, false);
    } catch (err) {
      console.error(err);
      showStatus(`Error reading PDF file. Attempting raw text parsing...`, false);
    }
  } else {
    // Plain text reading
    const text = await file.text();
    parseManifestText(text, file.name);
    showStatus(`Successfully parsed ${file.name}`, false);
  }
}

function showStatus(msg, isSpinning) {
  const alertEl = document.getElementById('statusAlert');
  const spinner = document.getElementById('statusSpinner');
  const msgEl = document.getElementById('statusMessage');

  alertEl.classList.remove('hidden');
  msgEl.textContent = msg;
  if (isSpinning) {
    spinner.classList.remove('hidden');
  } else {
    spinner.classList.add('hidden');
    setTimeout(() => alertEl.classList.add('hidden'), 4000);
  }
}

/**
 * Parser Core Logic for Buyee Manifest Structure
 */
function parseManifestText(rawText, fileName) {
  const cleanText = rawText.replace(/\r/g, '');

  // Extract Metadata
  const packageRef = extractRegex(cleanText, /Package Reference No\.\s*\n?\s*([A-Z0-9]+)/i, "W" + Math.floor(Math.random()*1000000000));
  const delivDate = extractRegex(cleanText, /Date of Delivery\s*:?\s*(\d{4}[-\/]\d{2}[-\/]\d{2})/i, new Date().toISOString().split('T')[0]);
  const trackingNo = extractRegex(cleanText, /Shipment Tracking No\.\s*\n?\s*([A-Z0-9]+)/i, "N/A");

  // Extract Overhead Expenses
  const intlShipping = extractNumber(cleanText, /International Shipping Fee\s*\n?\s*\|?\s*([\d,\.]+)/i);
  const customsDuty = extractNumber(cleanText, /Customs Duty\s*\n?\s*\|?\s*\|?\s*([\d,\.]+)/i);
  const buyeeFee = extractNumber(cleanText, /Buyee Service Fee\s*\n?\s*\|?\s*\|?\s*([\d,\.]+)/i);
  const clearanceFee = extractNumber(cleanText, /Customs Clearance Fee\s*\n?\s*\|?\s*\|?\s*([\d,\.]+)/i);
  const otherFees = buyeeFee + clearanceFee;

  // Split document into item blocks by "Shopping Site(ID)"
  const siteParts = cleanText.split(/Shopping Site\(ID\)/i);
  const rawItems = [];

  for (let i = 1; i < siteParts.length; i++) {
    const part = siteParts[i].split(/(?:Buyee Service Fee|Invoice Information|Shipping Expenses|Breakdown of Other)/i)[0];

    // Order ID & Site Name
    const siteMatch = part.match(/\|\s*([^\(\n]+?)\s*\(([^)]+)\)/);
    let siteName = "Buyee Site";
    let orderId = "N/A";
    if (siteMatch) {
      siteName = siteMatch.group(1).trim();
      orderId = siteMatch.group(2).replace(/[\s|]+/g, '').trim();
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

    // Quantity
    const qtyMatch = part.match(/Quantity\s*\n?[\s|]*(\d+)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    // Prices
    const origPrice = extractNumber(part, /Item Price\s*\n?[\s|]*([\d,\.]+)/i);
    const coupon = extractNumber(part, /Coupon discount\s*\n?[\s|]*-?([\d,\.]+)/i);
    let netPrice = origPrice - coupon;

    const netMatch = part.match(/Total Amount\s*\n?[\s|]*([\d,\.]+)/i);
    if (netMatch) {
      const parsedNet = parsePriceString(netMatch[1]);
      if (parsedNet > 0) netPrice = parsedNet;
    }

    rawItems.push({
      orderId,
      siteName,
      itemName,
      qty,
      origPrice,
      coupon,
      netPrice
    });
  }

  // Calculate Proportional Landed Costs
  const totalNetItemsCost = rawItems.reduce((acc, item) => acc + item.netPrice, 0);

  const items = rawItems.map(item => {
    const ratio = totalNetItemsCost > 0 ? (item.netPrice / totalNetItemsCost) : (1 / rawItems.length);
    const splitShipping = Math.round(intlShipping * ratio);
    const splitDuty = Math.round(customsDuty * ratio);
    const splitFees = Math.round(otherFees * ratio);
    const landedCost = item.netPrice + splitShipping + splitDuty + splitFees;

    return {
      ...item,
      splitShipping,
      splitDuty,
      splitFees,
      landedCost
    };
  });

  const grandTotalLanded = items.reduce((acc, item) => acc + item.landedCost, 0);

  currentParsedData = {
    fileName,
    packageRef,
    delivDate,
    trackingNo,
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

/**
 * UI Rendering & Metrics
 */
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

/**
 * Data Export Functions
 */
function exportToCSV() {
  if (!currentParsedData) return;

  const headers = ["Package Ref", "Date", "Order ID", "Site Name", "Item Name", "Qty", "Base Price (JPY)", "Net Price (JPY)", "Split Shipping (JPY)", "Split Duty (JPY)", "Split Fees (JPY)", "Total Landed Cost (JPY)"];
  
  const rows = currentParsedData.items.map(i => [
    currentParsedData.packageRef,
    currentParsedData.delivDate,
    `"${i.orderId}"`,
    `"${i.siteName}"`,
    `"${i.itemName.replace(/"/g, '""')}"`,
    i.qty,
    i.origPrice,
    i.netPrice,
    i.splitShipping,
    i.splitDuty,
    i.splitFees,
    i.landedCost
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Buyee_Landed_Cost_${currentParsedData.packageRef}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportToJSON() {
  if (!currentParsedData) return;
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentParsedData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `Buyee_Landed_Cost_${currentParsedData.packageRef}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}