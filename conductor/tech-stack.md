# Tech Stack: minterest

## 1. Programming Language
- **JavaScript (ES6+ ES Modules):** The project uses modern, vanilla JavaScript with ES modules for clean organization and no build requirements.

## 2. Frontend Frameworks
- **None (Pure Vanilla JS):** The application relies on web standards and native browser APIs rather than heavy frameworks, ensuring simplicity and long-term portability.

## 3. Styling & Presentation
- **Vanilla CSS (Grid & Flexbox):** Layouts are managed with modern CSS Grid and Flexbox for responsive design.
- **CSS Variables:** Theming and consistency are maintained using native CSS variables.

## 4. Storage & Database
- **IndexedDB (via `idb` wrapper):** All user data (boards, content, images) is stored locally in the browser's IndexedDB, providing private, large-scale storage without a server.

## 5. Key Libraries (ESM CDNs)
- **SortableJS:** Powering the drag-and-drop reordering of visual boards.
- **Heroicons:** Providing a clean, lightweight set of inline SVG icons.

## 6. Architecture & Deployment
- **Static Web Application:** The project consists of static files (`index.html`, `app.js`, `style.css`) that can be served by any basic HTTP server or opened directly in a browser.
- **No Build Steps:** There are no transpilers (Babel), bundlers (Webpack/Vite), or package managers (NPM) required to develop or run the application.
- **Local-First:** Designed to be completely private and offline-capable by default.
