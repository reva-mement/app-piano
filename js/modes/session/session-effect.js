/* ===========================================================
   Session Mode: 3モード完全分離モデル (V5.0 - 50エフェクト拡張版)
   ============================================================
   ★ 元は browsing / marble / snow / flowing の4モードだったが、
     「音楽・海・光・宇宙・街」5テーマ × 各10種 = 50モードに拡張。
     50個すべてを別々のシェーダーとして書くのは非現実的なため、
       - 5つの「ベースシェーダー」(蓄積・流動・降下・渦・瞬き)
       - 5つの「粒子形状」(グロー・スパーク・リング・streak・散乱)
       - テーマごとの配色パレット
     の組み合わせで、見た目が明確に異なる50パターンを構成している。
   =========================================================== */

let gl, prog, tex, quadVbo, uColorTintLoc, uSnowLevelLoc;
let snowLevel = 0.2;
let currentMode = null;
let animFrameId = null;
const SIZE = 512;

function createProgram(gl, vsSource, fsSource) {
    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vsSource);
    gl.compileShader(vShader);

    const fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fsSource);
    gl.compileShader(fShader);

    if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) {
        console.error("FS Error:", gl.getShaderInfoLog(fShader));
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vShader);
    gl.attachShader(prog, fShader);
    gl.linkProgram(prog);
    return prog;
}

/* -----------------------------------------------------------
   ★ ベースシェーダー（5種）
   すべて u_colorTint を持つよう統一（updateEffectParametersで一律制御するため）。
   u_snowLevel を使うのは snowfall のみ。
----------------------------------------------------------- */
const BASE_SHADERS = {
    // 蓄積・拡散型（にじみが定着していく）：music/space/cityの一部で使用
    accumulate: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            float px = 1.0 / 512.0;
            vec4 data = texture2D(t, uv);
            vec4 blurred = (texture2D(t, uv + vec2(0.0, px)) + texture2D(t, uv - vec2(0.0, px)) +
                            texture2D(t, uv - vec2(px, 0.0)) + texture2D(t, uv + vec2(px, 0.0))) * 0.25;
            vec4 result = max(data, blurred * 0.998);
            result.rgb *= u_colorTint;
            gl_FragColor = result;
        }`,
    // 流動型（一定方向に流れて減衰）：sea/lightで多用
    flowing: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            vec4 data = texture2D(t, uv);
            vec2 velocity = (data.rg - 0.5) * 0.002;
            vec4 nextColor = texture2D(t, uv - velocity);
            nextColor.rgb *= u_colorTint;
            gl_FragColor = nextColor * 0.99;
        }`,
    // 降下型（下に向かって落ちる／雨・流星向け）：city/spaceで使用
    snowfall: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint; uniform float u_snowLevel;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            vec4 data = texture2D(t, uv);
            vec2 velocity = (data.rg - 0.5) * 0.002;
            vec4 nextColor = texture2D(t, uv - velocity);
            if (uv.y < u_snowLevel) { gl_FragColor = data; }
            else { nextColor.rgb *= u_colorTint; gl_FragColor = nextColor * 0.99; }
        }`,
    // 渦型（速度ベクトルを90度回転させて渦を作る）：sea/spaceで使用
    ripple: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            vec4 data = texture2D(t, uv);
            vec2 vel = (data.rg - 0.5) * 0.003;
            vec2 rotated = vec2(-vel.y, vel.x);
            vec4 nextColor = texture2D(t, uv - rotated);
            nextColor.rgb *= u_colorTint;
            gl_FragColor = nextColor * 0.985;
        }`,
    // 瞬き型（ぼかし無し、速い減衰）：light/space/city/musicの一部
    sparkle: `precision mediump float;
        uniform sampler2D t; uniform vec3 u_colorTint;
        void main() {
            vec2 uv = gl_FragCoord.xy / 512.0;
            vec4 data = texture2D(t, uv);
            data.rgb *= u_colorTint;
            gl_FragColor = data * 0.90;
        }`
};

