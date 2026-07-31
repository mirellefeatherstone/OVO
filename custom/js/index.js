const PATCH_LOADED_EVENT = 'ovo:custom-patch-loaded';
const CONTACTS_GROUPED_EVENT = 'ovo:contacts-grouped';
const CONTACTS_LIST_ID = 'contacts-list';
const GROUP_TITLE_CLASS = 'ovo-contact-group-title';
const INDEX_CLASS = 'ovo-contact-index';
const INDEX_LETTER_CLASS = 'ovo-contact-index-letter';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const INDEX_LETTERS = [...ALPHABET, '#'];
const MAGNIFICATION_NEIGHBOURS = 2;
const CONTACTS_PREVIEW_PARAM = 'ovoAzPreview';

function loadContactIndexPreviewStyles() {
    const params = new URLSearchParams(window.location.search);
    if (params.get(CONTACTS_PREVIEW_PARAM) !== '1') return;
    if (document.querySelector('link[data-ovo-contact-index-preview]')) return;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('../css/contacts-index-preview.css', import.meta.url).href;
    stylesheet.dataset.ovoContactIndexPreview = 'true';
    document.head.appendChild(stylesheet);
}

// These boundaries let Intl.Collator map common Han names to pinyin initials.
// I, U and V are intentionally absent because standard Mandarin syllables do
// not start with those letters. Unrecognised names fall back to the # group.
const PINYIN_BOUNDARIES = [
    ['A', '阿'],
    ['B', '芭'],
    ['C', '擦'],
    ['D', '搭'],
    ['E', '蛾'],
    ['F', '发'],
    ['G', '噶'],
    ['H', '哈'],
    ['J', '击'],
    ['K', '喀'],
    ['L', '垃'],
    ['M', '妈'],
    ['N', '拿'],
    ['O', '哦'],
    ['P', '啪'],
    ['Q', '期'],
    ['R', '然'],
    ['S', '撒'],
    ['T', '塌'],
    ['W', '挖'],
    ['X', '昔'],
    ['Y', '压'],
    ['Z', '匝'],
];

const pinyinCollator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', {
    sensitivity: 'base',
    numeric: true,
});

function getContactLetter(name) {
    const normalisedName = String(name || '').trim();
    if (!normalisedName) return '#';

    const firstCharacter = Array.from(normalisedName)[0];
    const latinCharacter = firstCharacter
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .match(/[A-Za-z]/)?.[0];

    if (latinCharacter) return latinCharacter.toUpperCase();

    const isHanCharacter = /[\u3400-\u9FFF\uF900-\uFAFF]/.test(firstCharacter);
    if (!isHanCharacter) return '#';

    let letter = '#';
    for (const [candidateLetter, boundary] of PINYIN_BOUNDARIES) {
        if (pinyinCollator.compare(firstCharacter, boundary) < 0) break;
        letter = candidateLetter;
    }

    return letter;
}

function getContactName(contactItem) {
    return contactItem.querySelector('.profile-name')?.textContent?.trim() || '';
}

function getOrderedLetters(groups) {
    return [...ALPHABET, '#'].filter(letter => groups.has(letter));
}

function createGroupTitle(letter) {
    const title = document.createElement('li');
    title.id = `ovo-contact-group-${letter === '#' ? 'other' : letter.toLowerCase()}`;
    title.className = GROUP_TITLE_CLASS;
    title.dataset.letter = letter;
    title.textContent = letter;
    title.setAttribute('aria-hidden', 'true');
    // Structural DOM stays invisible unless the active custom CSS opts in.
    title.style.display = 'var(--ovo-contact-group-title-display, none)';
    return title;
}

function triggerIndexHaptic() {
    if (window.db?.hapticEnabled === false) return;

    if (typeof window.triggerHapticFeedback === 'function'
        && typeof navigator.vibrate === 'function') {
        window.triggerHapticFeedback('selection');
        return;
    }

    if (typeof navigator.vibrate === 'function') {
        try {
            navigator.vibrate(10);
            return;
        } catch {
            // Unsupported or blocked vibration should never interrupt dragging.
        }
    }
}

function getIndexButtons(index) {
    return Array.from(index.querySelectorAll(`.${INDEX_LETTER_CLASS}`));
}

