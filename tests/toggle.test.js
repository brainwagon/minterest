function runTests() {
    const results = document.getElementById('results');
    const log = (msg, pass) => {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.color = pass ? 'green' : 'red';
        results.appendChild(div);
    };

    try {
        log('Starting Toggle Tests...', true);

        // 1. Check if button exists
        const btn = document.getElementById('btn-theme-toggle');
        if (!btn) {
            throw new Error('Theme toggle button not found in DOM');
        }
        log('PASS: Toggle button found', true);

        // 2. Check for icons
        const sunIcon = btn.querySelector('.sun-icon');
        const moonIcon = btn.querySelector('.moon-icon');
        
        if (!sunIcon || !moonIcon) {
            throw new Error('Sun or Moon icon missing from toggle button');
        }
        log('PASS: Icons found in button', true);

        // 3. Test Toggle Logic (Red Phase - should fail)
        const body = document.body;
        const initialDark = body.classList.contains('dark-mode');
        
        // Mock the logic if not implemented, or just trigger click
        btn.click();
        
        if (body.classList.contains('dark-mode') === initialDark) {
             throw new Error('Clicking toggle did not change dark-mode class on body');
        }
        log('PASS: Clicking toggle changed dark-mode class', true);

        log('--- ALL TESTS PASSED ---', true);
    } catch (err) {
        log('FAIL: ' + err.message, false);
        console.error(err);
    }
}

runTests();
