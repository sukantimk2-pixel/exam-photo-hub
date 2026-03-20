/**
 * Smart Exam & Document Photo Hub — Image Engine
 * All processing in-memory. No data stored. Fully free.
 */

const ImageEngine = (() => {
  let state = {
    originalImage: null,
    editedImage: null,
    canvas: null,
    ctx: null,
    outputCanvas: null,
    outputCtx: null,
    filters: { brightness: 0, contrast: 0, saturation: 0, sharpen: 0 },
    rotation: 0,
    flipH: false,
    flipV: false,
    bg: 'white',
    targetW: 200,
    targetH: 230,
    targetKb: 200,
    ratioLocked: true,
    currentExam: null,
    currentType: 'photo'
  };

  // ─── INIT ───────────────────────────────────────────────────────────────────
  function init(canvasId, outputCanvasId) {
    state.canvas = document.getElementById(canvasId);
    state.ctx = state.canvas.getContext('2d');
    state.outputCanvas = document.getElementById(outputCanvasId);
    state.outputCtx = state.outputCanvas.getContext('2d');
  }

  // ─── LOAD IMAGE ─────────────────────────────────────────────────────────────
  function loadImageFromFile(file, callback) {
    if (!file || !file.type.match(/image.*/)) {
      toast('Please upload a valid image file', 'error'); return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast('File size must be under 20MB', 'error'); return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        state.originalImage = img;
        state.rotation = 0; state.flipH = false; state.flipV = false;
        state.filters = { brightness: 0, contrast: 0, saturation: 0, sharpen: 0 };
        resetSliders();
        render();
        if (callback) callback(img);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  function render() {
    if (!state.originalImage) return;
    const img = state.originalImage;

    // Work canvas
    state.canvas.width  = img.width;
    state.canvas.height = img.height;
    const ctx = state.ctx;

    ctx.save();
    ctx.translate(img.width / 2, img.height / 2);
    ctx.rotate(state.rotation * Math.PI / 180);
    if (state.flipH) ctx.scale(-1, 1);
    if (state.flipV) ctx.scale(1, -1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    // Apply filters via ImageData
    applyFilters(ctx, img.width, img.height);
    renderOutput();
  }

  function applyFilters(ctx, w, h) {
    const f = state.filters;
    if (!f.brightness && !f.contrast && !f.saturation && !f.sharpen) return;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i+1], b = d[i+2];
      // Brightness
      if (f.brightness) { r += f.brightness * 2.55; g += f.brightness * 2.55; b += f.brightness * 2.55; }
      // Contrast
      if (f.contrast) {
        const c = (100 + f.contrast) / 100;
        r = (r / 255 - .5) * c * 255 + 128;
        g = (g / 255 - .5) * c * 255 + 128;
        b = (b / 255 - .5) * c * 255 + 128;
      }
      // Saturation
      if (f.saturation) {
        const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const factor = 1 + f.saturation / 100;
        r = grey + (r - grey) * factor;
        g = grey + (g - grey) * factor;
        b = grey + (b - grey) * factor;
      }
      d[i]   = Math.max(0, Math.min(255, r));
      d[i+1] = Math.max(0, Math.min(255, g));
      d[i+2] = Math.max(0, Math.min(255, b));
    }
    // Sharpen convolution
    if (f.sharpen > 0) {
      const strength = f.sharpen / 100;
      const kern = [0,-strength,0, -strength,1+4*strength,-strength, 0,-strength,0];
      const src = new Uint8ClampedArray(d);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            let val = 0;
            for (let ky = -1; ky <= 1; ky++)
              for (let kx = -1; kx <= 1; kx++)
                val += src[((y+ky)*w+(x+kx))*4+c] * kern[(ky+1)*3+(kx+1)];
            d[idx+c] = Math.max(0, Math.min(255, val));
          }
        }
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  // ─── OUTPUT RENDER ──────────────────────────────────────────────────────────
  function renderOutput() {
    const oc = state.outputCanvas;
    oc.width  = state.targetW;
    oc.height = state.targetH;
    const ctx2 = state.outputCtx;

    // Background
    ctx2.fillStyle = state.bg === 'transparent' ? 'rgba(0,0,0,0)' : state.bg;
    ctx2.fillRect(0, 0, oc.width, oc.height);

    // Draw source canvas scaled to fit
    const sw = state.canvas.width, sh = state.canvas.height;
    const scale = Math.min(oc.width / sw, oc.height / sh);
    const dw = sw * scale, dh = sh * scale;
    const dx = (oc.width - dw) / 2, dy = (oc.height - dh) / 2;
    ctx2.drawImage(state.canvas, dx, dy, dw, dh);

    updatePreviewMeta();
  }

  // ─── BG REMOVAL ─────────────────────────────────────────────────────────────
  function removeBackground(tolerance = 30) {
    if (!state.originalImage) return;
    const tmp = document.createElement('canvas');
    tmp.width = state.canvas.width; tmp.height = state.canvas.height;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(state.canvas, 0, 0);
    const id = tCtx.getImageData(0, 0, tmp.width, tmp.height);
    const d = id.data;
    const w = tmp.width, h = tmp.height;

    // Sample corners
    const corners = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]
    ];
    const bgColors = corners.map(([x, y]) => {
      const i = (y * w + x) * 4;
      return [d[i], d[i+1], d[i+2]];
    });

    // Flood-fill mask via BFS from corners
    const visited = new Uint8Array(w * h);
    const queue = [];
    corners.forEach(([x, y]) => { if (!visited[y * w + x]) { visited[y * w + x] = 1; queue.push([x, y]); } });

    while (queue.length) {
      const [x, y] = queue.shift();
      const i = (y * w + x) * 4;
      const pr = d[i], pg = d[i+1], pb = d[i+2];
      const close = bgColors.some(([br, bg, bb]) => Math.abs(pr - br) + Math.abs(pg - bg) + Math.abs(pb - bb) < tolerance * 3);
      if (!close) continue;
      d[i+3] = 0;
      const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      neighbors.forEach(([nx, ny]) => {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny * w + nx]) {
          visited[ny * w + nx] = 1; queue.push([nx, ny]);
        }
      });
    }
    tCtx.putImageData(id, 0, 0);

    // Draw result back to main canvas
    state.ctx.clearRect(0, 0, w, h);
    state.ctx.drawImage(tmp, 0, 0);
    renderOutput();
    toast('Background removed', 'success');
  }

  // ─── CONTROLS ───────────────────────────────────────────────────────────────
  function rotate(deg) {
    state.rotation = (state.rotation + deg + 360) % 360;
    render();
  }
  function flip(axis) {
    if (axis === 'h') state.flipH = !state.flipH;
    else state.flipV = !state.flipV;
    render();
  }
  function setBackground(color) {
    state.bg = color;
    renderOutput();
  }
  function setFilter(name, value) {
    state.filters[name] = parseInt(value);
    render();
  }
  function setDimension(axis, value) {
    const v = parseInt(value);
    if (isNaN(v) || v < 1) return;
    if (axis === 'w') {
      if (state.ratioLocked && state.targetH) {
        state.targetH = Math.round(v * state.targetH / state.targetW);
        syncSizeInputs();
      }
      state.targetW = v;
    } else {
      if (state.ratioLocked && state.targetW) {
        state.targetW = Math.round(v * state.targetW / state.targetH);
        syncSizeInputs();
      }
      state.targetH = v;
    }
    renderOutput();
  }
  function setExamSpec(spec, type) {
    if (!spec) return;
    const s = type === 'signature' ? spec.signature : spec.photo;
    if (!s) return;
    state.targetW = s.w; state.targetH = s.h; state.targetKb = s.kb;
    state.currentExam = spec; state.currentType = type;
    syncSizeInputs();
    updateSpecBanner(s);
    renderOutput();
  }
  function toggleRatioLock() {
    state.ratioLocked = !state.ratioLocked;
    return state.ratioLocked;
  }

  // ─── DOWNLOAD ───────────────────────────────────────────────────────────────
  async function download(filename, format) {
    if (!state.originalImage && !state.outputCanvas.width) {
      toast('Please upload an image first', 'error'); return;
    }
    const fmt = format || 'jpeg';
    const mimeMap = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp' };
    const mime = mimeMap[fmt] || 'image/jpeg';

    // Compress to KB target
    let quality = 0.95;
    let dataUrl;
    do {
      dataUrl = state.outputCanvas.toDataURL(mime, quality);
      const kb = Math.round(dataUrl.length * 0.75 / 1024);
      if (kb <= state.targetKb || quality < 0.1) break;
      quality -= 0.05;
    } while (true);

    const fn = (filename || 'exam_photo') + '.' + fmt;
    const a = document.createElement('a');
    a.href = dataUrl; a.download = fn; a.click();
    toast(`Downloaded: ${fn}`, 'success');
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  function updatePreviewMeta() {
    const el = document.getElementById('edited-meta');
    if (!el) return;
    const dataUrl = state.outputCanvas.toDataURL('image/jpeg', 0.85);
    const kb = Math.round(dataUrl.length * 0.75 / 1024);
    el.textContent = `${state.targetW}×${state.targetH}px · ~${kb}KB`;
  }
  function syncSizeInputs() {
    const wEl = document.getElementById('size-w');
    const hEl = document.getElementById('size-h');
    if (wEl) wEl.value = state.targetW;
    if (hEl) hEl.value = state.targetH;
  }
  function resetSliders() {
    ['brightness','contrast','saturation','sharpen'].forEach(id => {
      const el = document.getElementById('sl-' + id);
      const val = document.getElementById('val-' + id);
      if (el) { el.value = 0; }
      if (val) val.textContent = '0';
    });
  }
  function updateSpecBanner(s) {
    const setEl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    setEl('spec-w', s.w + 'px');
    setEl('spec-h', s.h + 'px');
    setEl('spec-kb', s.kb + 'KB');
    setEl('spec-bg', s.bg || 'white');
    setEl('spec-fmt', (s.fmt || 'jpg').toUpperCase());
    const banner = document.getElementById('spec-banner');
    if (banner) banner.classList.remove('hidden');
  }

  return { init, loadImageFromFile, render, removeBackground, rotate, flip,
           setBackground, setFilter, setDimension, setExamSpec, toggleRatioLock,
           download, state };
})();

