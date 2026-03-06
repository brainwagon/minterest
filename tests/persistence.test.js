import { storage } from '../storage.js';

async function runTests() {
    const results = document.getElementById('results');
    const log = (msg, pass) => {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.color = pass ? 'green' : 'red';
        results.appendChild(div);
    };

    try {
        log('Starting Persistence Tests...', true);

        await storage.init();

        // 1. Test Saving Theme
        const testTheme = { isDark: true };
        await storage.putSetting('theme', testTheme);
        log('PASS: Saved theme setting', true);

        // 2. Test Loading Theme
        const loadedTheme = await storage.getSetting('theme');
        if (loadedTheme && loadedTheme.isDark === true) {
            log('PASS: Loaded theme setting correctly', true);
        } else {
            throw new Error(`Loaded theme mismatch: ${JSON.stringify(loadedTheme)}`);
        }

        // 3. Test Toggle Persistence (Clean up)
        await storage.putSetting('theme', { isDark: false });
        const finalTheme = await storage.getSetting('theme');
        if (finalTheme && finalTheme.isDark === false) {
            log('PASS: Updated theme setting correctly', true);
        } else {
            throw new Error('Failed to update theme setting');
        }

        log('--- ALL TESTS PASSED ---', true);
    } catch (err) {
        log('FAIL: ' + err.message, false);
        console.error(err);
    }
}

runTests();