function updateIndexMagnification(index, activeButton) {
    const buttons = getIndexButtons(index);
    const activeIndex = buttons.indexOf(activeButton);
    if (activeIndex < 0) return;

    buttons.forEach((button, buttonIndex) => {
        const distance = Math.abs(buttonIndex - activeIndex);
        if (distance <= MAGNIFICATION_NEIGHBOURS) {
            button.dataset.ovoIndexDistance = String(distance);
        } else {
            delete button.dataset.ovoIndexDistance;
        }
    });
    index.dataset.ovoActiveLetter = activeButton.dataset.letter;
}

function clearIndexMagnification(index) {
    getIndexButtons(index).forEach(button => {
        delete button.dataset.ovoIndexDistance;
    });
    delete index.dataset.ovoActiveLetter;
}

function getGroupTitle(list, letter) {
    return Array.from(list.children).find(child => (
        child.classList.contains(GROUP_TITLE_CLASS)
        && child.dataset.letter === letter
    ));
}

function getContactsScrollContainer(list) {
    let candidate = list.parentElement;

    while (candidate && candidate !== document.body) {
        const { overflowY } = getComputedStyle(candidate);
        const allowsVerticalScrolling = /^(auto|scroll|overlay)$/.test(overflowY);
        const hasScrollableRange = candidate.scrollHeight > candidate.clientHeight + 1;

        if (allowsVerticalScrolling && hasScrollableRange) return candidate;
        candidate = candidate.parentElement;
    }

    // Preserve a useful fallback while the screen is hidden or still laying
    // itself out and therefore reports no measurable scroll range yet.
    return list.closest('.content')
        || list.closest('#contacts-screen')
        || document.scrollingElement;
}

function scrollGroupIntoPosition(list, target, behavior) {
    const scrollContainer = getContactsScrollContainer(list);

    // Repeated smooth scrollIntoView calls can get stuck at the bottom in
    // iOS Safari. During a drag, update the real contacts scroller directly
    // so reversing direction works immediately and cancels no queued motion.
    if (behavior === 'instant' && scrollContainer) {
        const containerBounds = scrollContainer.getBoundingClientRect();
        const targetBounds = target.getBoundingClientRect();
        const stickyTop = Number.parseFloat(getComputedStyle(target).top) || 0;
        const requestedTop = (
            scrollContainer.scrollTop
            + targetBounds.top
            - containerBounds.top
            - stickyTop
        );
        const maximumTop = Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight,
        );

        scrollContainer.scrollTop = Math.min(
            maximumTop,
            Math.max(0, requestedTop),
        );
        return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function navigateToIndexButton(list, index, button, behavior = 'instant') {
    const target = getGroupTitle(list, button.dataset.letter);
    if (!target) return false;

    getIndexButtons(index).forEach(letterButton => {
        if (letterButton === button) {
            letterButton.setAttribute('aria-current', 'true');
        } else {
            letterButton.removeAttribute('aria-current');
        }
    });
    scrollGroupIntoPosition(list, target, behavior);
    return true;
}

function createContactIndex(list, presentLetters) {
    const friendsSection = list.closest('.friends-section');
    if (!friendsSection) return;

    friendsSection.querySelector(`.${INDEX_CLASS}`)?.remove();

    const index = document.createElement('nav');
    index.className = INDEX_CLASS;
    index.setAttribute('aria-label', '联系人字母索引');
    // The CSS preset enables the feature by defining this display variable.
    // Without that opt-in, switching themes cannot leak default buttons.
    index.style.display = 'var(--ovo-contact-index-display, none)';
    index.style.touchAction = 'none';
    index.style.userSelect = 'none';
    index.style.webkitUserSelect = 'none';

    const presentLetterSet = new Set(presentLetters);

    for (const letter of INDEX_LETTERS) {
        const hasContacts = presentLetterSet.has(letter);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = INDEX_LETTER_CLASS;
        button.dataset.letter = letter;
        button.dataset.hasContacts = String(hasContacts);
        button.textContent = letter;
        button.setAttribute('aria-disabled', String(!hasContacts));
        button.setAttribute(
            'aria-label',
            hasContacts ? `跳到 ${letter} 组联系人` : `${letter} 组暂无联系人`,
        );
        button.tabIndex = hasContacts ? 0 : -1;
        index.appendChild(button);
    }

    let activePointerId = null;
    let lastActivatedLetter = null;
    let buttonMetrics = [];

    const activateButton = (button, behavior = 'instant') => {
        if (!button || button.dataset.letter === lastActivatedLetter) return;

        lastActivatedLetter = button.dataset.letter;
        updateIndexMagnification(index, button);
        triggerIndexHaptic();

        if (button.dataset.hasContacts === 'true') {
            navigateToIndexButton(list, index, button, behavior);
        }
    };

    const cacheButtonMetrics = () => {
        buttonMetrics = getIndexButtons(index).map(button => {
            const bounds = button.getBoundingClientRect();
            return { button, centreY: bounds.top + (bounds.height / 2) };
        });
    };

    const getNearestButton = clientY => {
        let nearestMetric = null;
        let nearestDistance = Number.POSITIVE_INFINITY;

        for (const metric of buttonMetrics) {
            const distance = Math.abs(clientY - metric.centreY);
            if (distance < nearestDistance) {
                nearestMetric = metric;
                nearestDistance = distance;
            }
        }

        return nearestMetric?.button || null;
    };

    const finishPointerGesture = event => {
        if (activePointerId === null || event.pointerId !== activePointerId) return;

        if (index.hasPointerCapture?.(activePointerId)) {
            try {
                index.releasePointerCapture(activePointerId);
            } catch {
                // The browser may already have released capture during cancel.
            }
        }
        activePointerId = null;
        lastActivatedLetter = null;
        buttonMetrics = [];
        clearIndexMagnification(index);
    };

    index.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        const button = event.target.closest?.(`.${INDEX_LETTER_CLASS}`);
        if (!button || !index.contains(button)) return;

        event.preventDefault();
        activePointerId = event.pointerId;
        lastActivatedLetter = null;
        cacheButtonMetrics();
        try {
            index.setPointerCapture?.(event.pointerId);
        } catch {
            // Synthetic and older pointer implementations may not support it.
        }
        activateButton(button);
    });

    index.addEventListener('pointermove', event => {
        if (activePointerId === null || event.pointerId !== activePointerId) return;

        event.preventDefault();
        activateButton(getNearestButton(event.clientY));
    });

    index.addEventListener('pointerup', finishPointerGesture);
    index.addEventListener('pointercancel', finishPointerGesture);
    index.addEventListener('lostpointercapture', event => {
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
        lastActivatedLetter = null;
        buttonMetrics = [];
        clearIndexMagnification(index);
    });

    // Keyboard and assistive-technology activation produce detail === 0.
    index.addEventListener('click', event => {
        if (event.detail !== 0) {
            event.preventDefault();
            return;
        }

        const button = event.target.closest?.(`.${INDEX_LETTER_CLASS}`);
        if (!button || !index.contains(button) || button.dataset.hasContacts !== 'true') return;

        lastActivatedLetter = null;
        activateButton(button, 'smooth');
        window.setTimeout(() => clearIndexMagnification(index), 160);
    });

    friendsSection.appendChild(index);
}

