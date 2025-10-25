/* main.js - التطبيق الرئيسي */
/* يفترض وجود LZString محمّل عبر CDN في index.html */

let loadedFiles = {};
let currentZoom = 1;
let db = null;
let deferredPrompt = null;

const searchBox = document.getElementById("searchBox");
const resultsContainer = document.getElementById("results");
const errorMessage = document.getElementById("errorMessage");
const successMessage = document.getElementById("successMessage");
const fileViewer = document.getElementById("fileViewer");
const fileTitle = document.getElementById("fileTitle");
const fileContent = document.getElementById("fileContent");
const fileInput = document.getElementById("fileInput");
const loadedFilesList = document.getElementById("loadedFilesList");
const compressFilesCheckbox = document.getElementById("compressFiles");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const storageStatus = document.getElementById("storageStatus");
const storageInfo = document.getElementById("storageInfo");
const installBanner = document.getElementById("installBanner");
const installBtn = document.getElementById("installBtn");
const exactMatchCheckbox = document.getElementById("exactMatch");
const caseSensitiveCheckbox = document.getElementById("caseSensitive");
const searchStats = document.getElementById("searchStats");
const storageUsageDisplay = document.getElementById("storageUsageDisplay");
const checkStorageBtn = document.getElementById("checkStorageBtn");
const clearStorageBtn = document.getElementById("clearStorageBtn");
const noResults = document.getElementById("noResults");

/////////////////////
// PWA install banner
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBanner.style.display = 'block';
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log('Install outcome:', outcome);
  installBanner.style.display = 'none';
  deferredPrompt = null;
});
window.addEventListener('appinstalled', () => {
  installBanner.style.display = 'none';
  showSuccessMessage('تم تثبيت التطبيق بنجاح');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('SW registered', reg.scope))
    .catch(err => console.warn('SW failed', err));
  });
}

/////////////////////
// IndexedDB init + persistent storage
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CarCodesDB', 1);

    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        const store = db.createObjectStore('files', { keyPath: 'fileName' });
        store.createIndex('fileName', 'fileName', { unique: true });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      console.log('IndexedDB opened');
      requestPersistentStorage();
      updateStorageStatus();
      resolve();
    };

    request.onerror = (e) => {
      console.error('IndexedDB error', e);
      reject(e);
    };
  });
}

async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        if (granted) console.log('Persistent storage granted');
        else console.log('Persistent storage denied');
      } else {
        console.log('Persistent storage already active');
      }
    } catch (e) {
      console.warn('Persistent storage check failed', e);
    }
  }
}

/////////////////////
// DB helpers
function saveFileToDB(fileName, content, compress = false) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(['files'], 'readwrite');
    const store = tx.objectStore('files');

    const finalContent = compress ? LZString.compress(content) : content;
    const item = {
      fileName,
      content: finalContent,
      compressed: compress,
      savedAt: new Date().toISOString()
    };

    const req = store.put(item);
    req.onsuccess = () => { resolve(true); updateStorageStatus(); };
    req.onerror = (e) => { reject(e); };
  });
}

function loadFileFromDB(fileName) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(['files'], 'readonly');
    const store = tx.objectStore('files');
    const req = store.get(fileName);
    req.onsuccess = () => {
      if (!req.result) return resolve(null);
      const item = req.result;
      const content = item.compressed ? LZString.decompress(item.content) : item.content;
      resolve(content);
    };
    req.onerror = (e) => reject(e);
  });
}

function getAllFilesFromDB() {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(['files'], 'readonly');
    const store = tx.objectStore('files');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

function clearAllFilesFromDB() {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(['files'], 'readwrite');
    const store = tx.objectStore('files');
    const req = store.clear();
    req.onsuccess = () => { updateStorageStatus(); resolve(); };
    req.onerror = (e) => reject(e);
  });
}

/////////////////////
// Storage usage and UI
async function computeDBSize() {
  // حساب الحجم الإجمالي لمحتويات الملفات بعد فك الضغط (تقريبي بطول النص)
  try {
    const all = await getAllFilesFromDB();
    let total = 0;
    all.forEach(it => {
      if (!it.content) return;
      // إذا مضغوط، حاول فك الضغط لمعرفة الطول؛ وإلا استخدم الطول المباشر
      const content = it.compressed ? (LZString.decompress(it.content) || '') : it.content;
      total += content.length;
    });
    return total; // bytes count of characters (UTF-16 length); للتبسيط نعتبر length bytes
  } catch (e) {
    console.warn('computeDBSize failed', e);
    return 0;
  }
}