// ─── TOAST ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container'; el.className = 'toast-container';
    document.body.appendChild(el); return el;
  })();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

// ─── DB LOADER ──────────────────────────────────────────────────────────────
let DB = null;
async function loadDB() {
  if (DB) return DB;
  const base = document.querySelector('base')?.href || './';
  const path = base.includes('pages/') ? '../data/exams.json' : 'data/exams.json';
  const res = await fetch(path);
  DB = await res.json();
  return DB;
}

// ─── DROPDOWN BUILDER ────────────────────────────────────────────────────────
async function buildDropdowns(catEl, examEl, defaultState) {
  const db = await loadDB();
  catEl.innerHTML = `
    <option value="">— Select Category —</option>
    <option value="central">Central Exams</option>
    ${db.states.map(s => `<option value="state_${s.code}">${s.name}</option>`).join('')}
    <option value="documents">Government Documents</option>
  `;
  if (defaultState) {
    const opt = catEl.querySelector(`option[value="state_${defaultState}"]`);
    if (opt) opt.selected = true;
  }
  catEl.addEventListener('change', () => populateExams(catEl.value, examEl, db));
  populateExams(catEl.value, examEl, db);
}

function populateExams(catValue, examEl, db) {
  examEl.innerHTML = '<option value="">— Select Exam/Document —</option>';
  if (!catValue) return;
  let items = [];
  if (catValue === 'central') items = db.central_exams.map(e => ({ id: e.id, name: e.name, data: e }));
  else if (catValue === 'documents') items = db.documents.map(e => ({ id: e.id, name: e.name, data: e }));
  else {
    const code = catValue.replace('state_', '');
    const st = db.states.find(s => s.code === code);
    if (st) items = st.exams.map(e => ({ id: e.id, name: e.name, data: e }));
  }
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    opt.dataset.spec = JSON.stringify(item.data);
    examEl.appendChild(opt);
  });
}