function groupContactList(list) {
    const contactItems = Array.from(list.children).filter(child => (
        child.classList.contains('profile-item')
    ));

    const groups = new Map();
    for (const contactItem of contactItems) {
        const name = getContactName(contactItem);
        const letter = getContactLetter(name);
        contactItem.dataset.ovoContactLetter = letter;

        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push({ contactItem, name });
    }

    const letters = getOrderedLetters(groups);
    const fragment = document.createDocumentFragment();

    for (const letter of letters) {
        fragment.appendChild(createGroupTitle(letter));

        const contacts = groups.get(letter).sort((left, right) => (
            pinyinCollator.compare(left.name, right.name)
        ));
        for (const { contactItem } of contacts) fragment.appendChild(contactItem);
    }

    list.replaceChildren(fragment);
    list.dataset.ovoContactsAz = 'ready';
    createContactIndex(list, letters);

    list.dispatchEvent(new CustomEvent(CONTACTS_GROUPED_EVENT, {
        bubbles: true,
        detail: { contactCount: contactItems.length, letters },
    }));
}

function setupContactsPatch() {
    const list = document.getElementById(CONTACTS_LIST_ID);
    if (!list) return;

    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;

        queueMicrotask(() => {
            scheduled = false;
            observer.disconnect();
            groupContactList(list);
            observer.observe(list, { childList: true });
        });
    });

    groupContactList(list);
    observer.observe(list, { childList: true });
}

if (typeof document !== 'undefined') {
    document.documentElement.dataset.ovoCustomPatch = 'loaded';
    loadContactIndexPreviewStyles();
    setupContactsPatch();
    window.dispatchEvent(new CustomEvent(PATCH_LOADED_EVENT));

    console.info('[OVO custom] Patch entry loaded.');
}

export { getContactLetter };
