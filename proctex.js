/** @type {WebGLRenderingContext} */
let gl;
let texCoordBuffer;
let fragShader;
let shaderProgram;

const parser = new exprEval.Parser();

/** @type {HTMLFormElement} */
const form = document.forms["settings"];

const params = new URLSearchParams(window.location.search);
for (const entry of form) {
    if (params.has(entry.name)) {
        if (entry.type == "checkbox") {
            entry.checked = true;
        } else {
            entry.value = params.get(entry.name);
        }
    }
}

/** @type {HTMLTextAreaElement} */
const textArea = document.getElementById("citro3d");

/** @type {HTMLAnchorElement} */
const permalink = document.getElementById("permalink");

const colorLut = document.getElementsByClassName('colorLut');
const colorData = Array(colorLut.length * 4);
let colorTex;

const lutData = Array(256 * 3);
let lutTex;

function generateShaderSource() {
    const shifts = [
        "0.0",
        "{0} * mod(floor(trunc({1}) / 2.0), 2.0)",
        "{0} * mod(floor(trunc({1} + 1.0) / 2.0), 2.0)"
    ];
    const clamps = [
        "{0} > 1.0 ? 0.0 : {0}",
        "min({0}, 1.0)",
        "fract({0})",
        "int({0}) % 2 == 0 ? fract({0}) : 1.0 - fract({0})",
        "{0} > 0.5 ? 1.0 : 0.0"
    ]
    const maps = [
        "u",
        "u * u",
        "v",
        "v * v",
        "(u + v) * 0.5",
        "(u * u + v * v) * 0.5",
        "min(sqrt(u * u + v * v), 1.0)",
        "min(u, v)",
        "max(u, v)",
        "min(((u + v) * 0.5 + sqrt(u * u + v * v)) * 0.5, 1.0)",
    ];
    const component_select = [
        "vec4(final_colour.xyz, 1.0)",
        "vec4(final_colour.a, final_colour.a, final_colour.a, 1.0)",
        "final_colour",
    ];
    return `#version 300 es

        in lowp vec2 vTexcoord;
        uniform sampler2D uSampler;
        uniform sampler2D uLutData;
        out lowp vec4 fragColor;

        lowp vec3 readLut(lowp float coord) {
            lowp float mulled = coord * 128.0;
            lowp float floored = floor(mulled);
            lowp float ceiled = ceil(mulled);
            return mix(
                texelFetch(uLutData, ivec2(floored, 0), 0),
                texelFetch(uLutData, ivec2(ceiled, 0), 0),
                fract(mulled)
            ).rgb;
        }

        int ProcTexNoiseRand1D(int v) {
            const int table[] = int[](0,4,10,8,4,9,7,12,5,15,13,14,11,15,2,11);
            return ((v % 9 + 2) * 3 & 0xF) ^ table[(v / 9) & 0xF];
        }
        
        lowp float ProcTexNoiseRand2D(lowp vec2 point) {
            const int table[] = int[](10,2,15,8,0,7,4,5,5,13,2,6,13,9,3,14);
            int u2 = ProcTexNoiseRand1D(int(point.x));
            int v2 = ProcTexNoiseRand1D(int(point.y));
            v2 += ((u2 & 3) == 1) ? 4 : 0;
            v2 ^= (u2 & 1) * 6;
            v2 += 10 + u2;
            v2 &= 0xF;
            v2 ^= table[u2];
            return -1.0 + float(v2) * (2.0 / 15.0);
        }
        
        lowp float ProcTexNoiseCoef(lowp vec2 x) {
            lowp vec2 grid  = 9.0 * vec2(${form.uNoiseFreq.value}, ${form.vNoiseFreq.value}) * abs(x + vec2(${form.uNoisePhase.value}, ${form.vNoisePhase.value}));
            lowp vec2 point = floor(grid);
            lowp vec2 frac  = grid - point;
        
            lowp float g0 = ProcTexNoiseRand2D(point) * (frac.x + frac.y);
            lowp float g1 = ProcTexNoiseRand2D(point + vec2(1.0, 0.0)) * (frac.x + frac.y - 1.0);
            lowp float g2 = ProcTexNoiseRand2D(point + vec2(0.0, 1.0)) * (frac.x + frac.y - 1.0);
            lowp float g3 = ProcTexNoiseRand2D(point + vec2(1.0, 1.0)) * (frac.x + frac.y - 2.0);
        
            lowp float x_noise = readLut(frac.x).r;
            lowp float y_noise = readLut(frac.y).r;
            lowp float x0 = mix(g0, g1, x_noise);
            lowp float x1 = mix(g2, g3, x_noise);
            return mix(x0, x1, y_noise);
        }
        
        void main() {
            lowp vec2 uv = abs(vTexcoord);
            lowp float u_shift = ${shifts[form.uShift.value]
                .replaceAll("{0}", form.uClamp.value == 3 ? "1.0" : "0.5")
                .replaceAll("{1}", "uv.y")};
            lowp float v_shift = ${shifts[form.vShift.value]
                .replaceAll("{0}", form.vClamp.value == 3 ? "1.0" : "0.5")
                .replaceAll("{1}", "uv.x")};
            ${form.enableNoise.checked ? `uv = abs(uv + vec2(${form.uNoiseAmpl.value}, ${form.vNoiseAmpl.value}) * ProcTexNoiseCoef(uv));` : ""}
            uv.x += u_shift;
            uv.y += v_shift;
            uv.x = ${clamps[form.uClamp.value].replaceAll("{0}", "uv.x")};
            uv.y = ${clamps[form.vClamp.value].replaceAll("{0}", "uv.y")};
            lowp float u = uv.x;
            lowp float v = uv.y;
            lowp float lut_coord = readLut(${maps[form.rgbFunc.value]}).g * float(${form.texWidth.value - 1});
            lowp vec4 final_colour = ${
                form.minFilter.value % 2 != 0
                // linear
                ? `texture(uSampler, vec2((lut_coord + 0.5) / ${colorLut.length}.0, 0))`
                // nearest
                : "texelFetch(uSampler, ivec2(int(round(lut_coord)), 0), 0)"
            };
            ${form.alphaSeparate.checked ? `final_colour.a = readLut(${maps[form.alphaFunc.value]}).b;` : ''}
            fragColor = ${component_select[form.showComponent.value]};
        }
    `;
}

