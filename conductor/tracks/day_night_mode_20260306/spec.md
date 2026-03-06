# Specification: day_night_mode

## Overview
Implement a "Day/Night Mode" (Light/Dark Theme) toggle for the minterest application. This feature allows users to switch between a light and dark visual interface, improving usability in different lighting conditions and providing personalization options.

## Functional Requirements
1. **Manual Toggle:** A dedicated toggle button (with Sun/Moon icons) will be added to the application header to allow users to switch between Light and Dark modes.
2. **Visual Adaptation:**
    - **Colors:** Update background, text, and accent colors using CSS variables.
    - **UI Elements:** Adjust card backgrounds, borders, shadows, and navigation elements to maintain readability and aesthetic appeal in Dark mode.
    - **Icons:** Ensure Heroicons remain visible and appropriately contrasted in both modes.
3. **Persistence:** The user's theme preference will be stored in IndexedDB (within the existing \`settings\` store) so that it persists across browser sessions.
4. **Implementation Method:** The application will apply a \`.dark-mode\` class to the \`<body>\` element. All theme-specific styling will be handled in \`style.css\` using CSS variable overrides within the \`.dark-mode\` scope.

## Non-Functional Requirements
- **Performance:** Theme switching should be instantaneous without page reloads.
- **Longevity:** Follow the project's "Vanilla" philosophy (no external theme libraries).

## Acceptance Criteria
- [ ] Toggle button is visible and functional in the header.
- [ ] Clicking the toggle switches the theme immediately.
- [ ] Theme preference is saved and correctly applied on page refresh.
- [ ] All UI elements (cards, notes, breadcrumbs, dialogs) are legible in both modes.

## Out of Scope
- Automatic switching based on time of day.
- Multiple custom color themes beyond Light and Dark.
