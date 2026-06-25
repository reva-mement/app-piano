import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 1430,
    },
    assetsInclude: ['**/*.onnx'],
});
