# minterest

**minterest** is a tiny, local-first "Pinterest-like" application for organizing your ideas, links, and images. It runs entirely in your browser using modern web standards, requiring no server, no login, and no installation.

## Features

*   **Topic Organization:** Create multiple boards (Topics) to categorize your content.
*   **Visual Boards:** Drag and drop content onto a masonry-style grid.
*   **Smart Content Handling:**
    *   **Links:** Drag URLs from other tabs to create visual bookmark cards with auto-generated color themes and favicons.
    *   **Images:** Drag image files (or paste screenshots) to upload them. They are stored locally in your browser.
    *   **Notes:** Add "Post-it" style sticky notes with a fun, random tilt.
*   **Local-First & Private:** All data is stored in your browser's **IndexedDB**. Nothing is ever sent to a cloud server.
*   **Drag & Drop Reordering:** Arrange your cards exactly how you want them.
*   **Clipboard Support:** Paste (Ctrl+V) text, links, or images directly onto your board.
*   **Backup & Restore:** Export your entire database to a JSON file for safekeeping or to move to another device.

## Usage

### Getting Started
1.  Clone this repository or download the files.
2.  Open `index.html` in any modern web browser (Chrome, Firefox, Edge, Safari).
3.  That's it!

### Managing Topics
*   Click **"+ New Topic"** on the dashboard to start a new collection.
*   Click a topic card to enter that board.
*   Use the **Trash Icon** on a topic to delete it (and all its contents).

### Adding Content
*   **Drag & Drop:**
    *   Drag a link from your browser address bar onto the board.
    *   Drag an image file from your computer into the "Drop images here" zone or anywhere on the board.
*   **Paste:** Copy an image or link and press `Ctrl+V` (Cmd+V on Mac) while on a board.
*   **Add Note:** Click the "+ Add Note" button to create a text note.

### Managing Cards
*   **Reorder:** Click and drag any card to move it.
*   **Edit:** Hover over a card and click the **Pencil** icon to add or edit a comment.
*   **Delete:** Hover over a card and click the **Trash** icon to remove it.
*   **Download:** For images, click the **Floppy Disk** icon to save the file to your computer.
*   **View Image:** Click any image card to view it in full screen.

## Design Philosophy

**"maintaining minimal interest"**

*   **Zero Dependencies:** Built with pure HTML5, CSS3, and Vanilla JavaScript (ES Modules). No build steps, no `npm install`, no heavy frameworks.
*   **Local-First:** We believe your data belongs to you. By using IndexedDB, we can store gigabytes of data locally without relying on a third-party service.
*   **Longevity:** The code is designed to be readable and standard-compliant, ensuring it will run in browsers for decades to come.
*   **Simplicity:** The UI is intentionally clean and unopinionated, focusing on the content rather than the interface.

## Technical Details

*   **Storage:** `IndexedDB` (via the lightweight `idb` wrapper).
*   **Icons:** Inline SVG **Heroicons**.
*   **Drag & Drop:** Powered by **SortableJS** (loaded via ESM CDN).
*   **Styling:** CSS Grid & Flexbox with CSS Variables for theming.

## License

MIT License. Feel free to fork, modify, and use as you see fit.
