import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import './style.css';

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

async function render(doc) {
  if (!doc) {
    document.title = 'md-viewer';
    contentEl.innerHTML =
      '<p class="placeholder">No file open. Run <code>md-viewer &lt;file.md&gt;</code> or drag a file here.</p>';
    return;
  }
  document.title = `md-viewer — ${doc.path}`;
  contentEl.innerHTML = md.render(doc.content);
  for (const node of contentEl.querySelectorAll('.mermaid')) {
    try {
      await mermaid.run({ nodes: [node] });
    } catch (e) {
      node.innerHTML = `<code class="mermaid-error">${md.utils.escapeHtml(String(e))}</code>`;
    }
  }
}

listen('file-changed', (event) => render(event.payload));

listen('tauri://drag-drop', (event) => {
  const path = event.payload.paths?.[0];
  if (path) invoke('open_file', { path }).then(render);
});

invoke('get_content').then(render);
