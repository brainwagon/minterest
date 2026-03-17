import { escapeHtml } from '../utils.js';

// Bug 5: User-supplied strings (note content, item titles, comments, image src
// in document.write) are inserted directly into innerHTML template literals
// without escaping. A note or comment containing '<script>alert(1)</script>'
// or '<img src=x onerror=alert(1)>' will execute when the card is rendered.
//
// Fix: route all user content through escapeHtml() before inserting into HTML.

function runTests() {
  const results = document.getElementById('results');
  const log = (msg, pass) => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = pass ? 'green' : 'red';
    results.appendChild(div);
  };

  try {
    log('Starting Bug 5: XSS / HTML Injection Tests...', true);

    // ---- DEMONSTRATE THE BUG ----
    // Simulate the old unescaped insertion: set innerHTML to raw user content.
    const payloads = [
      '<script>window.__xss = true;<\/script>',
      '<img src=x onerror="window.__xss = true;">',
      '"><svg onload="window.__xss = true;">',
    ];

    for (const payload of payloads) {
      window.__xss = false;
      const container = document.createElement('div');
      // Old (buggy) behaviour — raw insertion:
      container.innerHTML = `<div class="card-title">${payload}</div>`;
      document.body.appendChild(container);
      // Give inline event handlers a chance to fire synchronously.
      // (script tags injected via innerHTML don't execute, but onerror does.)
      document.body.removeChild(container);

      if (window.__xss) {
        log(`CONFIRMED BUG: payload executed via raw innerHTML: ${payload.substring(0, 40)}`, true);
      } else if (payload.includes('script')) {
        // <script> via innerHTML doesn't execute in modern browsers, but the
        // tag is still parsed as a live element — confirm it is present.
        const probe = document.createElement('div');
        probe.innerHTML = `<div>${payload}</div>`;
        const hasScript = probe.querySelector('script') !== null;
        if (hasScript) {
          log('CONFIRMED BUG: <script> tag is parsed and present in DOM (executable in some contexts)', true);
        } else {
          log('FAIL: <script> tag not found in injected HTML (bug not reproduced)', false);
        }
      } else {
        log(`FAIL: Expected XSS payload to execute: ${payload.substring(0, 40)}`, false);
      }
    }

    // ---- VERIFY THE FIX ----
    // escapeHtml() must neutralise every dangerous character.
    const cases = [
      {
        input: '<script>alert(1)<\/script>',
        expectAbsent: '<script>',
        label: 'script tag neutralised',
      },
      {
        input: '<img src=x onerror=alert(1)>',
        expectAbsent: '<img',
        label: 'img onerror neutralised',
      },
      {
        input: '" onmouseover="alert(1)',
        expectAbsent: '"',
        label: 'double-quote escaped',
      },
      {
        input: "' onmouseover='alert(1)",
        expectAbsent: "'",
        label: 'single-quote escaped',
      },
      {
        input: '&amp; already escaped',
        expectContains: '&amp;amp;',
        label: 'ampersand double-escaped correctly',
      },
    ];

    for (const { input, expectAbsent, expectContains, label } of cases) {
      const escaped = escapeHtml(input);

      if (expectAbsent && !escaped.includes(expectAbsent)) {
        log(`PASS (fix): ${label} — "${expectAbsent}" not present in escaped output`, true);
      } else if (expectContains && escaped.includes(expectContains)) {
        log(`PASS (fix): ${label} — "${expectContains}" present in escaped output`, true);
      } else if (expectAbsent) {
        throw new Error(`escapeHtml failed for "${label}": "${expectAbsent}" still present in "${escaped}"`);
      } else {
        throw new Error(`escapeHtml failed for "${label}": "${expectContains}" not present in "${escaped}"`);
      }
    }

    // Verify safe content is preserved.
    const safe = 'Hello, World! This is a normal note.';
    if (escapeHtml(safe) === safe) {
      log('PASS (fix): safe content is not modified by escapeHtml', true);
    } else {
      throw new Error('escapeHtml incorrectly modified safe content');
    }

    // Verify non-string input returns empty string (defensive).
    if (escapeHtml(null) === '' && escapeHtml(undefined) === '') {
      log('PASS (fix): null/undefined input returns empty string', true);
    } else {
      throw new Error('escapeHtml should return "" for null/undefined');
    }

    log('--- ALL TESTS PASSED ---', true);
  } catch (err) {
    log('FAIL: ' + err.message, false);
    console.error(err);
  }
}

runTests();
