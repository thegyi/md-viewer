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
  currentPdf = await getDocument({ data: bytes }).promise;

  const viewer = document.createElement('div');
  viewer.className = 'pdf-viewer';
  contentEl.appendChild(viewer);

  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(200, viewer.clientWidth);
  for (let n = 1; n <= currentPdf.numPages; n++) {
    const page = await currentPdf.getPage(n);
    const scale = targetWidth / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    viewer.appendChild(canvas);
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
