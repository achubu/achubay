pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const STORAGE_KEY = 'buyee_inventory_data_v1';

const historicalFxTable = {
  "2026-10": 0.00632, "2026-09": 0.00638, "2026-08": 0.00635, "2026-07": 0.00623,
  "2026-06": 0.00628, "2026-05": 0.00638, "2026-04": 0.00628, "2026-03": 0.00633,
  "2025-10": 0.00685, "2025-09": 0.00676, "2025-08": 0.00680, "2025-07": 0.00678
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
      const key = `${parts[2]}-${monthMap[parts[1]]||'10'}`;
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
  const q = document.getElementById('searchInput').value.toLowerCase();
  tbody.innerHTML = '';

  const filtered = p.items.filter(i => 
    (i.itemTitle||'').toLowerCase().includes(q) || (i.seller||'').toLowerCase().includes(q) || (i.orderId||'').toLowerCase().includes(q)
  );

  document.getElementById('displayedCountText').innerText = `Showing ${filtered.length} of ${p.items.length} items`;

  filtered.forEach((item) => {
    const