/* -----------------------------------------------------------
   ★ 粒子形状（5種）。ノートが鳴った瞬間に書き込む「にじみの種」の形。
----------------------------------------------------------- */
function generateSplat(shape, palette, velocity) {
    const size = 16;
    const data = new Uint8Array(size * size * 4);
    const center = size / 2;
    const color = palette[Math.floor(Math.random() * palette.length)];
    const energy = velocity || 0.7;

    if (shape === 'glow') {
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            const dx = px - center, dy = py - center;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < center) {
                const idx = (py * size + px) * 4;
                const strength = 1.0 - (dist / center);
                data[idx] = color[0]; data[idx + 1] = color[1]; data[idx + 2] = color[2];
                data[idx + 3] = Math.floor(strength * 255);
            }
        }
    } else if (shape === 'spark') {
        const r = center * 0.55;
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            const dx = px - center, dy = py - center;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < r) {
                const idx = (py * size + px) * 4;
                const strength = Math.pow(1.0 - (dist / r), 2);
                data[idx] = color[0]; data[idx + 1] = color[1]; data[idx + 2] = color[2];
                data[idx + 3] = Math.floor(strength * 255);
            }
        }
    } else if (shape === 'ring') {
        const inner = center * 0.35, outer = center * 0.9;
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            const dx = px - center, dy = py - center;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > inner && dist < outer) {
                const idx = (py * size + px) * 4;
                const mid = (inner + outer) / 2, half = (outer - inner) / 2;
                const strength = 1.0 - Math.abs(dist - mid) / half;
                data[idx] = color[0]; data[idx + 1] = color[1]; data[idx + 2] = color[2];
                data[idx + 3] = Math.floor(strength * 255);
            }
        }
    } else if (shape === 'streak') {
        const angle = Math.random() * Math.PI;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const stretch = 1.5 + energy * 2.0;
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            const dx = px - center, dy = py - center;
            const rx = (dx * cos + dy * sin) / stretch;
            const ry = (-dx * sin + dy * cos) * 1.3;
            const dist = Math.sqrt(rx * rx + ry * ry);
            if (dist < center) {
                const idx = (py * size + px) * 4;
                const strength = 1.0 - (dist / center);
                data[idx] = color[0]; data[idx + 1] = color[1]; data[idx + 2] = color[2];
                data[idx + 3] = Math.floor(strength * 255);
            }
        }
    } else if (shape === 'scatter') {
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            if (Math.random() < 0.3 + energy * 0.2) {
                const idx = (py * size + px) * 4;
                const c = palette[Math.floor(Math.random() * palette.length)];
                data[idx] = c[0]; data[idx + 1] = c[1]; data[idx + 2] = c[2];
                data[idx + 3] = Math.floor(Math.random() * 200 + 55);
            }
        }
    }

    return {
        x: Math.floor(Math.random() * (SIZE - size)),
        y: Math.floor(Math.random() * (SIZE - size)),
        size, data
    };
}

