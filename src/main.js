import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './style.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(str, lang) {
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${md.utils.escapeHtml(str)}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        // fall through to escaped output
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(texmath, { engine: katex, delimiters: 'dollars' });

mermaid.initialize({
  startOnLoad: false,
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
});

const contentEl = document.getElementById('content');
let currentDoc = null;
let currentPdf = null;

function showError(err) {
  contentEl.innerHTML = `<p class="mermaid-error">${md.utils.escapeHtml(String(err))}</p>`;
}

async function renderMarkdown(doc) {
  contentEl.innerHTML = md.render(doc.content ?? '');
  for (const node of contentEl.querySelectorAll('.mermaid')) {
    try {
      await mermaid.run({ nodes: [node] });
    } catch (e) {
      node.innerHTML = `<code class="mermaid-error">${md.utils.escapeHtml(String(e))}</code>`;
    }
  }
}

async function renderPdf() {
  if (currentPdf) {
    currentPdf.destroy();
    currentPdf = null;
  }
  const bytes = new Uint8Array(await invoke('read_bytes'));
  const pdf = await getDocument({ data: bytes }).promise;
  currentPdf = pdf;

  const viewer = document.createElement('div');
  viewer.className = 'pdf-viewer';
  contentEl.appendChild(viewer);

  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(200, viewer.clientWidth);
  const pages = [];

  async function scrollToDest(dest) {
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return;
      const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      const target = pages[index];
      if (!target) return;
      target.div.scrollIntoView();
      const kind = dest[1]?.name;
      const y = kind === 'XYZ' ? dest[3] : kind === 'FitH' || kind === 'FitBH' ? dest[2] : null;
      if (typeof y === 'number') {
        const [, top] = target.view.convertToViewportPoint(0, y);
        window.scrollBy(0, top);
      }
    } catch {
      // unresolved destination — ignore
    }
  }

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const scale = targetWidth / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale: scale * dpr });
    const view = page.getViewport({ scale });

    const div = document.createElement('div');
    div.className = 'pdf-page';
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    div.appendChild(canvas);
    viewer.appendChild(div);
    pages.push({ div, view });

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Link' || !a.rect) continue;
      const url = a.url || a.unsafeUrl;
      if (!url && !a.dest) continue;
      const r = view.convertToViewportRectangle(a.rect);
      const [x1, x2] = [Math.min(r[0], r[2]), Math.max(r[0], r[2])];
      const [y1, y2] = [Math.min(r[1], r[3]), Math.max(r[1], r[3])];
      const link = document.createElement('a');
      link.className = 'pdf-link';
      Object.assign(link.style, {
        left: `${x1}px`,
        top: `${y1}px`,
        width: `${x2 - x1}px`,
        height: `${y2 - y1}px`,
      });
      if (url) {
        link.href = url;
        link.title = url;
      } else {
        link.href = '#';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          scrollToDest(a.dest);
        });
      }
      div.appendChild(link);
    }
  }
}

async function render(doc) {
  currentDoc = doc;
  if (!doc) {
    document.title = 'md-viewer';
    contentEl.innerHTML =
      '<p class="placeholder">No file open. Run <code>md-viewer &lt;file.md&gt;</code> or drag a file here.</p>';
    return;
  }
  document.title = `md-viewer — ${doc.path}`;
  contentEl.innerHTML = '';
  try {
    if (doc.kind === 'pdf') {
      await renderPdf();
    } else {
      await renderMarkdown(doc);
    }
  } catch (e) {
    showError(e);
  }
}

contentEl.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  const url = a.getAttribute('href');
  if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) {
    e.preventDefault();
    invoke('open_url', { url });
  }
});

let reloadTimer;
listen('file-changed', (event) => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => render(event.payload), 120);
});

let resizeTimer;
window.addEventListener('resize', () => {
  if (currentDoc?.kind !== 'pdf') return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(currentDoc), 200);
});

listen('tauri://drag-drop', (event) => {
  const path = event.payload.paths?.[0];
  if (path) invoke('open_file', { path }).then(render);
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    window.print();
  }
});

invoke('get_content').then(render);