function citro3d() {
    const clamps = [
        "GPU_PT_CLAMP_TO_ZERO",
        "GPU_PT_CLAMP_TO_EDGE",
        "GPU_PT_REPEAT",
        "GPU_PT_MIRRORED_REPEAT",
        "GPU_PT_PULSE",
    ];
    const maps = [
        "GPU_PT_U",
        "GPU_PT_U2",
        "GPU_PT_V",
        "GPU_PT_V2",
        "GPU_PT_ADD",
        "GPU_PT_ADD2",
        "GPU_PT_SQRT2",
        "GPU_PT_MIN",
        "GPU_PT_MAX",
        "GPU_PT_RMAX",
    ];
    const shifts = [
        "GPU_PT_NONE",
        "GPU_PT_ODD",
        "GPU_PT_EVEN",
    ];
    const filters = [
        "GPU_PT_NEAREST",
        "GPU_PT_LINEAR",
        "GPU_PT_NEAREST_MIP_NEAREST",
        "GPU_PT_LINEAR_MIP_NEAREST",
        "GPU_PT_NEAREST_MIP_LINEAR",
        "GPU_PT_LINEAR_MIP_LINEAR",
    ];
    return `
        C3D_ProcTex pt;
        C3D_ProcTexInit(&pt, ${form.texOffset.value}, ${form.texWidth.value});
        C3D_ProcTexClamp(&pt, ${clamps[form.uClamp.value]}, ${clamps[form.vClamp.value]});
        C3D_ProcTexCombiner(&pt, ${!!form.alphaSeparate.value}, ${maps[form.rgbFunc.value]}, ${maps[form.alphaFunc.value]});
        C3D_ProcTexShift(&pt, ${shifts[form.uShift.value]}, ${shifts[form.vShift.value]});
        C3D_ProcTexFilter(&pt, ${filters[form.minFilter.value]});
        ${form.enableNoise.checked ? `
            C3D_ProcTexNoiseCoefs(&pt, C3D_ProcTex_U, ${form.uNoiseAmpl.value}, ${form.uNoiseFreq.value}, ${form.uNoisePhase.value});
            C3D_ProcTexNoiseCoefs(&pt, C3D_ProcTex_V, ${form.vNoiseAmpl.value}, ${form.vNoiseFreq.value}, ${form.vNoisePhase.value});
        ` : ''}
    `.replaceAll(/^\s+/gm, "").trimEnd();
}