async function updateStorageStatus() {
  try {
    // estimate from navigator (quota & usage)
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage / (1024*1024)).toFixed(2);
      const quotaMB = (estimate.quota / (1024*1024)).toFixed(2);
      const percent = ((estimate.usage / estimate.quota) * 100).toFixed(1);
      storageStatus.textContent = `المتصفح: مستخدم ${usedMB}MB من ${quotaMB}MB (${percent}%)`;
    } else {
      storageStatus.textContent = 'إحصاءات التخزين غير مدعومة في هذا المتصفح';
    }

    // حساب تقريبي من DB نفسها
    const dbBytes = await computeDBSize();
    const dbMB = (dbBytes / (1024*1024)).toFixed(2);
    const files = await getAllFilesFromDB();
    storageInfo.textContent = `ملفّات محفوظة: ${files.length} | تقديري: ${dbMB} MB (مضغوط عند الحفظ إذا مفعل)`;

    // عرض شريط في الأعلى
    if (storageUsageDisplay) {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const used = est.usage || 0;
        const quota = est.quota || 1;
        const pct = Math.min(100, Math.round((used / quota) * 100));
        storageUsageDisplay.innerHTML = `المساحة: ${(used/(1024*1024)).toFixed(2)} MB / ${(quota/(1024*1024)).toFixed(2)} MB (${pct}%)`;
      } else {
        storageUsageDisplay.innerHTML = `المساحة: ${dbMB} MB (تقديري)`;
      }
    }

  } catch (e) {
    console.warn('updateStorageStatus failed', e);
    storageStatus.textContent = 'خطأ في قراءة حالة التخزين';
  }
}

/////////////////////
// Loading saved files into memory object
async function loadSavedFiles() {
  try {
    const files = await getAllFilesFromDB();
    loadedFiles = {};
    files.forEach(f => {
      const content = f.compressed ? (LZString.decompress(f.content) || '') : f.content;
      loadedFiles[f.fileName] = content;
    });
    updateLoadedFilesList();
    console.log(`Loaded ${files.length} files into memory`);
  } catch (e) {
    console.error('loadSavedFiles failed', e);
    loadedFiles = {};
  }
}

/////////////////////
// Save all loadedFiles to DB (uses compress checkbox)
async function saveFilesToStorage() {
  if (!db) { showError('قاعدة البيانات غير مهيأة'); return false; }
  try {
    // حساب الحجم تقريبي
    let totalChars = 0;
    Object.keys(loadedFiles).forEach(fn => { totalChars += (loadedFiles[fn]||'').length; });
    // استخدم estimate cuota لجعل حد ديناميكي
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const quota = est.quota || (250 * 1024 * 1024);
      // تقدير: length chars ≈ length bytes (تبسيط)
      if (totalChars > quota) {
        showError('الحجم يتجاوز سعة التخزين المتاحة في المتصفح');
        return false;
      }
    }

    const compress = compressFilesCheckbox.checked;
    for (const fileName in loadedFiles) {
      const content = loadedFiles[fileName];
      await saveFileToDB(fileName, content, compress);
    }
    await updateStorageStatus();
    return true;
  } catch (e) {
    console.error('saveFilesToStorage error', e);
    showError('فشل حفظ الملفات: ' + (e.message || e));
    return false;
  }
}

/////////////////////
// File input handling
fileInput.addEventListener('change', async function(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  showSuccessMessage(`جاري تحميل ${files.length} ملف...`);
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  let loadedCount = 0;

  for (let i=0;i<files.length;i++) {
    const file = files[i];
    if (file.size > 1024*1024) {
      // read by chunks (text)
      const chunkSize = 512 * 1024;
      let chunks = '';
      let offset = 0;
      while (offset < file.size) {
        const slice = file.slice(offset, offset + chunkSize);
        const text = await slice.text();
        chunks += text;
        offset += chunkSize;
      }
      loadedFiles[file.name] = chunks;
    } else {
      const text = await file.text();
      loadedFiles[file.name] = text;
    }

    loadedCount++;
    progressBar.style.width = ((loadedCount / files.length) * 100) + '%';
    updateLoadedFilesList();
  }

  // save automatically
  const ok = await saveFilesToStorage();
  if (ok) showSuccessMessage(`تم تحميل ${files.length} ملفات وحفظها`);
  progressContainer.style.display = 'none';
});

function updateLoadedFilesList() {
  loadedFilesList.innerHTML = '';
  const keys = Object.keys(loadedFiles);
  if (keys.length === 0) {
    loadedFilesList.innerHTML = '<div style="color:#7f8c8d">لا توجد ملفات محملة</div>';
    return;
  }
  keys.forEach(fn => {
    const el = document.createElement('div');
    el.className = 'loaded-file';
    el.textContent = fn;
    el.addEventListener('click', () => showFileContent(fn));
    loadedFilesList.appendChild(el);
  });
}

/////////////////////
// Search logic
// NOTE: expects a global `codes` array (code metadata), if not present it will still allow searching files' content
let codes = window.codes || []; // if you have a JSON codes array, it can be populated externally