function getSelectedSpec(examEl) {
  const opt = examEl.options[examEl.selectedIndex];
  if (!opt || !opt.dataset.spec) return null;
  try { return JSON.parse(opt.dataset.spec); } catch { return null; }
}

// ─── PDF ENGINE (wrapper for jsPDF + pdfjs) ──────────────────────────────────
const PDFEngine = (() => {
  async function imagesToPDF(files, pageSize, orientation, callback) {
    const { jsPDF } = window.jspdf;
    const sizes = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] };
    const [pw, ph] = orientation === 'landscape'
      ? [sizes[pageSize]?.[1] || 297, sizes[pageSize]?.[0] || 210]
      : [sizes[pageSize]?.[0] || 210, sizes[pageSize]?.[1] || 297];
    const doc = new jsPDF({ orientation, unit: 'mm', format: [pw, ph] });
    const margin = 5;
    for (let i = 0; i < files.length; i++) {
      if (i > 0) doc.addPage([pw, ph], orientation);
      const dataUrl = await fileToDataUrl(files[i]);
      const imgInfo = await getImageDimensions(dataUrl);
      const maxW = pw - margin * 2, maxH = ph - margin * 2;
      const scale = Math.min(maxW / imgInfo.w, maxH / imgInfo.h);
      const iw = imgInfo.w * scale, ih = imgInfo.h * scale;
      const ix = (pw - iw) / 2, iy = (ph - ih) / 2;
      doc.addImage(dataUrl, 'JPEG', ix, iy, iw, ih);
      if (callback) callback(Math.round((i + 1) / files.length * 100));
    }
    return doc;
  }

  async function pdfToImages(file, callback) {
    const dataUrl = await fileToDataUrl(file);
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: atob(dataUrl.split(',')[1]) }).promise;
    const images = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      images.push(c.toDataURL('image/jpeg', 0.9));
      if (callback) callback(Math.round(i / pdf.numPages * 100));
    }
    return images;
  }

  async function mergePDFs(files, callback) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let first = true;
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'pdf') {
        const imgs = await pdfToImages(file);
        for (let ii = 0; ii < imgs.length; ii++) {
          if (!first) doc.addPage(); first = false;
          doc.addImage(imgs[ii], 'JPEG', 5, 5, 200, 287);
        }
      } else {
        if (!first) doc.addPage(); first = false;
        const dataUrl = await fileToDataUrl(file);
        doc.addImage(dataUrl, 'JPEG', 5, 5, 200, 287);
      }
      if (callback) callback(Math.round((fi + 1) / files.length * 100));
    }
    return doc;
  }

  async function extractText(file, progressEl) {
    const dataUrl = await fileToDataUrl(file);
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: atob(dataUrl.split(',')[1]) }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += `\n=== Page ${i} ===\n`;
      text += content.items.map(item => item.str).join(' ');
      if (progressEl) progressEl.style.width = Math.round(i / pdf.numPages * 100) + '%';
    }
    return text.trim();
  }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function getImageDimensions(dataUrl) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.width, h: img.height });
      img.src = dataUrl;
    });
  }

  return { imagesToPDF, pdfToImages, mergePDFs, extractText };
})();