function setup() {
    form.addEventListener("change", draw);
    const c = document.getElementById("tex");
    gl = c.getContext("webgl2");

    // set up initial shaders
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, document.getElementById("vert").textContent);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
        alert("vert error: " + gl.getShaderInfoLog(vert));
    }
    fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragShader, document.getElementById("frag").textContent);
    gl.compileShader(fragShader);
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        alert("frag error: " + gl.getShaderInfoLog(fragShader));
    }
    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vert);
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);
    
    // set up position buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1.0, 1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.vertexAttribPointer(
        gl.getAttribLocation(shaderProgram, "aPosition"),
        2,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(gl.getAttribLocation(shaderProgram, "aPosition"));

    // set up texcoord buffer
    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.vertexAttribPointer(
        gl.getAttribLocation(shaderProgram, "aTexcoord"),
        2,
        gl.FLOAT,
        false,
        0,
        0,
    );
    gl.enableVertexAttribArray(gl.getAttribLocation(shaderProgram, "aTexcoord"));

    // setup color lut
    colorTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // setup other lut
    lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // other setup
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

/**
 * 
 * @param {HTMLInputElement} input 
 * @param {number} offset 
 */
function updateLut(input, offset) {
    try {
        const expr = parser.parse(input.value);
        for (let i = 0; i <= 128; i++) lutData[i * 3 + offset] = expr.evaluate({x: i/128});
        input.style.backgroundColor = 'white';
    } catch (e) {
        input.style.backgroundColor = 'red';
    }
}

function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);

    // refresh shader
    gl.detachShader(shaderProgram, fragShader);
    console.log(generateShaderSource());
    gl.shaderSource(fragShader, generateShaderSource());
    gl.compileShader(fragShader);
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        alert("gen'd frag error: " + gl.getShaderInfoLog(fragShader));
        return;
    }
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert("gen'd link error: " + gl.getProgramInfoLog(shaderProgram));
        return;
    }
    gl.useProgram(shaderProgram);

    for (let i = 0; i < colorLut.length; i++) {
        if (i < form.texWidth.value) {
            colorLut[i].hidden = false;
            let col = colorLut[i].value;
            colorData[i * 4 + 0] = parseInt(col.substring(1, 3), 16);
            colorData[i * 4 + 1] = parseInt(col.substring(3, 5), 16);
            colorData[i * 4 + 2] = parseInt(col.substring(5, 7), 16);
            colorData[i * 4 + 3] = 255;
        } else {
            colorLut[i].hidden = true;
        }
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, colorLut.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(colorData));

    updateLut(form.noiseLut, 0);
    updateLut(form.rgbLut, 1);
    updateLut(form.alphaLut, 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, 256, 1, 0, gl.RGB, gl.FLOAT, new Float32Array(lutData));
    // necessary for some reason
    gl.uniform1i(gl.getUniformLocation(shaderProgram, "uLutData"), 1);

    // refresh texture coordinates
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const tcX = +form.tcX.value;
    const tcY = +form.tcY.value;
    const tcXS = +form.tcXS.value;
    const tcYS = +form.tcYS.value;
    const tcLeft = tcX - tcXS;
    const tcRight = tcX + tcXS;
    const tcTop = tcY + tcYS;
    const tcBottom = tcY - tcYS;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([tcLeft, tcTop, tcRight, tcTop, tcLeft, tcBottom, tcRight, tcBottom]), gl.DYNAMIC_DRAW);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    permalink.href = "?" + new URLSearchParams(new FormData(form)).toString();
    textArea.value = citro3d();
}

setup();
draw();