let searchTimeout;
function performSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const queryRaw = searchBox.value.trim();
    const exact = exactMatchCheckbox.checked;
    const caseSens = caseSensitiveCheckbox.checked;
    if (!queryRaw) {
      resultsContainer.innerHTML = '';
      searchStats.textContent = '';
      noResults.style.display = 'none';
      return;
    }

    const query = caseSens ? queryRaw : queryRaw.toUpperCase();

    // If codes array exists and not empty, use it for fast metadata search
    let found = [];
    if (codes && codes.length > 0) {
      if (exact) {
        found = codes.filter(it => {
          const code = caseSens ? it.code : it.code.toUpperCase();
          return code === query && loadedFiles[it.file];
        });
      } else {
        found = codes.filter(it => {
          const code = caseSens ? it.code : it.code.toUpperCase();
          return code.includes(query) && loadedFiles[it.file];
        });
      }
    } else {
      // fallback: search filenames and file contents
      Object.keys(loadedFiles).forEach(fileName => {
        const content = loadedFiles[fileName];
        const hay = caseSens ? content : content.toUpperCase();
        if ( (exact && hay === query) || (!exact && hay.includes(query)) || fileName.toUpperCase().includes(query) ) {
          found.push({ code: '—', file: fileName });
        }
      });
    }

    searchStats.textContent = `تم العثور على ${found.length} نتيجة لـ "${queryRaw}"`;
    if (found.length === 0) {
      resultsContainer.innerHTML = `<div class="no-results">🚫 لم يتم العثور على رمز مطابق لـ "${queryRaw}"</div>`;
      noResults.style.display = 'block';
    } else {
      noResults.style.display = 'none';
      resultsContainer.innerHTML = found.map(it => `
        <div class="result-item">
          <div class="result-code">${it.code}</div>
          <a href="#" class="result-file" data-file="${it.file}">📄 ${it.file}</a>
        </div>
      `).join('');
      document.querySelectorAll('.result-file').forEach(a => a.addEventListener('click', handleFileClick));
    }
  }, 250);
}

function handleFileClick(e) {
  e.preventDefault();
  const fn = e.currentTarget.dataset.file;
  showFileContent(fn);
}

/////////////////////
// View file content
function showFileContent(fileName) {
  fileTitle.textContent = fileName;
  fileViewer.style.display = 'flex';
  const content = loadedFiles[fileName];
  if (!content) {
    fileContent.innerHTML = '<div style="padding:12px">محتوى الملف غير متاح.</div>';
    return;
  }
  currentZoom = 1;
  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.transformOrigin = 'top right';
  iframe.srcdoc = `<!doctype html><html lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Tahoma;direction:rtl;padding:15px;margin:0">${content}</body></html>`;
  fileContent.innerHTML = '';
  fileContent.appendChild(iframe);
  updateZoom();
}

function zoomIn(){ currentZoom = Math.min(currentZoom + 0.1, 2); updateZoom(); }
function zoomOut(){ currentZoom = Math.max(currentZoom - 0.1, 0.5); updateZoom(); }
function resetZoom(){ currentZoom = 1; updateZoom(); }
function updateZoom(){ const iframe = fileContent.querySelector('iframe'); if (iframe) iframe.style.transform = `scale(${currentZoom})`; }
function hideFileViewer(){ fileViewer.style.display = 'none'; currentZoom = 1; }

/////////////////////
// Utility UI
function showError(msg){ errorMessage.textContent = msg; errorMessage.style.display='block'; successMessage.style.display='none'; setTimeout(()=>errorMessage.style.display='none',5000); }
function showSuccessMessage(msg){ successMessage.textContent = msg; successMessage.style.display='block'; errorMessage.style.display='none'; setTimeout(()=>successMessage.style.display='none',3000); }

/////////////////////
// Storage controls
checkStorageBtn.addEventListener('click', async () => {
  await updateStorageStatus();
  const files = await getAllFilesFromDB();
  const dbBytes = await computeDBSize();
  showSuccessMessage(`محفوظ: ${files.length} ملف — ${ (dbBytes/(1024*1024)).toFixed(2) } MB`);
});

clearStorageBtn.addEventListener('click', async () => {
  if (!confirm('هل أنت متأكد من مسح كل البيانات؟')) return;
  await clearAllFilesFromDB();
  loadedFiles = {};
  updateLoadedFilesList();
  showSuccessMessage('تم مسح التخزين');
});

/////////////////////
// Events
searchBox.addEventListener('input', performSearch);
exactMatchCheckbox.addEventListener('change', performSearch);
caseSensitiveCheckbox.addEventListener('change', performSearch);
fileViewer.addEventListener('click', e => { if (e.target === fileViewer) hideFileViewer(); });

/////////////////////
// Startup
window.addEventListener('load', async () => {
  try {
    await initDB();
    await loadSavedFiles();
    await updateStorageStatus();
    searchBox.focus();
  } catch (e) {
    console.error('startup error', e);
    showError('فشل تهيئة التطبيق: ' + (e.message || e));
  }
});
