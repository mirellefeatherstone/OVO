import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(
    projectRoot,
    'node_modules/@capacitor/keyboard'
);
const patchPath = resolve(
    projectRoot,
    'patches/@capacitor__keyboard@8.0.5.patch'
);
const keyboardSourcePath = resolve(
    packageRoot,
    'ios/Sources/KeyboardPlugin/Keyboard.m'
);

if (!existsSync(packageRoot) || !existsSync(patchPath) || !existsSync(keyboardSourcePath)) {
    console.log('[UwU Keyboard] Capacitor Keyboard package or patch is not installed yet.');
    process.exit(0);
}

const patch = readFileSync(patchPath, 'utf8');
const keyboardSource = readFileSync(keyboardSourcePath, 'utf8');

if (
    keyboardSource.includes(
        'setKeyboardHeight:(int)height duration:(NSTimeInterval)duration'
    ) &&
    keyboardSource.includes('animationOptionsForKeyboardCurve') &&
    !keyboardSource.includes('duration]+0.2')
) {
    console.log('[UwU Keyboard] Capacitor animation patch already applied.');
    process.exit(0);
}

const runPatch = args => spawnSync(
    '/usr/bin/patch',
    ['--batch', ...args],
    {
        cwd: packageRoot,
        input: patch,
        encoding: 'utf8'
    }
);

const applyResult = runPatch(['--forward', '-p1']);

const patchedSource = readFileSync(keyboardSourcePath, 'utf8');
const patchApplied =
    patchedSource.includes(
        'setKeyboardHeight:(int)height duration:(NSTimeInterval)duration'
    ) &&
    patchedSource.includes('animationOptionsForKeyboardCurve') &&
    !patchedSource.includes('duration]+0.2');

if (applyResult.status !== 0 || !patchApplied) {
    process.stderr.write(
        applyResult.stderr ||
        '[UwU Keyboard] Failed to apply Capacitor animation patch.\n'
    );
    process.exit(applyResult.status || 1);
}

process.stdout.write('[UwU Keyboard] Applied native animation patch.\n');
