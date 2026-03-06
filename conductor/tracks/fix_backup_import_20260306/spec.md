# Specification: fix_backup_import_20260306

## Goal
Fix the backup import functionality to be compatible with the recently optimized storage layer (which uses empty strings for root IDs) and handle JSON formats that might have nested items in topics.

## Scope
1. **Sanitize IDs:** Ensure that any imported `parentId` or `topicId` that is `null` or `undefined` is converted to an empty string `""` before saving to IndexedDB.
2. **Handle Nested Items:** If a topic in the JSON contains an `items` array, ensure those items are correctly processed and saved to the items store, and remove the `items` property from the topic object before saving it to the topics store to keep the schema clean.
3. **Robustness:** Add basic validation to ensure the imported data has the expected structure.

## Technical Details
- **Affected File:** `app.js` (import handler).
- **Storage:** Uses `storage.db` directly or high-level methods.
