/* Meme Studio — 100% client-side meme editor.
 *
 * Nothing here ever talks to a server: the image you pick is read with
 * FileReader, drawn onto a <canvas>, and exported with canvas.toDataURL /
 * canvas.toBlob. Your photo never leaves the browser tab.
 */

(() => {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  // --- State -----------------------------------------------------------------
  const state = {
    img: null,            // current image source (HTMLImageElement or canvas)
    fontSize: 64,         // relative to an 800px canvas
    color: '#ffffff',
    uppercase: true,
    captions: {
      top: { text: '', x: 0.5, y: 0.10 },     // x,y are fractions of canvas
      bottom: { text: '', x: 0.5, y: 0.90 },
    },
  };

  const COLORS = ['#ffffff', '#ffe14d', '#ff5470', '#34d399', '#000000'];

  // --- Original starter backdrops (drawn with canvas — nothing copyrighted) --
  // Each returns a freshly painted offscreen canvas. Purely abstract gradients
  // and shapes that we authored here; no third-party / meme-template imagery.
  const STARTERS = [
    {
      name: 'Indigo dusk',
      paint(c) {
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, c.width, c.height);
        g.addColorStop(0, '#6366f1');
        g.addColorStop(1, '#a78bfa');
        x.fillStyle = g;
        x.fillRect(0, 0, c.width, c.height);
        // soft glow blob
        const r = x.createRadialGradient(c.width * 0.72, c.height * 0.28, 0, c.width * 0.72, c.height * 0.28, c.width * 0.5);
        r.addColorStop(0, 'rgba(255,255,255,0.35)');
        r.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = r;
        x.fillRect(0, 0, c.width, c.height);
      },
    },
    {
      name: 'Sunset',
      paint(c) {
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, c.height);
        g.addColorStop(0, '#fb7185');
        g.addColorStop(0.55, '#f59e0b');
        g.addColorStop(1, '#fcd34d');
        x.fillStyle = g;
        x.fillRect(0, 0, c.width, c.height);
      },
    },
    {
      name: 'Mint',
      paint(c) {
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, c.width, c.height);
        g.addColorStop(0, '#10b981');
        g.addColorStop(1, '#22d3ee');
        x.fillStyle = g;
        x.fillRect(0, 0, c.width, c.height);
      },
    },
    {
      name: 'Charcoal',
      paint(c) {
        const x = c.getContext('2d');
        x.fillStyle = '#0f172a';
        x.fillRect(0, 0, c.width, c.height);
        // subtle dot grid for texture
        x.fillStyle = 'rgba(255,255,255,0.06)';
        const step = 46;
        for (let yy = step; yy < c.height; yy += step) {
          for (let xx = step; xx < c.width; xx += step) {
            x.beginPath();
            x.arc(xx, yy, 2.2, 0, Math.PI * 2);
            x.fill();
          }
        }
      },
    },
  ];

  // --- Rendering -------------------------------------------------------------

  // Draw a single caption with the classic Impact look: white (or chosen) fill
  // plus a thick black outline, centered at the caption's anchor.
  function drawCaption(cap, anchorBaseline) {
    const text = state.uppercase ? cap.text.toUpperCase() : cap.text;
    if (!text.trim()) return;

    const size = state.fontSize;
    ctx.font = `700 ${size}px Impact, "Anton", "Arial Narrow", "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = anchorBaseline; // 'top' for top caption, 'bottom' for bottom
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const maxWidth = canvas.width * 0.92;
    const lines = wrapText(text, maxWidth, ctx);
    const lineHeight = size * 1.08;
    const cx = cap.x * canvas.width;

    // Stack lines downward from a top anchor, upward from a bottom anchor.
    lines.forEach((line, i) => {
      let y;
      if (anchorBaseline === 'top') {
        y = cap.y * canvas.height + i * lineHeight;
      } else {
        y = cap.y * canvas.height - (lines.length - 1 - i) * lineHeight;
      }
      ctx.lineWidth = Math.max(4, size * 0.16);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = state.color;
      ctx.strokeText(line, cx, y);
      ctx.fillText(line, cx, y);
    });
  }

  function wrapText(text, maxWidth, context) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (context.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.img) {
      // Cover-fit the source image into the square canvas.
      const iw = state.img.width;
      const ih = state.img.height;
      const scale = Math.max(canvas.width / iw, canvas.height / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (canvas.width - dw) / 2;
      const dy = (canvas.height - dh) / 2;
      ctx.drawImage(state.img, dx, dy, dw, dh);
    }

    drawCaption(state.captions.top, 'top');
    drawCaption(state.captions.bottom, 'bottom');

    document.getElementById('dropHint').style.display = state.img ? 'none' : 'grid';
  }

  // --- Image loading (FileReader — stays in the browser) ---------------------

  function loadFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('That file is not an image');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.img = img;
        render();
      };
      img.onerror = () => toast('Could not read that image');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function loadStarter(index) {
    const def = STARTERS[index];
    const off = document.createElement('canvas');
    off.width = 800;
    off.height = 800;
    def.paint(off);
    state.img = off;
    render();
    document.querySelectorAll('.starter').forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });
  }

  // --- Export ----------------------------------------------------------------

  function download() {
    if (!state.img && !hasCaptions()) {
      toast('Pick an image first');
      return;
    }
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meme.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Saved meme.png');
  }

  async function copyImage() {
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('Copy not supported — use Download');
      return;
    }
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied to clipboard');
    } catch (err) {
      toast('Copy blocked — use Download');
    }
  }

  function hasCaptions() {
    return state.captions.top.text.trim() || state.captions.bottom.text.trim();
  }

  // --- Drag-to-reposition captions -------------------------------------------

  let dragging = null;

  function pointToCanvas(evt) {
    const rect = canvas.getBoundingClientRect();
    const p = evt.touches ? evt.touches[0] : evt;
    return {
      x: ((p.clientX - rect.left) / rect.width),
      y: ((p.clientY - rect.top) / rect.height),
    };
  }

  function captionHitAt(pt) {
    // Whichever caption's anchor is nearer (within a generous band) wins.
    const half = (state.fontSize / canvas.height) * 1.4;
    let best = null;
    let bestDist = Infinity;
    for (const key of ['top', 'bottom']) {
      const cap = state.captions[key];
      if (!cap.text.trim()) continue;
      const d = Math.abs(pt.y - cap.y);
      if (d < half && d < bestDist) {
        bestDist = d;
        best = key;
      }
    }
    return best;
  }

  function startDrag(evt) {
    const pt = pointToCanvas(evt);
    const hit = captionHitAt(pt);
    if (!hit) return;
    dragging = hit;
    canvas.classList.add('dragging');
    evt.preventDefault();
  }

  function moveDrag(evt) {
    if (!dragging) return;
    const pt = pointToCanvas(evt);
    const cap = state.captions[dragging];
    cap.x = clamp(pt.x, 0.08, 0.92);
    cap.y = clamp(pt.y, 0.05, 0.95);
    render();
    evt.preventDefault();
  }

  function endDrag() {
    dragging = null;
    canvas.classList.remove('dragging');
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // --- UI wiring -------------------------------------------------------------

  function buildStarters() {
    const wrap = document.getElementById('starters');
    STARTERS.forEach((def, i) => {
      const btn = document.createElement('button');
      btn.className = 'starter';
      btn.title = def.name;
      btn.setAttribute('aria-label', `Backdrop: ${def.name}`);
      const thumb = document.createElement('canvas');
      thumb.width = 120;
      thumb.height = 120;
      def.paint(thumb);
      btn.appendChild(thumb);
      btn.addEventListener('click', () => loadStarter(i));
      wrap.appendChild(btn);
    });
  }

  function buildSwatches() {
    const wrap = document.getElementById('swatches');
    COLORS.forEach((col, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (col === state.color ? ' active' : '');
      b.style.background = col;
      b.title = col;
      b.setAttribute('aria-label', `Text color ${col}`);
      b.addEventListener('click', () => {
        state.color = col;
        document.querySelectorAll('.swatch').forEach((el) => el.classList.remove('active'));
        b.classList.add('active');
        render();
      });
      wrap.appendChild(b);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  function init() {
    buildStarters();
    buildSwatches();

    // Default backdrop so the canvas is never blank/intimidating.
    loadStarter(0);

    document.getElementById('fileInput').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) loadFromFile(e.target.files[0]);
      document.querySelectorAll('.starter').forEach((el) => el.classList.remove('active'));
    });

    document.getElementById('topText').addEventListener('input', (e) => {
      state.captions.top.text = e.target.value;
      render();
    });
    document.getElementById('bottomText').addEventListener('input', (e) => {
      state.captions.bottom.text = e.target.value;
      render();
    });

    document.getElementById('fontSize').addEventListener('input', (e) => {
      state.fontSize = parseInt(e.target.value, 10);
      render();
    });
    document.getElementById('uppercase').addEventListener('change', (e) => {
      state.uppercase = e.target.checked;
      render();
    });

    document.getElementById('downloadBtn').addEventListener('click', download);
    document.getElementById('copyBtn').addEventListener('click', copyImage);
    document.getElementById('resetBtn').addEventListener('click', () => {
      state.captions.top = { text: '', x: 0.5, y: 0.10 };
      state.captions.bottom = { text: '', x: 0.5, y: 0.90 };
      document.getElementById('topText').value = '';
      document.getElementById('bottomText').value = '';
      loadStarter(0);
      toast('Reset');
    });

    // Drag captions (mouse + touch).
    canvas.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);
    canvas.addEventListener('touchstart', startDrag, { passive: false });
    canvas.addEventListener('touchmove', moveDrag, { passive: false });
    canvas.addEventListener('touchend', endDrag);

    // Drag & drop a file onto the canvas.
    const wrap = document.querySelector('.canvas-wrap');
    ['dragenter', 'dragover'].forEach((ev) =>
      wrap.addEventListener(ev, (e) => {
        e.preventDefault();
        wrap.classList.add('drag-over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      wrap.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === 'dragleave' && wrap.contains(e.relatedTarget)) return;
        wrap.classList.remove('drag-over');
      })
    );
    wrap.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        loadFromFile(file);
        document.querySelectorAll('.starter').forEach((el) => el.classList.remove('active'));
      }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
