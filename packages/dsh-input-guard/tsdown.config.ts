// 包自包含构建：Host 半边产出 ESM + 类型声明，Client 半边产出由 DSH ModuleLoader 加载的 CJS bundle。
// 入口与 outDir 均为包内相对路径，因此必须在包目录下执行（pnpm build / pnpm --filter <pkg> build）。
const packageId = '@michengai/dsh-input-guard'
const buildMode = process.env.NODE_ENV ?? 'production'

export default [
    {
        entry: ['src/index.ts'],
        outDir: 'lib',
        format: ['esm'],
        platform: 'node',
        target: 'es2022',
        dts: true,
        clean: true,
    },
    {
        entry: { client: 'src/client/index.ts' },
        outDir: 'lib',
        format: ['cjs'],
        platform: 'browser',
        target: 'es2022',
        // React 由 DSH 客户端模块表提供；内联会生成第二份 React 实例，导致 Hooks 失效。
        deps: {
            neverBundle: ['react', 'react-dom', 'react/jsx-runtime'],
        },
        define: {
            'process.env.NODE_ENV': JSON.stringify(buildMode),
            'import.meta.env.MODE': JSON.stringify(buildMode),
            'import.meta.env': JSON.stringify({ MODE: buildMode }),
        },
        dts: false,
        clean: false,
        outputOptions: {
            entryFileNames: 'client.js',
            banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
            intro: 'var module = { exports: {} }; var exports = module.exports;',
            footer: 'return module.exports; } });',
        },
    },
]