/* -----------------------------------------------------------
   ★ 50モード定義（テーマ 音楽/海/光/宇宙/街 × 各10種）
----------------------------------------------------------- */
const MODE_DEFINITIONS = [
    // ===== 音楽 (music) =====
    { id: 'piano_bloom',    theme: 'music', shaderType: 'accumulate', shape: 'glow',    palette: [[255,215,0],[255,255,255],[200,160,60]] },
    { id: 'string_pluck',   theme: 'music', shaderType: 'sparkle',    shape: 'spark',   palette: [[200,30,30],[255,180,60],[255,215,0]] },
    { id: 'drum_ring',      theme: 'music', shaderType: 'ripple',     shape: 'ring',    palette: [[180,120,40],[255,200,120],[120,70,20]] },
    { id: 'vinyl_swirl',    theme: 'music', shaderType: 'flowing',    shape: 'scatter', palette: [[40,30,20],[180,140,80],[255,215,0]] },
    { id: 'bass_thump',     theme: 'music', shaderType: 'accumulate', shape: 'glow',    palette: [[150,20,20],[80,10,10],[220,60,60]] },
    { id: 'treble_sparkle', theme: 'music', shaderType: 'sparkle',    shape: 'spark',   palette: [[255,255,255],[255,240,180],[255,215,0]] },
    { id: 'chord_burst',    theme: 'music', shaderType: 'accumulate', shape: 'streak',  palette: [[255,215,0],[255,255,255],[220,180,255]] },
    { id: 'metronome_pulse',theme: 'music', shaderType: 'ripple',     shape: 'ring',    palette: [[20,20,20],[255,255,255],[180,180,180]] },
    { id: 'staff_flow',     theme: 'music', shaderType: 'flowing',    shape: 'streak',  palette: [[255,215,0],[200,160,60],[255,255,255]] },
    { id: 'keynote_glow',   theme: 'music', shaderType: 'snowfall',   shape: 'glow',    palette: [[255,255,255],[255,215,0],[255,240,200]] },

    // ===== 海 (sea) =====
    { id: 'wave_swell',     theme: 'sea', shaderType: 'flowing',   shape: 'streak',  palette: [[0,105,148],[0,180,216],[144,224,239]] },
    { id: 'bubble_rise',    theme: 'sea', shaderType: 'snowfall',  shape: 'spark',   palette: [[173,232,244],[255,255,255],[100,200,230]] },
    { id: 'coral_bloom',    theme: 'sea', shaderType: 'accumulate',shape: 'glow',    palette: [[255,127,111],[0,150,150],[255,180,160]] },
    { id: 'tide_pull',      theme: 'sea', shaderType: 'flowing',   shape: 'scatter', palette: [[2,62,138],[0,100,150],[50,140,190]] },
    { id: 'whirlpool',      theme: 'sea', shaderType: 'ripple',    shape: 'ring',    palette: [[0,150,170],[0,80,120],[150,220,230]] },
    { id: 'foam_crest',     theme: 'sea', shaderType: 'sparkle',   shape: 'spark',   palette: [[255,255,255],[220,240,250],[180,220,235]] },
    { id: 'deep_current',   theme: 'sea', shaderType: 'accumulate',shape: 'streak',  palette: [[5,30,70],[10,60,110],[40,100,150]] },
    { id: 'jellyfish_glow', theme: 'sea', shaderType: 'sparkle',   shape: 'glow',    palette: [[150,240,255],[255,150,220],[200,255,255]] },
    { id: 'shore_ripple',   theme: 'sea', shaderType: 'ripple',    shape: 'glow',    palette: [[144,224,239],[0,180,216],[255,255,255]] },
    { id: 'storm_surge',    theme: 'sea', shaderType: 'accumulate',shape: 'scatter', palette: [[20,40,60],[60,90,120],[200,220,230]] },

    // ===== 光 (light) =====
    { id: 'prism_split',    theme: 'light', shaderType: 'flowing',   shape: 'streak',  palette: [[255,100,100],[100,255,150],[100,150,255],[255,255,100]] },
    { id: 'lens_flare',     theme: 'light', shaderType: 'accumulate',shape: 'glow',    palette: [[255,255,255],[255,230,150],[255,200,100]] },
    { id: 'aurora_veil',    theme: 'light', shaderType: 'flowing',   shape: 'streak',  palette: [[100,255,180],[150,100,255],[100,200,255]] },
    { id: 'glow_trail',     theme: 'light', shaderType: 'snowfall',  shape: 'streak',  palette: [[255,255,200],[255,240,150],[255,255,255]] },
    { id: 'strobe_flash',   theme: 'light', shaderType: 'sparkle',   shape: 'spark',   palette: [[255,255,255],[240,240,255]] },
    { id: 'sunbeam',        theme: 'light', shaderType: 'accumulate',shape: 'streak',  palette: [[255,220,100],[255,255,220],[255,180,60]] },
    { id: 'refraction',     theme: 'light', shaderType: 'ripple',    shape: 'ring',    palette: [[255,180,200],[180,220,255],[220,255,200]] },
    { id: 'glitter_dust',   theme: 'light', shaderType: 'sparkle',   shape: 'scatter', palette: [[255,255,255],[255,215,0],[220,220,255]] },
    { id: 'halo_ring',      theme: 'light', shaderType: 'ripple',    shape: 'ring',    palette: [[255,255,255],[255,230,180]] },
    { id: 'laser_streak',   theme: 'light', shaderType: 'flowing',   shape: 'streak',  palette: [[255,50,50],[50,255,150],[80,150,255]] },

    // ===== 宇宙 (space) =====
    { id: 'nebula_drift',    theme: 'space', shaderType: 'flowing',   shape: 'scatter', palette: [[150,50,200],[255,100,180],[80,100,255]] },
    { id: 'starfield_twinkle',theme:'space', shaderType: 'sparkle',   shape: 'spark',   palette: [[255,255,255],[220,220,255]] },
    { id: 'supernova_burst', theme: 'space', shaderType: 'accumulate',shape: 'glow',    palette: [[255,255,255],[255,180,80],[255,100,50]] },
    { id: 'blackhole_pull',  theme: 'space', shaderType: 'ripple',    shape: 'ring',    palette: [[60,20,90],[20,10,30],[150,80,200]] },
    { id: 'comet_trail',     theme: 'space', shaderType: 'snowfall',  shape: 'streak',  palette: [[255,255,255],[150,200,255],[100,150,255]] },
    { id: 'galaxy_swirl',    theme: 'space', shaderType: 'ripple',    shape: 'ring',    palette: [[120,60,200],[60,100,220],[200,150,255]] },
    { id: 'meteor_shower',   theme: 'space', shaderType: 'snowfall',  shape: 'streak',  palette: [[255,240,220],[255,180,120],[255,255,255]] },
    { id: 'orbit_ring',      theme: 'space', shaderType: 'ripple',    shape: 'ring',    palette: [[100,180,255],[255,255,255],[150,200,255]] },
    { id: 'pulsar_flash',    theme: 'space', shaderType: 'sparkle',   shape: 'glow',    palette: [[255,255,255],[150,255,255]] },
    { id: 'cosmic_dust',     theme: 'space', shaderType: 'accumulate',shape: 'scatter', palette: [[150,80,200],[255,150,220],[100,100,200]] },

    // ===== 街 (city) =====
    { id: 'neon_sign',        theme: 'city', shaderType: 'accumulate', shape: 'streak',  palette: [[255,0,150],[0,255,255],[255,50,200]] },
    { id: 'traffic_light',    theme: 'city', shaderType: 'sparkle',    shape: 'glow',    palette: [[255,50,50],[255,220,0],[50,255,100]] },
    { id: 'rain_window',      theme: 'city', shaderType: 'snowfall',   shape: 'streak',  palette: [[100,150,220],[200,220,255],[255,255,255]] },
    { id: 'skyline_glow',     theme: 'city', shaderType: 'flowing',    shape: 'glow',    palette: [[255,180,80],[80,120,200],[255,220,150]] },
    { id: 'subway_rush',      theme: 'city', shaderType: 'flowing',    shape: 'streak',  palette: [[255,255,255],[255,220,100],[200,200,255]] },
    { id: 'crosswalk_blink',  theme: 'city', shaderType: 'sparkle',    shape: 'spark',   palette: [[255,255,255],[255,255,200]] },
    { id: 'billboard_flicker',theme: 'city', shaderType: 'sparkle',    shape: 'scatter', palette: [[255,0,150],[0,255,255],[255,220,0],[150,0,255]] },
    { id: 'streetlamp_halo',  theme: 'city', shaderType: 'accumulate', shape: 'ring',    palette: [[255,200,120],[255,160,60]] },
    { id: 'taxi_light',       theme: 'city', shaderType: 'sparkle',    shape: 'glow',    palette: [[255,220,0],[255,180,0]] },
    { id: 'night_market',     theme: 'city', shaderType: 'accumulate', shape: 'scatter', palette: [[255,150,80],[255,80,80],[255,220,120],[200,80,255]] },
];

