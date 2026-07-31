const PATCH_LOADED_EVENT = 'ovo:custom-patch-loaded';

document.documentElement.dataset.ovoCustomPatch = 'loaded';
window.dispatchEvent(new CustomEvent(PATCH_LOADED_EVENT));

console.info('[OVO custom] Patch entry loaded.');
