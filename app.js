/**
 * Buyee Shipping Manifest & Landed Cost Parser Engine (with Automatic OCR Fallback)
 */

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
  showStatus(`Reading file: ${file.name}...`, false);

  try {
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        const pageLines = [];
        let currentLine = [];
        let lastY = null;

        for (const item of textContent.items) {
          const strVal = item.str ? item.str.trim() : '';
          if (!strVal) continue;

          const y = item.transform ? item.transform[5] : null;

          if (lastY !== null && y !== null && Math.abs(y - lastY) > 3.0) {
            if (currentLine.length > 0) {
              pageLines.push(currentLine.join(' '));
              currentLine = [];
            }
          }

          currentLine.push(strVal);
          if (y !== null) lastY = y;

          if (item.hasEOL) {
            if (currentLine.length > 0) {
              pageLines.push(currentLine.join(' '));
              currentLine = [];
            }
            lastY = null;
          }
        }

        if (currentLine.length > 0) {
          pageLines.push(currentLine.join(' '));
        }

        fullText += pageLines.join('\n') + '\n';
      }

      // If no text layer found, run Tesseract.js OCR automatically
      if (!fullText.trim() || fullText.trim().length < 30) {
        showStatus(`No embedded text detected in ${file.name}. Running browser OCR engine...`, false);
        fullText = await performOcrOnPdf(pdf);
      }

      document.getElementById('rawTextArea').value = fullText;
      parseManifestText(fullText, file.name);

    } else {
      const text = await file.text();
      document.getElementById('rawTextArea').value = text;
      parseManifestText(text, file.name);
    }
  } catch (err) {
    console.error("PDF Reading Error:", err);
    showStatus(`Error reading PDF: ${err.message}`, true);
  }
}

/**
 * Optical Character Recognition (OCR) Engine for Scanned Image PDFs
 */
async function performOcrOnPdf(pdf) {
  let ocrText = '';
  if (typeof Tesseract === 'undefined') {
    showStatus("Tesseract OCR library not loaded. Check internet connection.", true);
    return "";
  }

  const worker = await Tesseract.createWorker('eng');

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    showStatus(`Scanning page ${pageNum} of ${pdf.numPages} using OCR...`, false);
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    const { data } = await worker.recognize(canvas);
    ocrText += data.text + '\n';
  }

  await worker.terminate();
  return ocrText;
}

function showStatus(msg, isError) {
  const alertEl = document.getElementById('statusAlert');
  const msgEl = document.getElementById('statusMessage');

  alertEl.classList.remove('hidden');
  msgEl.textContent = msg;
  alertEl.className = isError
    ? "p-3 rounded-lg text-xs flex items-center justify-between bg-red-950/80 border border-red-800 text-red-200"
    : "p-3 rounded-lg text-xs flex items-center justify-between bg-emerald-950/80 border border-emerald-800 text-emerald-200";
}

/**
 * Robust Buyee Manifest Parser Engine
 */
function parseManifestText(rawText, fileName) {
  const cleanText = rawText.replace(/\r/g, '');

  const packageRef = extractRegex(cleanText, /Package\s*Reference\s*No\.?\s*[\n\r\s|]*([A-Z0-9]+)/i, "N/A");
  const delivDate = extractRegex(cleanText, /Date\s*of\s*Delivery\s*:?\s*[\n\r\s|]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i, "N/A");

  const intlShipping = extractPriceNumber(cleanText, /International\s*Shipping\s*Fee[\s\S]*?([\d,\.]{3,})/i);
  const customsDuty = extractPriceNumber(cleanText, /Customs\s*Duty[\s\S]*?([\d,\.]{3,})/i);
  const buyeeFee = extractPriceNumber(cleanText, /Buyee\s*Service\s*Fee[\s\S]*?([\d,\.]{3,})/i);
  const clearanceFee = extractPriceNumber(cleanText, /Customs\s*Clearance\s*Fee[\s\S]*?([\d,\.]{3,})/i);
  const otherFees = buyeeFee + clearanceFee;

  const siteParts = cleanText.split(/Shopping[\s|]*Site/i);
  const rawItems = [];

  for (let i = 1; i < siteParts.length; i++) {
    const block = siteParts[i].split(/(?:Buyee\s*Service\s*Fee|Invoice\s*Information|Shipping\s*Expenses|Customs\s*Duties|Breakdown\s*of\s*Other)/i)[0];

    const idMatch = block.match(/\(\s*([A-Za-z0-9_-]{8,20})[\s\vert{}]*\)/i);
    const orderId = idMatch ? idMatch[1].trim() : "N/A";

    let siteName = "Buyee Site";
    if (orderId !== "N/A") {
      const siteMatch = block.match(new RegExp('([A-Za-z0-9_ \\.-]+?)\\s*\\(\\s*' + orderId, 'i'));
      if (siteMatch) {
        siteName = siteMatch[1].replace(/\n/g, ' ').replace(/^[|\s]+/, '').trim();
      }
    }

    const nameMatch = block.match(/Item[\s|]*Name[\s|]*\n?([\s\S]+?)(?=\n?[\s|]*Quantity)/i);
    let itemName = "Item";
    if (nameMatch) {
      const lines = nameMatch[1].split('\n')
        .map(l => l.replace(/^[|\s]+/, '').trim())
        .filter(l => l && l !== '|');
      itemName = lines.join(' ');
    }

    const qtyMatch = block.match(/Quantity[\s\S]*?(\d+)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    const origPrice = extractPriceNumber(block, /Item[\s|]*Price[\s\S]*?([\d,\.]{3,})/i);
    const coupon = extractPriceNumber(block, /Coupon[\s|]*discount[\s\S]*?(-?[\d,\.]{3,})/i);
    let netPrice = extractPriceNumber(block, /Total[\s|]*Amount[\s\S]*?([\d,\.]{3,})/i);

    if (netPrice === 0 && origPrice > 0) {
      netPrice = origPrice - coupon;
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

  if (items.length > 0) {
    showStatus(`Successfully extracted ${items.length} item(s) from ${fileName}`, false);
  } else {
    showStatus(`Document parsed, but no valid line items matched. Check 'Paste / View Raw Text' tab.`, true);
  }
}

function extractRegex(text, regex, defaultValue) {
  const match = text.match(regex);
  return match ? match[1].trim() : defaultValue;
}

function extractPriceNumber(text, regex) {
  const match = text.match(regex);
  if (!match) return 0;
  const clean = match[1].replace(/[^\d]/g, '');
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
    tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-500">No line items found in manifest.</td></tr>`;
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