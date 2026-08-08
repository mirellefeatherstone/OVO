const KEYPAD_PATCH_KEY = '__ovoPhoneKeypadPatchV1';
const DTMF_MIN_DURATION_SECONDS = 0.1;
const DTMF_FREQUENCIES = Object.freeze({
    1: [697, 1209],
    2: [697, 1336],
    3: [697, 1477],
    4: [770, 1209],
    5: [770, 1336],
    6: [770, 1477],
    7: [852, 1209],
    8: [852, 1336],
    9: [852, 1477],
    '*': [941, 1209],
    0: [941, 1336],
    '#': [941, 1477],
});

const KEYPAD_HOSTS = Object.freeze([
    ['1', '.live-header'],
    ['2', '.live-host-info'],
    ['3', '.live-host-text'],
    ['4', '#live-host-name'],
    ['5', '.live-host-hot'],
    ['6', '.live-stage'],
    ['7', '#live-action-text'],
    ['8', '#live-speech-bubble'],
    ['9', '#live-danmaku-area'],
    ['*', '.live-controls'],
    ['0', '.live-input-box'],
    ['#', '#live-bg-layer'],
]);

function normaliseNumber(value) {
    return String(value || '').replace(/[^0-9*#]/g, '');
}

function setupPhoneKeypad() {
    if (window[KEYPAD_PATCH_KEY]) return;

    const screen = document.getElementById('live-room-screen');
    const input = document.getElementById('live-input');
    if (!screen || !input) {
        console.warn('[OVO custom] Phone Keypad could not find the live-room hosts.');
        return;
    }

    const hosts = new Map();
    for (const [key, selector] of KEYPAD_HOSTS) {
        const host = screen.querySelector(selector);
        if (!host) {
            console.warn(`[OVO custom] Phone Keypad host is missing: ${selector}`);
            return;
        }

        host.dataset.ovoKeypadKey = key;
        hosts.set(key, host);
    }

    let active = false;
    let currentNumber = '';
    let audioContext = null;
    let audioResumePromise = null;
    const activePresses = new Map();

    function syncInput() {
        if (input.value !== currentNumber) input.value = currentNumber;
    }

    function appendKey(key) {
        if (!active || !Object.hasOwn(DTMF_FREQUENCIES, key)) {
            return currentNumber;
        }

        currentNumber += key;
        syncInput();
        return currentNumber;
    }

    function deleteLast() {
        if (!active) return currentNumber;

        currentNumber = currentNumber.slice(0, -1);
        syncInput();
        return currentNumber;
    }

    function clear() {
        if (!active) return currentNumber;

        currentNumber = '';
        syncInput();
        return currentNumber;
    }

    function getNumber() {
        return currentNumber;
    }

    function call(number = currentNumber) {
        if (!active) return null;

        const dialledNumber = normaliseNumber(number);
        if (!dialledNumber) return null;

        screen.dispatchEvent(new CustomEvent('ovo:phone-keypad-call', {
            bubbles: true,
            detail: { number: dialledNumber },
        }));
        return dialledNumber;
    }

    function getAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        if (!audioContext || audioContext.state === 'closed') {
            // This function is reached only after a real keypad interaction.
            audioContext = new AudioContextClass();
            audioResumePromise = null;
        }

        return audioContext;
    }

    async function ensureAudioContextRunning(context) {
        if (context.state !== 'suspended') return;

        if (!audioResumePromise) {
            audioResumePromise = context.resume().finally(() => {
                audioResumePromise = null;
            });
        }

        await audioResumePromise;
    }

    function createDtmfTone(context, frequencies, onEnded) {
        const startTime = context.currentTime;
        const gain = context.createGain();

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(0.14, startTime + 0.008);
        gain.connect(context.destination);

        let stopping = false;
        let endedOscillators = 0;
        const oscillators = [];

        for (const frequency of frequencies) {
            const oscillator = context.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, startTime);
            oscillator.connect(gain);
            oscillator.addEventListener('ended', () => {
                oscillator.disconnect();
                endedOscillators += 1;
                if (endedOscillators === frequencies.length) {
                    gain.disconnect();
                    onEnded();
                }
            }, { once: true });
            oscillator.start(startTime);
            oscillators.push(oscillator);
        }

        return {
            stop(force = false) {
                if (stopping) return;
                stopping = true;

                const minimumStopTime = startTime + DTMF_MIN_DURATION_SECONDS;
                const releaseTime = force
                    ? context.currentTime
                    : Math.max(context.currentTime, minimumStopTime);
                const oscillatorStopTime = releaseTime + 0.012;

                gain.gain.cancelScheduledValues(releaseTime);
                gain.gain.setValueAtTime(0.14, releaseTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, releaseTime + 0.008);
                oscillators.forEach(oscillator => oscillator.stop(oscillatorStopTime));
            },
        };
    }

    async function startDtmfPress(press) {
        const frequencies = DTMF_FREQUENCIES[press.key];
        if (!frequencies) return;

        const context = getAudioContext();
        if (!context) {
            activePresses.delete(press.id);
            return;
        }

        await ensureAudioContextRunning(context);
        if (context.state !== 'running' || !active || press.cancelled) {
            if (activePresses.get(press.id) === press) activePresses.delete(press.id);
            return;
        }

        press.tone = createDtmfTone(context, frequencies, () => {
            if (activePresses.get(press.id) === press) activePresses.delete(press.id);
        });

        if (press.released) press.tone.stop();
    }

    function finishPress(id, force = false) {
        const press = activePresses.get(id);
        if (!press) return;

        press.released = true;
        if (force) press.cancelled = true;
        if (press.tone) press.tone.stop(force);
    }

    function stopAllPresses() {
        activePresses.forEach(press => finishPress(press.id, true));
    }

    function getKeypadHost(event) {
        if (!active || !(event.target instanceof Element)) return;

        const host = event.target.closest('[data-ovo-keypad-key]');
        if (!host || !screen.contains(host)) return null;

        // Clicks on a host's existing children keep their original meaning.
        // CSS-generated ::before/::after content targets the host itself.
        if (event.target !== host) return null;

        const key = host.dataset.ovoKeypadKey;
        if (!Object.hasOwn(DTMF_FREQUENCIES, key)) return null;

        return { host, key };
    }

    function handlePointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        const keypadTarget = getKeypadHost(event);
        if (!keypadTarget) return;

        event.preventDefault();
        finishPress(event.pointerId, true);

        const press = {
            id: event.pointerId,
            key: keypadTarget.key,
            released: false,
            cancelled: false,
            tone: null,
        };

        activePresses.set(press.id, press);
        appendKey(press.key);

        try {
            keypadTarget.host.setPointerCapture?.(event.pointerId);
        } catch {
            // Pointer capture is optional on older Safari versions.
        }

        void startDtmfPress(press).catch(error => {
            if (activePresses.get(press.id) === press) activePresses.delete(press.id);
            console.warn('[OVO custom] Phone Keypad DTMF failed:', error);
        });
    }

    function handlePointerEnd(event) {
        finishPress(event.pointerId, event.type === 'pointercancel');
    }

    function handleKeyboardClick(event) {
        if (event.detail !== 0) return;

        const keypadTarget = getKeypadHost(event);
        if (!keypadTarget) return;

        const press = {
            id: Symbol(`keyboard-${keypadTarget.key}`),
            key: keypadTarget.key,
            released: true,
            cancelled: false,
            tone: null,
        };

        activePresses.set(press.id, press);
        appendKey(press.key);
        void startDtmfPress(press).catch(error => {
            if (activePresses.get(press.id) === press) activePresses.delete(press.id);
            console.warn('[OVO custom] Phone Keypad DTMF failed:', error);
        });
    }

    function handleContextMenu(event) {
        if (!getKeypadHost(event)) return;
        event.preventDefault();
    }

    function handleInput() {
        if (!active) return;

        currentNumber = normaliseNumber(input.value);
        syncInput();
    }

    function updateActiveState() {
        const nextActive = screen.classList.contains('active');
        if (nextActive === active) return;

        active = nextActive;
        if (!active) {
            stopAllPresses();
            return;
        }

        currentNumber = normaliseNumber(input.value);
        syncInput();

        if (typeof window.LiveModule?.stopSimulation === 'function') {
            window.LiveModule.stopSimulation();
        }
    }

    screen.addEventListener('pointerdown', handlePointerDown);
    screen.addEventListener('pointerup', handlePointerEnd);
    screen.addEventListener('pointercancel', handlePointerEnd);
    screen.addEventListener('lostpointercapture', handlePointerEnd);
    screen.addEventListener('click', handleKeyboardClick);
    screen.addEventListener('contextmenu', handleContextMenu);
    input.addEventListener('input', handleInput);

    const activeObserver = new MutationObserver(updateActiveState);
    activeObserver.observe(screen, {
        attributes: true,
        attributeFilter: ['class'],
    });

    const api = Object.freeze({
        appendKey,
        deleteLast,
        clear,
        getNumber,
        call,
        isActive: () => active,
    });

    window.OVOPhoneKeypad = api;
    window[KEYPAD_PATCH_KEY] = Object.freeze({
        api,
        hosts,
        activeObserver,
        frequencies: DTMF_FREQUENCIES,
    });

    updateActiveState();
    console.info('[OVO custom] Phone Keypad patch loaded.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPhoneKeypad, { once: true });
} else {
    setupPhoneKeypad();
}