export function initEffectEngine() {
    const canvas = document.getElementById('session-effect-canvas');
    if (!canvas) return;
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    canvas.width = canvas.height = SIZE;
    gl.viewport(0, 0, SIZE, SIZE);

    quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(SIZE * SIZE * 4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // ★ initの時点でも一度モードを選んでおく（念のための保険。実際の抽選は毎回startEffectEngine()で行う）
    selectRandomMode();
}

// ★★★ 修正：以前はモード抽選＋シェーダー構築がinitEffectEngine()の中（＝起動時に1回だけ）に
//   入っていたため、REC/再生を何度押しても最初に決まったモードのまま変わらなかった。
//   ここを関数として切り出し、startEffectEngine()から毎回呼ぶようにする。
function selectRandomMode() {
    if (!gl) return;
    currentMode = MODE_DEFINITIONS[Math.floor(Math.random() * MODE_DEFINITIONS.length)];
    console.log(`🎨 Session Effect: [${currentMode.theme}] ${currentMode.id}`);

    const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = BASE_SHADERS[currentMode.shaderType];

    prog = createProgram(gl, vs, fs);
    gl.useProgram(prog);

    uSnowLevelLoc = gl.getUniformLocation(prog, "u_snowLevel");
    uColorTintLoc = gl.getUniformLocation(prog, "u_colorTint");
    if (uColorTintLoc) gl.uniform3f(uColorTintLoc, 1.0, 1.0, 1.0);
    if (uSnowLevelLoc) gl.uniform1f(uSnowLevelLoc, snowLevel);

    const posLoc = gl.getAttribLocation(prog, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
}

export function triggerNoteEffect(note) {
    if (!currentMode || !gl) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const velocity = note && typeof note === 'object' ? note.velocity : undefined;
    const { x, y, size, data } = generateSplat(currentMode.shape, currentMode.palette, velocity);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

export function updateEffectParameters(temp) {
    snowLevel = 0.2 + (temp * 0.3);
    gl.useProgram(prog);
    if (uSnowLevelLoc) gl.uniform1f(uSnowLevelLoc, snowLevel);
    if (uColorTintLoc) gl.uniform3f(uColorTintLoc, 0.8 + (temp * 0.2), 0.9, 1.0);
}

export function startEffectEngine() {
    if (!gl) return;

    // ★★★ 修正：REC/再生ボタンを押すたびに、ここで毎回モードを抽選し直す
    selectRandomMode();

    // ★★★ 修正：以前は呼ぶたびに新しい描画ループが多重に起動してしまっていたため、
    //   既存のループがあれば止めてから開始する
    if (animFrameId) cancelAnimationFrame(animFrameId);

    const render = () => {
        gl.useProgram(prog); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, SIZE, SIZE, 0);
        gl.flush();
        animFrameId = requestAnimationFrame(render);
    };
    render();
}

export function stopEffectEngine() {
    if (!gl || !tex) return;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(SIZE * SIZE * 4));
    gl.clear(gl.COLOR_BUFFER_BIT);
}
