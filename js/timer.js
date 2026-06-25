/* ===========================================================
   Session Mode: 3モード完全分離モデル (V4.0 - にじみ実装版)
   ============================================================ */

// 【モード切り替え】 'browsing', 'marble', 'snow', 'flowing' から選択
const MODE = 'flowing';

let gl, prog, tex, quadVbo, uColorTintLoc, uSnowLevelLoc;
let snowLevel = 0.2;
const SIZE = 512;

function createProgram(gl, vsSource, fsSource) {
    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vsSource); 
    gl.compileShader(vShader);
    
    const fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fsSource); 
    gl.compileShader(fShader);
    
    // コンパイルエラーチェック
    if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) {
        console.error("FS Error:", gl.getShaderInfoLog(fShader));
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vShader);
    gl.attachShader(prog, fShader);
    gl.linkProgram(prog);
    return prog;
}

// 各モードの描画ロジックを独立して定義（V4.0の意図通り）
const Shaders = {
    // どちらのモードも基本は「滲みと蓄積」の同じロジックを共有
    marble: `precision mediump float;
        uniform sampler2D t;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            float px = 1.0 / 512.0;
            vec4 data = texture2D(t, uv);
            vec4 blurred = (texture2D(t, uv + vec2(0.0, px)) + texture2D(t, uv - vec2(0.0, px)) + 
                            texture2D(t, uv - vec2(px, 0.0)) + texture2D(t, uv + vec2(px, 0.0))) * 0.25;
            gl_FragColor = max(data, blurred * 0.998);
        }`,
    browsing: `precision mediump float;
        uniform sampler2D t;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            float px = 1.0 / 512.0;
            vec4 data = texture2D(t, uv);
            vec4 blurred = (texture2D(t, uv + vec2(0.0, px)) + texture2D(t, uv - vec2(0.0, px)) + 
                            texture2D(t, uv - vec2(px, 0.0)) + texture2D(t, uv + vec2(px, 0.0))) * 0.25;
            gl_FragColor = max(data, blurred * 0.998);
        }`,
    snow: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint; uniform float u_snowLevel;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            vec4 data = texture2D(t, uv);
            vec2 velocity = (data.rg - 0.5) * 0.002;
            vec4 nextColor = texture2D(t, uv - velocity);
            if (uv.y < u_snowLevel) { gl_FragColor = data; }
            else { nextColor.rgb *= u_colorTint; gl_FragColor = nextColor * 0.99; }
        }`,
    flowing: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            vec4 data = texture2D(t, uv);
            vec2 velocity = (data.rg - 0.5) * 0.002;
            vec4 nextColor = texture2D(t, uv - velocity);
            nextColor.rgb *= u_colorTint; gl_FragColor = nextColor * 0.99;
        }`
};

export function initEffectEngine() {
    const canvas = document.getElementById('session-effect-canvas');
    if (!canvas) return;
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    canvas.width = canvas.height = SIZE;
    gl.viewport(0, 0, SIZE, SIZE);

    const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
    
    // 【修正点】MODEに応じて正しいシェーダーソースを選択
    const fs = Shaders[MODE];

    prog = createProgram(gl, vs, fs);
    gl.useProgram(prog);

    uSnowLevelLoc = gl.getUniformLocation(prog, "u_snowLevel");
    uColorTintLoc = gl.getUniformLocation(prog, "u_colorTint");

    const posLoc = gl.getAttribLocation(prog, "p");
    
    quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(SIZE * SIZE * 4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

const InputLogic = {
    mountain: (note) => {
        const size = 16; const data = new Uint8Array(size * size * 4); const center = size / 2;
        const colors = [[200, 220, 255], [255, 230, 200], [255, 200, 255]];
        const color = colors[Math.floor(Math.random() * colors.length)];
        for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
                const idx = (py * size + px) * 4;
                const d = Math.sqrt(Math.pow(px - center, 2) + Math.pow(py - center, 2));
                const alpha = Math.max(0, 1.0 - (d / center)) * 0.2;
                data[idx] = color[0]; data[idx+1] = color[1]; data[idx+2] = color[2]; data[idx+3] = alpha * 255;
            }
        }
        return { x: Math.floor(Math.random()*(SIZE-size)), y: Math.floor(Math.random()*(SIZE-size)), size, data };
    },
    snow: () => ({x: Math.random()*(SIZE-16), y: Math.random()*(SIZE-16), size: 16, data: new Uint8Array(16*16*4).fill(255)}),
    flowing: () => {
        const size = 16; const data = new Uint8Array(size * size * 4);
        const c = [[255,255,0], [255,200,0], [100,255,255]][Math.floor(Math.random() * 3)];
        for(let i=0; i<size*size*4; i+=4) { data[i]=c[0]; data[i+1]=c[1]; data[i+2]=c[2]; data[i+3]=255; }
        return {x: Math.random()*(SIZE-size), y: Math.random()*(SIZE-size), size, data};
    },
    // marble: 衝撃波ロジック
    marble: (note) => {
        const size = 16; const data = new Uint8Array(size * size * 4); const center = size / 2;
        const x = Math.floor(Math.random() * (SIZE - size));
        const y = Math.floor(Math.random() * (SIZE - size));
        const r = Math.floor(Math.random() * 255);
        const g = Math.floor(Math.random() * 255);
        const b = Math.floor(Math.random() * 255);
        for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
                const idx = (py * size + px) * 4;
                const dx = px - center; const dy = py - center;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < center) {
                    const strength = 1.0 - (dist / center);
                    data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
                    data[idx + 3] = Math.floor(strength * 255);
                }
            }
        }
        return { x, y, size, data };
    },
    // browsing: 歪みロジック
    browsing: (note) => {
        const size = 16; const data = new Uint8Array(size * size * 4); const center = size / 2;
        const energy = note.velocity || 0.7;
        const distortion = Math.random() * energy * 5.0;
        for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
                const idx = (py * size + px) * 4;
                const dx = px - center; const dy = py - center;
                const dist = Math.sqrt(dx * dx + dy * dy) + Math.sin(dx * distortion) * 2.0;
                if (dist < center) {
                    const strength = 1.0 - (dist / center);
                    data[idx] = Math.random() * 255;
                    data[idx + 1] = Math.random() * 255;
                    data[idx + 2] = Math.random() * 255;
                    data[idx + 3] = Math.floor(strength * 255);
                }
            }
        }
        return { x: Math.floor(Math.random()*(SIZE-size)), y: Math.floor(Math.random()*(SIZE-size)), size, data };
    }
};

export function triggerNoteEffect(note) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const {x, y, size, data} = InputLogic[MODE](note);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

export function updateEffectParameters(temp) {
    snowLevel = 0.2 + (temp * 0.3);
    gl.useProgram(prog);
    gl.uniform1f(uSnowLevelLoc, snowLevel);
    gl.uniform3f(uColorTintLoc, 0.8 + (temp*0.2), 0.9, 1.0);
}

export function startEffectEngine() {
    const pos = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const render = () => {
        gl.useProgram(prog); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, SIZE, SIZE, 0);
        gl.flush(); requestAnimationFrame(render);
    };
    render();
}

export function stopEffectEngine() {
    if (!gl || !tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(SIZE * SIZE * 4));
    gl.clear(gl.COLOR_BUFFER_BIT);
}