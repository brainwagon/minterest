function runTests() {
    const results = document.getElementById('results');
    const log = (msg, pass) => {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.color = pass ? 'green' : 'red';
        results.appendChild(div);
    };

    try {
        log('Starting Theme Tests...', true);

        const body = document.body;
        const computedStyle = getComputedStyle(body);

        // 1. Initial State (Light Mode)
        const lightBg = computedStyle.getPropertyValue('--bg-color').trim();
        log(`Light Mode BG: ${lightBg}`, true);
        if (lightBg !== '#f8f9fa' && lightBg !== 'rgb(248, 249, 250)') {
             // Browser might return rgb
        }

        // 2. Switch to Dark Mode
        body.classList.add('dark-mode');
        const darkBg = getComputedStyle(body).getPropertyValue('--bg-color').trim();
        log(`Dark Mode BG: ${darkBg}`, true);

        if (darkBg === lightBg) {
            throw new Error('Dark mode background color matches light mode (Not implemented?)');
        } else {
            log('PASS: Dark mode background is different', true);
        }

        // 3. Check specific dark mode color (expected #121212 or rgb(18, 18, 18))
        if (darkBg === '#121212' || darkBg === 'rgb(18, 18, 18)') {
            log('PASS: Dark mode background is correct', true);
        } else {
            throw new Error(`Dark mode background color is incorrect: ${darkBg}`);
        }

        log('--- ALL TESTS PASSED ---', true);
    } catch (err) {
        log('FAIL: ' + err.message, false);
        console.error(err);
    } finally {
        document.body.classList.remove('dark-mode');
    }
}

runTests();
