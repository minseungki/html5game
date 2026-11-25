import { defineConfig } from 'vite';

// dist를 HTML과 스크립트 하나로 만든다. file://로도 열리도록 module 속성을 없애고 CSS는 HTML에 넣는다
function htmlAndScriptOnly() {
    return {
        name: 'html-and-script-only',
        apply: 'build',
        enforce: 'post',
        generateBundle: {
            order: 'post',
            handler(options, bundle) {
                const html = bundle['index.html'];
                let css = '';
                for (const [name, file] of Object.entries(bundle)) {
                    if (name.endsWith('.css')) {
                        css += file.source;
                        delete bundle[name];
                    }
                }
                html.source = html.source
                    .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
                    .replace(/<script type="module" crossorigin/, '<script defer');
            },
        },
    };
}

export default defineConfig({
    base: './',
    plugins: [htmlAndScriptOnly()],
    build: {
        modulePreload: false,
        cssCodeSplit: false,
        rolldownOptions: {
            output: { format: 'iife', entryFileNames: 'game.js' },
        },
    },
});
