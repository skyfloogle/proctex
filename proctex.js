/** @type {WebGLRenderingContext} */
let gl;
let texCoordBuffer;
let fragShader;
let shaderProgram;


for (i = 0; i <= 128; i++) {
    const row = document.getElementById("lutTable").appendChild(document.createElement("tr"));
    row.appendChild(document.createElement("td")).innerText = i;
    const noise = row.appendChild(document.createElement("td")).appendChild(document.createElement("input"));
    noise.setAttribute("type", "number");
    noise.setAttribute("min", -10);
    noise.setAttribute("max", 10);
    noise.setAttribute("value", i / 128);
    noise.setAttribute("name", `noiseLut${i}`);
    const rgb = row.appendChild(document.createElement("td")).appendChild(document.createElement("input"));
    rgb.setAttribute("type", "number");
    rgb.setAttribute("min", -10);
    rgb.setAttribute("max", 10);
    rgb.setAttribute("value", i / 128);
    rgb.setAttribute("name", `rgbLut${i}`);
    const alpha = row.appendChild(document.createElement("td")).appendChild(document.createElement("input"));
    alpha.setAttribute("type", "number");
    alpha.setAttribute("min", -10);
    alpha.setAttribute("max", 10);
    alpha.setAttribute("value", i / 128);
    alpha.setAttribute("name", `alphaLut${i}`);
}

/** @type {HTMLFormElement} */
const form = document.forms["settings"];

/** @type {HTMLTextAreaElement} */
const textArea = document.getElementById("citro3d");

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
            // TODO actual lut
            return vec3(coord, coord, coord);
        }
        
        void main() {
            lowp float u = abs(vTexcoord.x);
            lowp float v = abs(vTexcoord.y);
            lowp float u_shift = ${shifts[form.uShift.value]
                .replaceAll("{0}", form.uClamp.value == 3 ? "1.0" : "0.5")
                .replaceAll("{1}", "v")};
            lowp float v_shift = ${shifts[form.vShift.value]
                .replaceAll("{0}", form.vClamp.value == 3 ? "1.0" : "0.5")
                .replaceAll("{1}", "u")};
            u += u_shift;
            v += v_shift;
            u = ${clamps[form.uClamp.value].replaceAll("{0}", "u")};
            v = ${clamps[form.vClamp.value].replaceAll("{0}", "v")};
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
    return `
        C3D_ProcTex pt;
        C3D_ProcTexInit(&pt, ${form.texOffset.value}, ${form.texWidth.value});
        C3D_ProcTexClamp(&pt, ${form.uClamp.value}, ${form.vClamp.value});
        C3D_ProcTexCombiner(&pt, ${!!form.alphaSeparate.value}, ${form.rgbFunc.value}, ${form.alphaFunc.value});
        C3D_ProcTexShift(&pt, ${form.uShift.value}, ${form.vShift.value});
        C3D_ProcTexFilter(&pt, ${form.minFilter.value});
        ${form.enableNoise.checked ? `
            C3D_ProcTexNoiseCoefs(&pt, C3D_ProcTex_U, ${form.uNoiseAmpl.value}, ${form.uNoiseFreq.value}, ${form.uNoisePhase.value});
            C3D_ProcTexNoiseCoefs(&pt, C3D_ProcTex_V, ${form.vNoiseAmpl.value}, ${form.vNoiseFreq.value}, ${form.vNoisePhase.value});
        ` : ''}
        C3D_ProcTexLodBias(&pt, ${form.lodBias.value});
        
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
    gl.uniform1i(gl.getUniformLocation(shaderProgram, "uSampler"), 0);

    // setup other lut
    lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(shaderProgram, "uLutData"), 1);

    // other setup
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);

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

    for (let i = 0; i <= 128; i++) {
        lutData[i * 3 + 0] = form[`noiseLut${i}`].value * 255;
        lutData[i * 3 + 1] = form[`rgbLut${i}`].value * 255;
        lutData[i * 3 + 2] = form[`alphaLut${i}`].value * 255;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(lutData));

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

    // refresh texture coordinates
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const tcLeft = form.tcLeft.value;
    const tcTop = form.tcTop.value;
    const tcRight = form.tcRight.value;
    const tcBottom = form.tcBottom.value;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([tcLeft, tcTop, tcRight, tcTop, tcLeft, tcBottom, tcRight, tcBottom]), gl.DYNAMIC_DRAW);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    textArea.value = citro3d();
}

setup();
draw();