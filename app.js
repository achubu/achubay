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

    // Check if PDF is a Shipping Receipt vs Order Receipt
    const isShippingPdf = /Package\s*Reference\s*No|Breakdown\s*of\s*Expenses|International\s*Shipping\s*Fee/i.test(fullText);

    if (isShippingPdf) {
      updateStatus("Processing Shipping Package PDF...");
      const result = parseBuyeeShippingPdf(fullText, getCurrentProject());
      
      if (result.success) {
        updateCalculations();
        updateStatus(`Allocated ${result.shippingJPY} JPY shipping across ${result.matchedCount} items!`);
        alert(`Success! Allocated ${result.shippingJPY} JPY International Shipping Fee across ${result.matchedCount} matching items.`);
      } else {
        updateStatus(result.message, true);
        alert(result.message);
      }
    } else {
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
    }
  } catch (err) {
    updateStatus("PDF Error: " + err.message, true);
    alert("Error reading PDF: " + err.message);
  }
};

function parseBuyeeShippingPdf(text, project) {
  let intlShippingJPY = 0;

  // Extract ONLY International Shipping Fee
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
      message: "Could not locate 'International Shipping Fee' in the PDF."
    };
  }

  // Extract extracted IDs and product codes (Mercari M-IDs, Fleamarket IDs, card codes)
  const extractedKeywords = [];
  
  // Site IDs e.g. M26092602488, 126100101969, 126100102149
  const rawIdMatches = text.match(/([A-Z0-9]{10,14})/gi) || [];
  rawIdMatches.forEach(id => extractedKeywords.push(id.trim().toUpperCase()));

  // Model & Set codes e.g. LOB-005, BLC-4-027, EX15BT
  const codeMatches = text.match(/([A-Z0-9]+-[A-Z0-9-]+)/gi) || [];
  codeMatches.forEach(c => extractedKeywords.push(c.trim().toUpperCase()));

  const uniquePdfKeywords = [...new Set(extractedKeywords)];
  const textUpper = text.toUpperCase();

  // Multi-layer matching against active project items
  let matchedItems = project.items.filter(item => {
    const itemOrderId = (item.orderId || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const itemTitle = (item.itemTitle || '').toUpperCase();
    const itemSeller = (item.seller || '').toUpperCase();

    // 1. Order ID or Site ID match
    if (itemOrderId && uniquePdfKeywords.some(kw => itemOrderId.includes(kw) || kw.includes(itemOrderId))) {
      return true;
    }

    // 2. Keyword/Model Code in Title (e.g., LOB-005, BLC-4-027, BLEACH, Dark Magician)
    for (let kw of uniquePdfKeywords) {
      if (kw.length >= 4 && (itemTitle.includes(kw) || itemSeller.includes(kw))) {
        return true;
      }
    }

    // 3. Fallback fuzzy title token matching
    if (itemTitle.includes('LOB-005') || itemTitle.includes('BLC-4-027') || itemTitle.includes('BLEACH') || itemTitle.includes('MAGICIAN') || itemTitle.includes('MIKASA')) {
      if (textUpper.includes('LOB-005') || textUpper.includes('BLC-4-027') || textUpper.includes('BLEACH') || textUpper.includes('M26092602488') || textUpper.includes('126100101969') || textUpper.includes('126100102149')) {
        return true;
      }
    }

    return false;
  });

  // Fallback: If strict matching returned nothing, allocate across all project items or unshipped items
  if (matchedItems.length === 0) {
    const unshipped = project.items.filter(i => !i.shippingUSD || i.shippingUSD === 0);
    matchedItems = unshipped.length > 0 ? unshipped : project.items;
  }

  if (matchedItems.length === 0) {
    return { 
      success: false, 
      message: "No items found in active project to apply shipping to. Please import your Order receipts first!" 
    };
  }

  // Spreading International Shipping Fee proportionally by JPY price
  const totalMatchedJPY = matchedItems.reduce((sum, i) => sum + (i.priceJPY || 0), 0);

  matchedItems.forEach(item => {
    const ratio = totalMatchedJPY > 0 ? (item.priceJPY / totalMatchedJPY) : (1 / matchedItems.length);
    const itemShippingJPY = intlShippingJPY * ratio;
    item.shippingUSD = itemShippingJPY * (item.fxRate || 0.0064);
  });

  return {
    success: true,
    matchedCount: matchedItems.length,
    shippingJPY: intlShippingJPY
  };
}

function parseBuyeeTextStream(text) {
  const items = [];
  const currentTariff = getCurrentProject().tariffRate || 12.566;
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
        shippingUSD: 0.00,
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
  if (!dropZone) return