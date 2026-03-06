# Specification: refactor_storage_20260306

## Goal
The goal of this track is to establish a baseline for the current project state by tagging it as `v1.0`, then bump the version to `v2.0` and perform a significant refactoring of the storage (IndexedDB) and content loading logic. This refactoring aims to improve performance, stability, and maintainability, aligning with the project's core goals of technical durability and performance.

## Scope
1. **Versioning:**
   - Tag the current state of the repository as `v1.0`.
   - Update any version strings in the project (if any) to `2.0.0-dev`.
2. **Storage Refactoring:**
   - Review the current usage of `idb` and IndexedDB.
   - Refactor the storage layer to be more robust, potentially centralizing database interactions into a single module.
   - Improve error handling for storage operations.
3. **Content Loading Refactoring:**
   - Optimize how content (links, images, notes) is loaded from IndexedDB.
   - Implement better state management for the UI to reflect loading states.
   - Ensure that the masonry layout (SortableJS) handles updates efficiently during and after refactoring.

## Technical Details
- **Tech Stack:** Vanilla JS, IndexedDB (`idb`), SortableJS.
- **Constraints:** Maintain the "no build step" and "vanilla" nature of the project.
- **Testing:** Comprehensive unit tests for the new storage and loading logic.
