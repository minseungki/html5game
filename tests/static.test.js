import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const pkg = JSON.parse(read('package.json'));
const srcFiles = ['index.html', 'styles.css', ...readdirSync(new URL('src/', root)).map((f) => 'src/' + f)];

test('viewport에 확대 제한이 없고 게임 시작이 초기 hidden이며 필수 고지 문구가 있다', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)[1];
    assert.ok(!/user-scalable|maximum-scale|minimum-scale/.test(viewport));
    assert.match(html, /<button id="btn-start"[^>]*\bhidden\b/);
    assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    assert.ok(html.includes('광고를 끝까지 보면 게임 1판. 1점에 1코인'));
    assert.ok(html.includes('코인은 앱 안에서만 쓰고 현금으로 바꿀 수 없어요'));
    assert.ok(html.includes('광고보고 게임하기'));
});

test('index.html에 gpt.js 정적 태그와 외부 이미지, 글꼴이 없다', () => {
    assert.ok(!/gpt\.js|googletagservices|doubleclick/.test(html));
    assert.ok(!/<img\b/.test(html));
    assert.ok(!/https?:\/\//.test(html.replace(/<meta[^>]*>/g, '')));
    assert.ok(!/@font-face|fonts\.googleapis|url\(/.test(css));
    assert.equal((html.match(/<script\b/g) || []).length, 1);
});

test('소스에 innerHTML, 긴 대시, 이모지, 광고 갱신 호출이 없고 런타임 의존성이 없다', () => {
    for (const file of srcFiles) {
        const text = read(file);
        assert.ok(!text.includes('innerHTML'), file);
        assert.ok(!/[–—]/.test(text), file);
        assert.ok(!/\p{Extended_Pictographic}/u.test(text), file);
        assert.ok(!text.includes('refresh('), file);
    }
    assert.equal(pkg.dependencies, undefined);
    assert.deepEqual(Object.keys(pkg.devDependencies), ['vite']);
});

test('home에 게임 버튼 2개가 있고 landing은 초기 hidden이다', () => {
    const home = html.match(/<section id="screen-home"[\s\S]*?<\/section>/)[0];
    assert.equal((home.match(/<button\b/g) || []).length, 2);
    assert.match(html, /<section id="screen-landing"[^>]*\bhidden\b/);
    assert.doesNotMatch(html.match(/<section id="screen-home"[^>]*>/)[0], /hidden/);
    assert.ok(html.includes('<title>미니 게임</title>'));
    for (const id of ['btn-landing-home', 'btn-failed-home', 'btn-result-home']) {
        assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.equal((html.match(/role="status"/g) || []).length, 1);
});

const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
};
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

test('라이트/다크 주요 글자색과 배경 토큰의 대비가 4.5:1 이상이다', () => {
    const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => tokens(m[1]));
    assert.equal(blocks.length, 2);
    for (const t of blocks) {
        for (const [fg, bg] of [['ink', 'bg'], ['ink', 'panel'], ['muted', 'bg'], ['muted', 'panel'], ['accent-ink', 'accent']]) {
            assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${fg} on ${bg}`);
        }
    }
});

test('화분판 cq 크기는 @supports 안에 있고 vw/vh 폴백이 함께 있다', () => {
    assert.match(css, /@supports \(width: 1cqw\)/);
    const [base, supported] = css.split('@supports (width: 1cqw)');
    assert.match(base, /\.pots\s*\{[^}]*width: min\(calc\(100vw - 28px\), 60vh, 480px\)/);
    assert.ok(!/cqw|container-type/.test(base));
    assert.match(supported, /container-type: size/);
    assert.match(supported, /width: min\(100cqw, 100cqh, 480px\)/);
    assert.match(supported, /width: min\(calc\(100cqw \+ 28px\), 100cqh\)/);
});
