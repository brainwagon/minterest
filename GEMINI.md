# GEMINI.md - Project Context & Coding Guidelines

## 1. Project Philosophy
This project is a **Static Web Application**. Our core values are:
* **Simplicity:** No build steps, no transpilers, no bundlers (Webpack/Vite/Parcel).
* **Portability:** The project must run directly by opening `index.html` in a browser or serving via a basic HTTP server.
* **Readability:** Code is written for humans first. Logic must be obvious and self-documenting.
* **Longevity:** Rely on web standards (HTML5, CSS3, ES6+) rather than fleeting frameworks.

## 2. Technical Constraints (Strict)

### HTML Structure
* Use Semantic HTML5 tags (`<header>`, `<main>`, `<article>`, `<footer>`, `<dialog>`) exclusively.
* Do **not** use React, Vue, Svelte, or any JSX/templating syntax.
* Ensure full accessibility (ARIA labels where necessary, proper contrast, keyboard navigation).

### CSS & Styling
* **No CSS-in-JS.**
* Use modern **Vanilla CSS**:
    * CSS Variables (`--primary-color`) for theming.
    * Flexbox and Grid for layout.
    * No external pre-processors (Sass/Less) unless strictly requested.
* If a utility framework is requested, use **Tailwind via CDN** script:
    * `<script src="https://cdn.tailwindcss.com"></script>`
* Otherwise, stick to a clean `style.css` file.

### JavaScript & Logic
* **Vanilla JavaScript (ES6+)** is the default.
* Use ES Modules (`<script type="module">`) to organize code.
* **No NPM/Node modules.**
* If external libraries are absolutely required (e.g., for charts, 3D, complex math):
    * Import them strictly via **ESM-friendly CDNs** (e.g., `esm.sh`, `unpkg.com`, `cdnjs`).
    * Example: `import confetti from 'https://esm.sh/canvas-confetti';`
* Avoid heavy frameworks. If reactivity is complex, suggest lightweight alternatives like **Alpine.js** or **Petite-Vue** loaded via CDN, but prefer Vanilla JS where possible.

## 3. Code Style & Readability

* **Comments:** Comment the *intent*, not the syntax. Explain "why" a complex block exists.
* **Naming:** Use descriptive, verbose variable names.
    * *Bad:* `const d = new Date();`
    * *Good:* `const currentTimestamp = new Date();`
* **Functions:** Keep functions small and pure. One function should do one thing.
* **Separation of Concerns:**
    * Structure: `index.html`
    * Presentation: `styles.css`
    * Behavior: `app.js` (or `main.js`)
* *Exception:* For very small prototypes (<200 lines), a single HTML file containing `<style>` and `<script>` blocks is acceptable.

## 4. Standard Boilerplate
Unless otherwise specified, start all new projects with this skeleton:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Project description here">
    <title>Project Title</title>
    
    <link rel="stylesheet" href="style.css">
    <style>
        /* Critical path CSS or simple resets */
        :root {
            --bg-color: #ffffff;
            --text-color: #333333;
            --accent-color: #007bff;
        }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            line-height: 1.6;
            margin: 0;
            padding: 2rem;
        }
    </style>
</head>
<body>

    <header>
        <h1>Project Title</h1>
    </header>

    <main>
        </main>

    <script type="module">
        // import { someLib } from '[https://esm.sh/some-lib](https://esm.sh/some-lib)';
        
        console.log('App initialized');
    </script>
</body>
</html>
